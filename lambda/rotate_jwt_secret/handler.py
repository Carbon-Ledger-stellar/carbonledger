"""
rotate_jwt_secret

Implements the standard AWS Secrets Manager 4-step rotation lifecycle
(createSecret / setSecret / testSecret / finishSecret) for the application's
JWT signing secret.

Overlap design
--------------
The secret value is a JSON document, not a bare string:

    {
      "current": "<new signing secret>",
      "previous": "<prior signing secret, or empty>",
      "previous_expires_at": "<ISO-8601 timestamp, or empty>"
    }

`current` is used to SIGN new tokens immediately after rotation.
`previous` is still accepted for VERIFYING tokens signed before the
rotation, until `previous_expires_at` passes. This is what lets
in-flight requests survive a rotation with no downtime: the backend
never has to restart, and JWTs issued moments before rotation still
validate for OVERLAP_SECONDS (default 900s / 15 minutes).

The backend (see backend/src/key-rotation) re-reads this document on
SIGHUP and on its own polling interval, and uses `current` to sign and
[`current`, `previous`] to verify, dropping `previous` once it expires.
"""
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

OVERLAP_SECONDS = int(os.environ.get("OVERLAP_SECONDS", "900"))


def lambda_handler(event, context):
    service_client = boto3.client("secretsmanager")
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = service_client.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled", False):
        raise ValueError(f"Secret {arn} is not enabled for rotation")

    versions = metadata["VersionIdsToStages"]
    if token not in versions:
        raise ValueError(f"Version {token} has no stage for rotation of secret {arn}")
    if "AWSCURRENT" in versions[token]:
        logger.info("Version %s already marked AWSCURRENT for %s", token, arn)
        return
    if "AWSPENDING" not in versions[token]:
        raise ValueError(f"Version {token} is not marked AWSPENDING for rotation of secret {arn}")

    if step == "createSecret":
        create_secret(service_client, arn, token)
    elif step == "setSecret":
        set_secret(service_client, arn, token)
    elif step == "testSecret":
        test_secret(service_client, arn, token)
    elif step == "finishSecret":
        finish_secret(service_client, arn, token)
    else:
        raise ValueError(f"Unknown rotation step: {step}")


def create_secret(service_client, arn, token):
    """Generate the new AWSPENDING secret document, carrying the current
    value forward as `previous` so it can still verify tokens in flight."""
    current = json.loads(service_client.get_secret_value(SecretId=arn, VersionStage="AWSCURRENT")["SecretString"])

    try:
        service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")
        logger.info("createSecret: AWSPENDING version already exists for %s", arn)
        return
    except service_client.exceptions.ResourceNotFoundException:
        pass

    now = datetime.now(timezone.utc)
    pending = {
        "current": secrets.token_urlsafe(48),
        "previous": current["current"],
        "previous_expires_at": (now + timedelta(seconds=OVERLAP_SECONDS)).isoformat(),
    }

    service_client.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps(pending),
        VersionStages=["AWSPENDING"],
    )
    logger.info("createSecret: staged new AWSPENDING JWT secret for %s", arn)


def set_secret(service_client, arn, token):
    """No external system owns the JWT secret's value (unlike a DB password),
    so there is nothing to push out here — the value only needs to exist in
    Secrets Manager for the backend to pick up. Kept as a no-op step so the
    rotation lifecycle stays uniform with the other rotation Lambdas."""
    logger.info("setSecret: no-op for JWT secret %s", arn)


def test_secret(service_client, arn, token):
    """Sanity-check the pending value is well-formed JSON with the fields the
    backend expects, so a bad rotation never reaches finishSecret."""
    pending = json.loads(service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")["SecretString"])
    for field in ("current", "previous", "previous_expires_at"):
        if field not in pending:
            raise ValueError(f"testSecret: pending JWT secret document missing '{field}'")
    if len(pending["current"]) < 32:
        raise ValueError("testSecret: new JWT secret is too short")
    logger.info("testSecret: pending JWT secret document is valid for %s", arn)


def finish_secret(service_client, arn, token):
    """Promote AWSPENDING to AWSCURRENT. The previous AWSCURRENT becomes
    AWSPREVIOUS automatically. The backend keeps honoring the old signing
    secret for verification via the `previous`/`previous_expires_at` fields
    embedded in the document itself, independent of the AWSPREVIOUS stage."""
    metadata = service_client.describe_secret(SecretId=arn)
    current_version = None
    for version, stages in metadata["VersionIdsToStages"].items():
        if "AWSCURRENT" in stages:
            if version == token:
                logger.info("finishSecret: version %s already current for %s", version, arn)
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