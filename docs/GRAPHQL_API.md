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

## Example queries by use case

All examples below are copy-pasteable into GraphQL Playground or Apollo Studio Explorer. Replace placeholder variable values with real IDs from your environment.

### Projects

Fetch a single project by ID:

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
```

```json
{ "projectId": "proj_123" }
```

List projects with optional filters:

```graphql
query ListProjects($input: ListProjectsInput!) {
  listProjects(input: $input) {
    projects {
      projectId
      name
      methodology
      country
      status
      vintageYear
    }
    total
    hasMore
    nextCursor
  }
}
```

```json
{
  "input": {
    "country": "BR",
    "methodology": "VCS",
    "status": "ACTIVE",
    "limit": 20
  }
}
```

### Retirements

List retirements filtered by holder and/or batch:

```graphql
query ListRetirements($input: ListRetirementsInput!) {
  listRetirements(input: $input) {
    retirements {
      retirementId
      batchId
      amount
      retiredBy
      txHash
      retiredAt
    }
    total
    hasMore
    nextCursor
  }
}
```

```json
{
  "input": {
    "retiredBy": "GABC...PUBLIC_KEY",
    "batchId": "batch_456",
    "limit": 20
  }
}
```

### Portfolio

Aggregate a corporation's holdings and retirements:

```graphql
query GetPortfolio($holder: String!) {
  getPortfolio(holder: $holder) {
    holder
    totalCreditsHeld
    totalCreditsRetired
    holdings {
      batchId
      projectId
      projectName
      amountHeld
    }
    retirements {
      retirementId
      batchId
      amount
      txHash
      retiredAt
    }
  }
}
```

```json
{ "holder": "GABC...PUBLIC_KEY" }
```

## Pagination

List and search queries return cursor-based pagination fields: `total`, `hasMore`, and `nextCursor`. Pass `limit` to control page size and `cursor` to fetch the next page. When `hasMore` is `false`, `nextCursor` is `null` and no further pages exist.

```graphql
query SearchMarketplacePage($input: SearchMarketplaceInput!) {
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

First page:

```json
{ "input": { "query": "solar", "limit": 10 } }
```

Next page (use `nextCursor` from the previous response):

```json
{ "input": { "query": "solar", "limit": 10, "cursor": "eyJpZCI6ImxzdF8xMCJ9" } }
```

The same `limit`/`cursor` pattern applies to `listProjects`, `listRetirements`, and `listCredits`.

## Errors

GraphQL errors are returned in the standard `errors` array. Each entry includes a `message` and an `extensions.code` value that mirrors the REST error semantics. Representative responses:

Unauthenticated (missing or invalid bearer token):

```json
{
  "errors": [
    {
      "message": "Unauthorized",
      "extensions": { "code": "UNAUTHENTICATED" }
    }
  ],
  "data": null
}
```

Forbidden (authenticated but insufficient role):

```json
{
  "errors": [
    {
      "message": "Forbidden resource",
      "extensions": { "code": "FORBIDDEN" }
    }
  ],
  "data": null
}
```

Not found:

```json
{
  "errors": [
    {
      "message": "Project not found",
      "extensions": { "code": "NOT_FOUND" }
    }
  ],
  "data": { "getProject": null }
}
```

Bad user input (validation failure):

```json
{
  "errors": [
    {
      "message": "limit must not be greater than 100",
      "extensions": {
        "code": "BAD_USER_INPUT",
        "field": "input.limit"
      }
    }
  ],
  "data": null
}
```

## API collections (Postman / Insomnia)

A shared collection lives at `docs/api-collections/carbonledger-graphql.postman_collection.json` and can be imported into Postman or Insomnia. It must be kept in sync with this document and include:

- The example queries above for projects, retirements, portfolio, and marketplace search.
- The bearer authentication header (`Authorization: Bearer <token>`) configured at the collection level.
- Pagination examples using `limit` and `cursor`.
- Error-case requests that reproduce the `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, and `BAD_USER_INPUT` responses.

When changing the schema or these examples, update the collection in the same pull request and verify every example against the generated schema before committing.

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
