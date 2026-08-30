import { BaseFactory, FactoryOverride } from './base.factory';

export interface Certificate {
  id: string;
  retirementId: string;
  ownerId: string;
  certificateNumber: string;
  amount: number;
  ipfsHash: string;
  metadata: Record<string, any>;
  issuedAt: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class CertificateFactory extends BaseFactory<Certificate> {
  protected getDefault(): Certificate {
    const amount = this.generateNumber(10, 10000);
    return {
      id: this.generateId(),
      retirementId: this.generateId(),
      ownerId: this.generateId(),
      certificateNumber: `CERT-${this.generateNumber(2024, 2025)}-${this.generateNumber(1, 99999)}`,
      amount,
      ipfsHash: `Qm${this.generateId().replace(/-/g, '')}`,
      metadata: {
        standard: 'Gold Standard',
        certificateType: 'Retirement',
        vintage: this.generateNumber(2018, 2025),
      },
      issuedAt: this.generateDate(),
      expiresAt: undefined,
      createdAt: this.generateDate(),
      updatedAt: this.generateDate(),
    };
  }
}

export const createCertificate = (overrides?: FactoryOverride<Certificate>) => {
  const factory = new CertificateFactory();
  return factory.build(overrides);
};

export const createCertificates = (count: number, overrides?: FactoryOverride<Certificate>) => {
  const factory = new CertificateFactory();
  return factory.buildMany(count, overrides);
};
