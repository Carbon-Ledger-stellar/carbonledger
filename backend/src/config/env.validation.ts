import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
  Provision = 'provision',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  // Database
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // Redis
  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  REDIS_DB: number = 0;

  // Mail
  @IsString()
  @IsNotEmpty()
  MAIL_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  MAIL_PORT: number = 587;
;

  @IsString()
  @IsOptional()
  MAIL_USER?: string;

  @IsString()
  @IsOptional()
  MAIL_PASSWORD?: string;

  @IsString()
  @IsNotEmpty()
  MAIL_FROM: string;

  // Stellar
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  STELLAR_HORIZON_URL: string;

  @IsString()
  @IsNotEmpty()
  STELLAR_NETWORK_PASSPHRASE: string;

  @IsString()
  @IsOptional()
  STELLAR_SECRET_KEY?: string;

  // Auth
  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '1d';
}

/**
 * Validates the process environment against {@link EnvironmentVariables}.
 *
 * Collects every missing/invalid required variable and throws a single error
 * listing all of them so startup fails fast with a clear, actionable message.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors.map((error) => {
      const constraints = error.constraints
        ? Object.values(error.constraints).join(', ')
        : 'is invalid';
      return `  - ${error.property}: ${constraints}`;
    });

    throw new Error(
      `Environment validation failed. Missing or invalid variables:\n${messages.join(
        '\n',
      )}`,
    );
  }

  return validatedConfig;
}
