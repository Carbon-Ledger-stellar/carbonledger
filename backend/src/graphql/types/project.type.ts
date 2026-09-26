import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class ProjectType {
  @Field(() => ID)
  id: string;

  @Field()
  projectId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  methodology: string;

  @Field()
  country: string;

  @Field()
  projectType: string;

  @Field()
  status: string;

  @Field(() => Int)
  vintageYear: number;

  @Field(() => Int)
  methodologyScore: number;

  @Field()
  totalCreditsIssued: string;

  @Field()
  totalCreditsRetired: string;

  @Field()
  metadataCid: string;

  @Field()
  verifierAddress: string;

  @Field()
  ownerAddress: string;

  @Field(() => GraphQLJSON, { nullable: true })
  coordinates?: unknown;

  @Field({ nullable: true })
  lastMonitoringAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class ProjectsPage {
  @Field(() => [ProjectType])
  projects: ProjectType[];

  @Field({ nullable: true })
  nextCursor?: string;

  @Field()
  hasMore: boolean;

  @Field(() => Int)
  total: number;
}
