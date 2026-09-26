import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class CreditBatchType {
  @Field(() => ID)
  id: string;

  @Field()
  batchId: string;

  @Field()
  projectId: string;

  @Field(() => Int)
  vintageYear: number;

  @Field()
  amount: string;

  @Field()
  serialStart: string;

  @Field()
  serialEnd: string;

  @Field()
  status: string;

  @Field()
  metadataCid: string;

  @Field()
  issuedAt: Date;
}

@ObjectType()
export class TransferEventType {
  @Field()
  eventType: string;

  @Field()
  actor: string;

  @Field({ nullable: true })
  from?: string;

  @Field({ nullable: true })
  to?: string;

  @Field()
  txHash: string;

  @Field()
  timestamp: Date;
}

@ObjectType()
export class ProvenanceEventType {
  @Field()
  eventType: string;

  @Field()
  actor: string;

  @Field()
  txHash: string;

  @Field()
  timestamp: Date;
}

@ObjectType()
export class RetirementSummaryType {
  @Field()
  retirementId: string;

  @Field()
  retiredBy: string;

  @Field()
  beneficiary: string;

  @Field()
  retirementReason: string;

  @Field(() => Int)
  vintageYear: number;

  @Field()
  txHash: string;

  @Field()
  retiredAt: Date;

  @Field({ nullable: true })
  certificateUrl?: string;
}

@ObjectType()
export class CreditProjectHistoryType {
  @Field()
  projectId: string;

  @Field()
  name: string;

  @Field()
  methodology: string;

  @Field()
  country: string;

  @Field(() => Int)
  vintageYear: number;
}

@ObjectType()
export class SerialProvenanceType {
  @Field()
  serialNumber: string;

  @Field(() => CreditBatchType)
  batch: CreditBatchType;

  @Field(() => GraphQLJSON)
  project: unknown;

  @Field({ nullable: true })
  currentOwner?: string;

  @Field()
  status: string;

  @Field(() => [TransferEventType])
  transfers: TransferEventType[];

  @Field(() => [ProvenanceEventType])
  provenance: ProvenanceEventType[];

  @Field(() => RetirementSummaryType, { nullable: true })
  retirement?: RetirementSummaryType;
}

@ObjectType()
export class CreditBatchProvenanceType {
  @Field()
  batchId: string;

  @Field(() => CreditProjectHistoryType)
  project: CreditProjectHistoryType;

  @Field(() => [TransferEventType])
  transfers: TransferEventType[];

  @Field(() => [ProvenanceEventType])
  provenance: ProvenanceEventType[];

  @Field({ nullable: true })
  retirement?: RetirementSummaryType;
}
