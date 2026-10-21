import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import depthLimit from 'graphql-depth-limit';
import { createComplexityLimitRule } from 'graphql-validation-complexity';
import { GraphQLError } from 'graphql';
import type { Express } from 'express';
import type { Server } from 'http';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { createContext, type GraphQLContext } from './context';
import { logger } from '../utils/logger';

/** Maximum allowed nesting depth for a single GraphQL operation. */
export const MAX_QUERY_DEPTH = 10;

/** Maximum allowed static complexity score for a single GraphQL operation. */
export const MAX_QUERY_COMPLEXITY = 1000;

const schema = makeExecutableSchema({ typeDefs, resolvers });

/**
 * Validation rules that reject operations which are too deep or too complex.
 * Both rules surface a descriptive GraphQLError to the client.
 */
export const queryLimitValidationRules = [
  depthLimit(MAX_QUERY_DEPTH, {}, (depths) => {
    const deepest = Object.values(depths).reduce(
      (max, depth) => Math.max(max, depth),
      0,
    );
    return new GraphQLError(
      `Query exceeds maximum depth of ${MAX_QUERY_DEPTH} (requested depth: ${deepest}).`,
      { extensions: { code: 'QUERY_DEPTH_EXCEEDED' } },
    );
  }),
  createComplexityLimitRule(MAX_QUERY_COMPLEXITY, {
    onCost: (cost: number) => {
      logger.warn({ cost }, 'GraphQL query complexity evaluated');
    },
    formatErrorMessage: (cost: number) =>
      `Query exceeds maximum complexity of ${MAX_QUERY_COMPLEXITY} (calculated cost: ${cost}).`,
  }),
];

export async function createGraphQLServer(
  app: Express,
  httpServer: Server,
): Promise<ApolloServer<GraphQLContext>> {
  const server = new ApolloServer<GraphQLContext>({
    schema,
    validationRules: queryLimitValidationRules,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    formatError: (formattedError, error) => {
      const original = error instanceof GraphQLError ? error : undefined;
      const code = original?.extensions?.code;
      if (code === 'QUERY_DEPTH_EXCEEDED') {
        return {
          ...formattedError,
          message: formattedError.message,
          extensions: { ...formattedError.extensions, code },
        };
      }
      return formattedError;
    },
  });

  await server.start();

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }) => createContext(req),
    }),
  );

  return server;
}
