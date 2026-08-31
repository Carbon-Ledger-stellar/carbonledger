import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { ProjectsModule } from '../projects/projects.module';
import { CreditsModule } from '../credits/credits.module';
import { RetirementsModule } from '../retirements/retirements.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProjectsResolver } from './resolvers/projects.resolver';
import { CreditsResolver } from './resolvers/credits.resolver';
import { RetirementsResolver } from './resolvers/retirements.resolver';
import { ProvenanceResolver } from './resolvers/provenance.resolver';
import { MarketplaceResolver } from './resolvers/marketplace.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code-first: schema is generated from decorators at boot time
      autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
      sortSchema: true,
      // GraphQL playground available in non-production environments
      playground: process.env.NODE_ENV !== 'production',
      // Apollo Studio Explorer uses introspection against the deployed endpoint.
      introspection: true,
      // Pass the raw Express request through to resolvers (for auth context)
      context: ({ req }: { req: any }) => ({ req }),
      path: '/api/v1/graphql',
    }),
    ProjectsModule,
    CreditsModule,
    RetirementsModule,
    MarketplaceModule,
  ],
  providers: [ProjectsResolver, CreditsResolver, RetirementsResolver, ProvenanceResolver, MarketplaceResolver],
})
export class GraphqlModule {}
