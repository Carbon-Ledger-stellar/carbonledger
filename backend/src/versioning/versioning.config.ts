export interface ApiVersionConfig {
  deprecated: boolean;
  sunset?: Date;
  successorVersion?: string;
  migrationGuide?: string;
}

export const API_VERSIONING_CONFIG: Record<string, ApiVersionConfig> = {
  v1: {
    deprecated: true,
    sunset: new Date('2028-01-01T00:00:00.000Z'),
    successorVersion: 'v2',
    migrationGuide: 'https://api.carbonledger.io/docs/migration/v1-to-v2',
  },
  v2: {
    deprecated: false,
  },
};

export const API_VERSIONING_CONFIG_TOKEN = 'API_VERSIONING_CONFIG';
