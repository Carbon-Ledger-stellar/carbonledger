import { Injectable, Logger } from '@nestjs/common';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Not related to KeyRotationService in this same folder (that one is the
 * admin-triggered oracle/admin Stellar-keypair rotation API and is
 * untouched by this change). This is the low-level client used by
 * SecretsRefreshService to fetch the JWT / Postgres / Redis secrets that
 * the Lambdas in infra/main/secrets.tf rotate.
 */
@Injectable()
export class SecretsManagerProvider {
  private readonly logger = new Logger(SecretsManagerProvider.name);
  private readonly client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  async getSecretJson<T = Record<string, string>>(secretId: string): Promise<T> {
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );

    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} has no SecretString value`);
    }

    try {
      return JSON.parse(response.SecretString) as T;
    } catch (err) {
      this.logger.error(`Secret ${secretId} is not valid JSON`, err as Error);
      throw err;
    }
  }
}
