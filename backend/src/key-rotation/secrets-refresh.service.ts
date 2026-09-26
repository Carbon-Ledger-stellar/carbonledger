import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SecretsManagerProvider } from './secrets-manager.provider';

interface JwtSecretDocument {
  current: string;
  previous: string;
  previous_expires_at: string; // ISO-8601, empty if no overlap active
}

interface PostgresCredentialsDocument {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

interface RedisSecretDocument {
  password: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // safety net; SIGHUP is the primary path

/**
 * Replaces the old JWT_SECRET / JWT_SECRET_NEW env-var pattern
 * (previously read directly by JWTRotationStrategy via ConfigService)
 * with values read from the Secrets Manager secrets defined in
 * infra/main/secrets.tf: "${local.name}/jwt-secret",
 * "${local.name}/postgres-credentials", "${local.name}/redis-password".
 *
 * Refreshes on SIGHUP (sent by the rotation Lambda's finishSecret step,
 * or manually: `kill -HUP <pid>` / `systemctl kill -s HUP carbonledger-backend`)
 * and on a 5-minute poll as a fallback — no process restart required.
 */
@Injectable()
export class SecretsRefreshService implements OnModuleInit {
  private readonly logger = new Logger(SecretsRefreshService.name);

  private jwt: JwtSecretDocument;
  private postgres: PostgresCredentialsDocument;
  private redis: RedisSecretDocument;

  private readonly jwtSecretId =
    process.env.JWT_SECRET_ID ?? `${process.env.APP_NAME ?? 'carbonledger'}-${process.env.NODE_ENV ?? 'staging'}/jwt-secret`;
  private readonly postgresSecretId =
    process.env.POSTGRES_SECRET_ID ?? `${process.env.APP_NAME ?? 'carbonledger'}-${process.env.NODE_ENV ?? 'staging'}/postgres-credentials`;
  private readonly redisSecretId =
    process.env.REDIS_SECRET_ID ?? `${process.env.APP_NAME ?? 'carbonledger'}-${process.env.NODE_ENV ?? 'staging'}/redis-password`;

  constructor(private readonly secretsManager: SecretsManagerProvider) {}

  async onModuleInit(): Promise<void> {
    await this.refreshAll();

    process.on('SIGHUP', () => {
      this.logger.log('SIGHUP received — refreshing rotated secrets');
      this.refreshAll().catch((err) =>
        this.logger.error('Failed to refresh secrets on SIGHUP', err as Error),
      );
    });

    setInterval(() => {
      this.refreshAll().catch((err) =>
        this.logger.error('Failed to refresh secrets on poll interval', err as Error),
      );
    }, POLL_INTERVAL_MS).unref();
  }

  private async refreshAll(): Promise<void> {
    const [jwt, postgres, redis] = await Promise.all([
      this.secretsManager.getSecretJson<JwtSecretDocument>(this.jwtSecretId),
      this.secretsManager.getSecretJson<PostgresCredentialsDocument>(this.postgresSecretId),
      this.secretsManager.getSecretJson<RedisSecretDocument>(this.redisSecretId),
    ]);

    this.jwt = jwt;
    this.postgres = postgres;
    this.redis = redis;

    this.logger.log('Rotated secrets refreshed in memory (no restart)');
  }

  getJwtSigningSecret(): string {
    return this.jwt.current;
  }

  /**
   * Current secret, plus `previous` only while inside its 15-minute
   * overlap window — so tokens signed just before a rotation still
   * validate. This is what JWTRotationStrategy calls in place of the
   * old primarySecret/secondarySecret env-var pair.
   */
  getJwtVerificationSecrets(): string[] {
    const secrets = [this.jwt.current];
    if (this.jwt.previous && this.jwt.previous_expires_at) {
      if (Date.now() < new Date(this.jwt.previous_expires_at).getTime()) {
        secrets.push(this.jwt.previous);
      }
    }
    return secrets;
  }

  getPostgresCredentials(): PostgresCredentialsDocument {
    return this.postgres;
  }

  getRedisPassword(): string {
    return this.redis.password;
  }
}
