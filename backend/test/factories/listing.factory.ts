import { BaseFactory, FactoryOverride } from './base.factory';

export interface Listing {
  id: string;
  batchId: string;
  sellerId: string;
  amount: number;
  pricePerCredit: number;
  currency: 'USDC' | 'XLM' | 'EURC';
  status: 'active' | 'partial' | 'sold' | 'cancelled';
  createdAt: Date;
  expiresAt?: Date;
  updatedAt: Date;
}

export class ListingFactory extends BaseFactory<Listing> {
  protected getDefault(): Listing {
    return {
      id: this.generateId(),
      batchId: this.generateId(),
      sellerId: this.generateId(),
      amount: this.generateNumber(100, 50000),
      pricePerCredit: this.generateNumber(5, 50),
      currency: 'USDC',
      status: 'active',
      createdAt: this.generateDate(),
      expiresAt: undefined,
      updatedAt: this.generateDate(),
    };
  }
}

export const createListing = (overrides?: FactoryOverride<Listing>) => {
  const factory = new ListingFactory();
  return factory.build(overrides);
};

export const createListings = (count: number, overrides?: FactoryOverride<Listing>) => {
  const factory = new ListingFactory();
  return factory.buildMany(count, overrides);
};
