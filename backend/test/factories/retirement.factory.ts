import { BaseFactory, FactoryOverride } from './base.factory';

export interface Retirement {
  id: string;
  batchId: string;
  retireeId: string;
  amount: number;
  purpose: string;
  beneficiary: string;
  transactionHash: string;
  retiredAt: Date;
  metadata: Record<string, any>;
  createdAt: Date;
}

export class RetirementFactory extends BaseFactory<Retirement> {
  protected getDefault(): Retirement {
    return {
      id: this.generateId(),
      batchId: this.generateId(),
      retireeId: this.generateId(),
      amount: this.generateNumber(10, 10000),
      purpose: `Carbon offset for ${this.generateNumber(1, 100)} tonnes CO2e`,
      beneficiary: `Company ${this.generateNumber(1, 100)}`,
      transactionHash: `0x${this.generateId().replace(/-/g, '')}`,
      retiredAt: this.generateDate(),
      metadata: {
        source: 'integration-test',
        verificationMethod: 'automatic',
      },
      createdAt: this.generateDate(),
    };
  }
}

export const createRetirement = (overrides?: FactoryOverride<Retirement>) => {
  const factory = new RetirementFactory();
  return factory.build(overrides);
};

export const createRetirements = (count: number, overrides?: FactoryOverride<Retirement>) => {
  const factory = new RetirementFactory();
  return factory.buildMany(count, overrides);
};
