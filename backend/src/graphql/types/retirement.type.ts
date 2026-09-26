import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class RetirementType {
  @Field(() => ID)
  id: string;

  @Field()
  retirementId: string;

  @Field()
  batchId: string;

  @Field()
  projectId: string;

  @Field()
  amount: string;

  @Field()
  retiredBy: string;

  @Field()
  beneficiary: string;

  @Field()
  retirementReason: string;

  @Field(() => Int)
  vintageYear: number;

  @Field()
  serialStart: string;

  @Field()
  serialEnd: string;

  @Field(() => [String])
  serialNumbers: string[];

  @Field()
  txHash: string;

  @Field({ nullable: true })
  certificateCid?: string;

  @Field({ nullable: true })
  certificateUrl?: string;

  @Field()
  isValid: boolean;

  @Field({ nullable: true })
  validatedAt?: Date;

  @Field()
  retiredAt: Date;
}

@ObjectType()
export class RetirementsPage {
  @Field(() => [RetirementType])
  retirements: RetirementType[];

  @Field({ nullable: true })
  next_cursor?: string;

  @Field(() => Int)
  total_count: number;
}
