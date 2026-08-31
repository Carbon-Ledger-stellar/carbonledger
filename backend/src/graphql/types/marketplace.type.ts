import { Field, Float, ID, InputType, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class MarketplaceListingType {
  @Field(() => ID)
  id: string;

  @Field()
  listingId: string;

  @Field()
  projectId: string;

  @Field()
  batchId: string;

  @Field()
  seller: string;

  @Field(() => Int)
  amountAvailable: number;

  @Field()
  pricePerCredit: string;

  @Field(() => Int)
  vintageYear: number;

  @Field()
  methodology: string;

  @Field()
  country: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  projectName?: string;
}

@ObjectType()
export class MarketplacePage {
  @Field(() => [MarketplaceListingType])
  listings: MarketplaceListingType[];

  @Field(() => Int)
  total: number;

  @Field()
  hasMore: boolean;

  @Field({ nullable: true })
  nextCursor?: string;
}

@InputType()
export class ListCreditsInput {
  @Field()
  projectId: string;

  @Field({ nullable: true })
  cursor?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  limit?: number;
}

@InputType()
export class SearchMarketplaceInput {
  @Field({ nullable: true })
  search?: string;

  @Field(() => [String], { nullable: true })
  methodology?: string[];

  @Field(() => [Int], { nullable: true })
  vintage?: number[];

  @Field(() => [String], { nullable: true })
  country?: string[];

  @Field({ nullable: true })
  minPrice?: string;

  @Field({ nullable: true })
  maxPrice?: string;

  @Field(() => [String], { nullable: true })
  status?: string[];

  @Field({ nullable: true })
  seller?: string;

  @Field({ nullable: true })
  sortBy?: string;

  @Field({ nullable: true })
  cursor?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  limit?: number;
}

@InputType()
export class MintCreditsInput {
  @Field()
  batchId: string;

  @Field()
  projectId: string;

  @Field(() => Int)
  vintageYear: number;

  @Field(() => Float)
  amount: number;

  @Field()
  serialStart: string;

  @Field()
  serialEnd: string;

  @Field()
  metadataCid: string;
}

@InputType()
export class RetireCreditsInput {
  @Field()
  batchId: string;

  @Field(() => Float)
  amount: number;

  @Field()
  beneficiary: string;

  @Field()
  retirementReason: string;
}

@InputType()
export class PurchaseCreditsInput {
  @Field()
  listingId: string;

  @Field(() => Int)
  amount: number;
}