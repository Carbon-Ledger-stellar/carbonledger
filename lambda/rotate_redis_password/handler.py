"""
rotate_redis_password

Rotates the AUTH token on an ElastiCache (Redis) replication group using the
standard AWS Secrets Manager 4-step rotation lifecycle. ElastiCache has no
built-in Secrets Manager rotation template (unlike RDS), so this Lambda talks
to ElastiCache directly.

ElastiCache supports dual AUTH tokens during a rotation window
(`AuthTokenUpdateStrategy=ROTATE`), so this mirrors the same overlap idea used
for the JWT secret: the old password keeps working until the rotation is
finished, so connected clients (NestJS, oracle services) don't need a
coordinated simultaneous restart.
"""
import json
import logging
import os
import secrets

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REPLICATION_GROUP_ID = os.environ["ELASTICACHE_REPLICATION_GROUP_ID"]


def lambda_handler(event, context):
    service_client = boto3.client("secretsmanager")
    elasticache = boto3.client("elasticache")
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = service_client.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled", False):
        raise ValueError(f"Secret {arn} is not enabled for rotation")

    versions = metadata["VersionIdsToStages"]
    if "AWSCURRENT" in versions.get(token, []):
        return
    if "AWSPENDING" not in versions.get(token, []):
        raise ValueError(f"Version {token} is not marked AWSPENDING for rotation of secret {arn}")

    if step == "createSecret":
        create_secret(service_client, arn, token)
    elif step == "setSecret":
        set_secret(service_client, elasticache, arn, token)
    elif step == "testSecret":
        test_secret(service_client, arn, token)
    elif step == "finishSecret":
        finish_secret(service_client, arn, token)
    else:
        raise ValueError(f"Unknown rotation step: {step}")


def create_secret(service_client, arn, token):
    try:
        service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")
        return
    except service_client.exceptions.ResourceNotFoundException:
        pass

    new_password = secrets.token_urlsafe(32)
    service_client.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps({"password": new_password}),
        VersionStages=["AWSPENDING"],
    )
    logger.info("createSecret: staged new Redis AUTH token for %s", arn)


def set_secret(service_client, elasticache, arn, token):
    """Push the new AUTH token to ElastiCache with ROTATE strategy, which
    keeps both the old and new tokens valid until a follow-up call sets
    strategy=SET (done once the rotation is confirmed in finishSecret)."""
    pending = json.loads(service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")["SecretString"])

    elasticache.modify_replication_group(
        ReplicationGroupId=REPLICATION_GROUP_ID,
        AuthToken=pending["password"],
        AuthTokenUpdateStrategy="ROTATE",
        ApplyImmediately=True,
    )
    logger.info("setSecret: pushed pending AUTH token to %s with ROTATE strategy", REPLICATION_GROUP_ID)


def test_secret(service_client, arn, token):
    """Confirm the pending token authenticates against the replication
    group's primary endpoint before we commit to it."""
    import redis  # imported lazily; bundled via the Lambda layer

    pending = json.loads(service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")["SecretString"])
    elasticache = boto3.client("elasticache")
    groups = elasticache.describe_replication_groups(ReplicationGroupId=REPLICATION_GROUP_ID)["ReplicationGroups"]
    endpoint = groups[0]["NodeGroups"][0]["PrimaryEndpoint"]

    client = redis.Redis(
        host=endpoint["Address"],
        port=endpoint["Port"],
        password=pending["password"],
        ssl=True,
        socket_timeout=5,
    )
    if not client.ping():
        raise ValueError("testSecret: pending Redis AUTH token failed PING")
    logger.info("testSecret: pending Redis AUTH token verified against %s", REPLICATION_GROUP_ID)


def finish_secret(service_client, arn, token):
    """Promote AWSPENDING to AWSCURRENT, then finalize ElastiCache's AUTH
    strategy to SET so the old token stops being accepted."""
    elasticache = boto3.client("elasticache")
    elasticache.modify_replication_group(
        ReplicationGroupId=REPLICATION_GROUP_ID,
        AuthTokenUpdateStrategy="SET",
        ApplyImmediately=True,
    )

    metadata = service_client.describe_secret(SecretId=arn)
    current_version = None
    for version, stages in metadata["VersionIdsToStages"].items():
        if "AWSCURRENT" in stages:
            if version == token:
                return
            current_version = version
            break

    service_client.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )
    logger.info("finishSecret: promoted version %s to AWSCURRENT for %s", token, arn)