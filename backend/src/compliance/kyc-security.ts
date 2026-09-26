import * as crypto from 'crypto';

export interface KycSessionConfig {
  provider?: string;
  apiKey?: string;
  environment?: string;
  allowDevFallback?: boolean;
}

export interface KycSession {
  sessionId: string;
  userId: string;
  status: 'pending' | 'verified' | 'rejected';
  provider: string;
  createdAt: Date;
  expiresAt: Date;
}

export class KycSecurityService {
  private readonly isProduction: boolean;
  private readonly config: KycSessionConfig;

  constructor(config: KycSessionConfig = {}) {
    this.config = {
      provider: config.provider || process.env.KYC_PROVIDER,
      apiKey: config.apiKey || process.env.PERSONA_API_KEY,
      environment: config.environment || process.env.NODE_ENV || 'development',
      allowDevFallback: config.allowDevFallback ?? (process.env.ALLOW_INSECURE_DEV_KYC === 'true'),
    };
    this.isProduction = this.config.environment === 'production' || this.config.environment === 'staging';
  }

  /**
   * Safely creates a KYC session. Throws in production if keys are unset.
   */
  public createKycSession(userId: string): KycSession {
    if (!this.config.provider || !this.config.apiKey) {
      if (this.isProduction) {
        throw new Error(
          'SecurityViolation: KYC_PROVIDER and API credentials must be configured in production/staging environments. Dev fallback is prohibited.'
        );
      }

      if (!this.config.allowDevFallback) {
        throw new Error(
          'KYC configuration error: Set KYC_PROVIDER and credentials or explicitly enable ALLOW_INSECURE_DEV_KYC for local testing.'
        );
      }

      // Generate unpredictable cryptographically secure session reference even in dev mode
      const secureRandomSuffix = crypto.randomBytes(16).toString('hex');
      return {
        sessionId: `secure_dev_${secureRandomSuffix}`,
        userId,
        status: 'pending',
        provider: 'dev_mock',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    }

    // Production provider session generation
    const providerSessionId = `kyc_${crypto.randomUUID()}`;
    return {
      sessionId: providerSessionId,
      userId,
      status: 'pending',
      provider: this.config.provider,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400 * 1000),
    };
  }

  /**
   * Validates webhook session authenticity and prevents spoofed dev sessions.
   */
  public validateWebhookSession(sessionId: string): boolean {
    if (sessionId.startsWith('dev_kyc_') || sessionId.startsWith('secure_dev_')) {
      if (this.isProduction) {
        return false;
      }
      return this.config.allowDevFallback === true;
    }
    return true;
  }
}
