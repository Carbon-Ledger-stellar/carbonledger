import { BaseFactory, FactoryOverride } from './base.factory';

export interface CreditBatch {
  id: string;
  projectId: string;
  serialNumber: string;
  amount: number;
  remainingAmount: number;
  vintageYear: number;
  status: 'pending' | 'active' | 'retired' | 'expired';
  issuanceDate: Date;
  expiryDate?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class CreditBatchFactory extends BaseFactory<CreditBatch> {
  protected getDefault(): CreditBatch {
    const amount = this.generateNumber(1000, 100000);
    return {
      id: this.generateId(),
      projectId: this.generateId(),
      serialNumber: `CARBON-${this.generateNumber(2020, 2025)}-${this.generateNumber(1, 9999)}`,
      amount,
      remainingAmount: amount,
      vintageYear: this.generateNumber(2018, 2025),
      status: 'active',
      issuanceDate: this.generateDate(),
      expiryDate: undefined,
      metadata: {
        standard: 'Verra',
        version: 'VCS-V3',
      },
      createdAt: this.generateDate(),
      updatedAt: this.generateDate(),
    };
  }
}

export const createCreditBatch = (overrides?: FactoryOverride<CreditBatch>) => {
  const factory = new CreditBatchFactory();
  return factory.build(overrides);
};

export const createCreditBatches = (count: number, overrides?: FactoryOverride<CreditBatch>) => {
  const factory = new CreditBatchFactory();
  return factory.buildMany(count, overrides);
};
