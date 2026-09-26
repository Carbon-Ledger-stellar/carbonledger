# GraphQL API

CarbonLedger exposes GraphQL alongside REST at:

```text
https://api.carbonledger.com/api/v1/graphql
```

The NestJS Apollo endpoint uses a generated code-first schema. GraphQL Playground is available outside production; production schema exploration is performed through Apollo Studio Explorer using the endpoint above and an approved authentication token. Introspection is enabled for Studio Explorer.

## Queries

```graphql
query GetProject($projectId: String!) {
  getProject(projectId: $projectId) {
    projectId
    name
    methodology
    country
    status
    vintageYear
  }
}

query ListCredits($input: ListCreditsInput!) {
  listCredits(input: $input) {
    batchId
    projectId
    amount
    status
    serialStart
    serialEnd
    issuedAt
  }
}

query SearchMarketplace($input: SearchMarketplaceInput!) {
  searchMarketplace(input: $input) {
    listings {
      listingId
      projectId
      batchId
      amountAvailable
      pricePerCredit
      status
      projectName
    }
    total
    hasMore
    nextCursor
  }
}
```

`searchMarketplace` requires at least one search or filter value, matching the REST search service behavior. `listCredits` is public and scopes results to the supplied project ID.

## Mutations

The request must include the same bearer authentication used by REST. Resolver authorization matches REST roles:

- `mintCredits`: `admin`
- `retireCredits`: `corporation` or `admin`
- `purchaseCredits`: `corporation` or `admin`

```graphql
mutation MintCredits($input: MintCreditsInput!) {
  mintCredits(input: $input) {
    batchId
    projectId
    amount
    status
  }
}

mutation RetireCredits($input: RetireCreditsInput!) {
  retireCredits(input: $input) {
    retirementId
    batchId
    amount
    retiredBy
    txHash
  }
}

mutation PurchaseCredits($input: PurchaseCreditsInput!) {
  purchaseCredits(input: $input)
}
```

The authenticated public key is derived from the request context for mint actor, retirement holder, and purchase buyer values; clients cannot supply those identities through GraphQL input.

## Apollo Studio setup

1. Create or select the CarbonLedger graph in Apollo Studio.
2. Add the production GraphQL endpoint as the graph URL.
3. Configure the required bearer token header in Studio Explorer using an approved operator token.
4. Use the Schema and Explorer views to inspect the generated schema and run the examples above.
5. Keep Apollo Studio credentials and graph registry credentials in the deployment secret manager; never commit them.

## Performance acceptance

GraphQL delegates to the existing service layer, so database and blockchain behavior remains shared with REST. Record a production-like comparison before release using equivalent REST and GraphQL queries, including serialization time and p95 latency. The release meets the target only when GraphQL overhead is measured at **less than 5%** for the agreed query set; no unmeasured performance claim is made by this implementation.
