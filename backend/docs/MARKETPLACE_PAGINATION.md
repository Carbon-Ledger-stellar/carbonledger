# Marketplace Pagination Guide

## Overview

The marketplace listings endpoint (`GET /marketplace/listings`) supports comprehensive pagination to efficiently handle large datasets. The implementation uses a combination of page-based, offset-based, and cursor-based pagination strategies.

**Endpoint:** `GET /marketplace/listings`

**Authentication:** Public (no auth required)

**Rate Limit:** 100 requests per 60 seconds per IP

## Pagination Strategies

### 1. Page-Based Pagination (Recommended for UI)

**Best for:** Web applications with numbered page buttons (Page 1, 2, 3…)

**Query Parameters:**
- `page` (optional, default: 1) — Page number starting at 1
- `limit` (optional, default: 20, max: 100) — Items per page

**Example:**
```bash
GET /marketplace/listings?page=2&limit=20
```

**Response:**
```json
{
  "data": [...],
  "listings": [...],
  "total_count": 250,
  "total": 250,
  "page": 2,
  "total_pages": 13,
  "limit": 20,
  "offset": 20,
  "has_more": true,
  "hasMore": true,
  "nextOffset": 40
}
```

**Calculation:**
- `offset = (page - 1) * limit`
- `total_pages = ceil(total_count / limit)`
- `has_more = offset + items.length < total_count`

### 2. Offset-Based Pagination

**Best for:** APIs without persistent sessions

**Query Parameters:**
- `offset` (optional, default: 0) — Number of items to skip
- `limit` (optional, default: 20, max: 100) — Items to return

**Example:**
```bash
GET /marketplace/listings?offset=40&limit=20
```

**Response:**
```json
{
  "listings": [...],
  "total_count": 250,
  "limit": 20,
  "offset": 40,
  "has_more": true,
  "nextOffset": 60
}
```

### 3. Cursor-Based Pagination (Keyset Pagination)

**Best for:** High-volume APIs, mobile apps, real-time feeds

**Query Parameters:**
- `cursor` (optional) — Opaque cursor string from previous `next_cursor`
- `limit` (optional, default: 20, max: 100) — Items to return

**Example:**
```bash
# First request
GET /marketplace/listings?limit=20

# Response includes next_cursor:
{
  "listings": [...],
  "next_cursor": "eyJpZCI6IkxJU1RJTkcwMDEiLCJjcmVhdGVkQXQiOiIyMDI0LTA4LTMwVDEwOjA0OjAwWiJ9",
  "prev_cursor": null,
  "has_more": true
}

# Next request with cursor
GET /marketplace/listings?cursor=eyJpZCI6IkxJU1RJTkcwMDEiLCJjcmVhdGVkQXQiOiIyMDI0LTA4LTMwVDEwOjA0OjAwWiJ9&limit=20
```

**Advantages:**
- Stable across insertions/deletions
- Efficient (no counting required)
- No pagination drift

## Limit Enforcement

The `limit` parameter is capped at **100 items maximum** to prevent resource exhaustion.

| Request | Enforced Limit |
|---------|-----------------|
| `?limit=20` | 20 |
| `?limit=100` | 100 |
| `?limit=200` | 100 (capped) |
| `?limit=1000` | 100 (capped) |
| `?limit=invalid` | 20 (default) |
| `?limit=-5` | 20 (default) or error |
| `?limit=0` | Error or 1 |

**Implementation:**
```typescript
const normalizedLimit = normalizePaginationLimit(limit, 100);
```

## Sorting

Combine pagination with sorting using `sortBy` and `sortOrder`:

**Query Parameters:**
- `sortBy` — "price", "vintageYear", "methodology", "verificationDate"
- `sortOrder` — "asc" or "desc" (default: "asc")

### Supported Sort Fields

| Field | Type | Behavior |
|-------|------|----------|
| `price` | String (decimal) | Sorted in-memory (numeric comparison) |
| `vintageYear` | Number | Database sort |
| `methodology` | String | Database sort |
| `verificationDate` | Date | Database sort (uses project.updatedAt) |

**Examples:**
```bash
# Lowest prices first
GET /marketplace/listings?sortBy=price&sortOrder=asc&limit=20

# Highest prices first
GET /marketplace/listings?sortBy=price&sortOrder=desc&limit=20

# Newest vintage year first
GET /marketplace/listings?sortBy=vintageYear&sortOrder=desc&limit=20
```

**Note:** Price sorting occurs in-memory because `pricePerCredit` is stored as a String to preserve decimal precision. This is optimized to only sort the top 1000 matching rows before pagination.

## Filtering

Pagination works with all available filters:

| Parameter | Type | Example |
|-----------|------|---------|
| `methodology` | string | `?methodology=ACM0002` |
| `vintage` | number | `?vintage=2024` |
| `country` | string | `?country=Kenya` |
| `minPrice` | string | `?minPrice=5.50` |
| `maxPrice` | string | `?maxPrice=20.00` |
| `search` | string | `?search=solar` |

**Combined Filtering & Pagination:**
```bash
GET /marketplace/listings?page=1&limit=20&methodology=ACM0002&country=Kenya&minPrice=5&maxPrice=20&sortBy=price&sortOrder=asc
```

**Response:**
```json
{
  "listings": [
    {
      "id": "...",
      "listingId": "LISTING001",
      "projectId": "PROJ001",
      "batchId": "BATCH001",
      "seller": "GCORP123",
      "amountAvailable": 100,
      "pricePerCredit": "10.50",
      "vintageYear": 2024,
      "methodology": "ACM0002",
      "country": "Kenya",
      "status": "Active",
      "projectName": "Solar Farm Kenya",
      "createdAt": "2024-08-30T10:00:00Z",
      "updatedAt": "2024-08-30T10:00:00Z"
    }
  ],
  "total_count": 45,
  "total": 45,
  "limit": 20,
  "offset": 0,
  "page": 1,
  "total_pages": 3,
  "has_more": true,
  "hasMore": true,
  "nextOffset": 20
}
```

## Response Fields

### Always Returned
- `data` (array) — Alias for `listings`
- `listings` (array) — Listing objects
- `total_count` (number) — Total matching listings
- `total` (number) — Alias for `total_count`
- `limit` (number) — Items per page (capped at 100)
- `offset` (number) — Current offset
- `has_more` (boolean) — More pages exist
- `hasMore` (boolean) — Alias for `has_more`

### Page-Based Only
- `page` (number) — Current page number
- `total_pages` (number) — Total pages
- `nextOffset` (number|null) — Offset of next page

### Cursor-Based Only
- `next_cursor` (string|undefined) — Opaque cursor for next page
- `prev_cursor` (string|undefined) — Opaque cursor for previous page

## Edge Cases & Validation

### Invalid Page Numbers
```bash
# page=0 → Error 400 or defaults to page=1
GET /marketplace/listings?page=0

# page=-1 → Error 400 or defaults to page=1
GET /marketplace/listings?page=-1

# page=99999 → Returns empty results (200 OK)
GET /marketplace/listings?page=99999
```

### Invalid Limits
```bash
# limit=0 → Error 400 or defaults to limit=1
GET /marketplace/listings?limit=0

# limit=-5 → Error 400 or defaults to limit=1
GET /marketplace/listings?limit=-5

# limit=abc → Error 400 or defaults to limit=20
GET /marketplace/listings?limit=abc
```

### Invalid Filters
```bash
# minPrice > maxPrice → Error 400
GET /marketplace/listings?minPrice=100&maxPrice=10

# minPrice=invalid → Error 400
GET /marketplace/listings?minPrice=invalid

# Invalid cursor → Error 400 or skipped
GET /marketplace/listings?cursor=invalid_base64
```

## Caching

Pagination results are **cached for 5 minutes** (300 seconds) per unique query.

**Cache Key:** `JSON.stringify(query)`

**Cache Invalidation:** Automatic when:
- Listings are created
- Listings are updated
- Listings are delisted
- Purchases are made

**Behavior:**
```typescript
const cacheKey = JSON.stringify(query);
const cached = await cache.get(cacheKey);
if (cached) return cached;

// ... fetch from database ...

await cache.set(cacheKey, result);
return result;
```

## Performance Considerations

### Database Query Efficiency

1. **Page-Based:** Uses `take + skip` with offset pagination
   - Time complexity: O(n) where n = offset
   - Good for: First few pages
   - Bad for: Deep pagination (page 1000)

2. **Cursor-Based:** Uses keyset pagination
   - Time complexity: O(1)
   - Good for: All positions
   - Bad for: Random access

3. **Sorting by Price:** In-memory sort
   - Limited to top 1000 matching rows
   - Time complexity: O(n log n)
   - Avoids database migration for String field

### Recommendations

| Use Case | Strategy |
|----------|----------|
| Web UI with page buttons | Page-based with `limit=20` |
| Mobile app infinite scroll | Cursor-based |
| API deep pagination | Cursor-based |
| Total count needed | Page-based or offset-based |
| Price range search | Filter first, then paginate |

### Query Patterns (Fast → Slow)

```typescript
// ✅ Fast: Single filter, page 1-3
GET /marketplace/listings?methodology=ACM0002&page=1&limit=20

// ✅ Fast: Cursor-based (any position)
GET /marketplace/listings?cursor=...&limit=20

// ⚠️ Moderate: Multiple filters, page 1-10
GET /marketplace/listings?methodology=ACM0002&country=Kenya&page=5&limit=20

// ⚠️ Slow: Sorting by price, page 1
GET /marketplace/listings?sortBy=price&page=1&limit=20

// ❌ Very Slow: Deep pagination (page 1000+)
GET /marketplace/listings?page=1000&limit=20
```

## Error Responses

### 400 Bad Request

**Invalid limit:**
```json
{
  "statusCode": 400,
  "message": "limit must be between 1 and 100",
  "error": "Bad Request"
}
```

**Invalid price range:**
```json
{
  "statusCode": 400,
  "message": "minPrice must be less than or equal to maxPrice",
  "error": "Bad Request"
}
```

**Invalid cursor:**
```json
{
  "statusCode": 400,
  "message": "Invalid cursor",
  "error": "Bad Request"
}
```

### 200 OK (Empty Results)

```json
{
  "listings": [],
  "total_count": 0,
  "limit": 20,
  "offset": 0,
  "has_more": false,
  "hasMore": false,
  "page": 99999,
  "total_pages": 0
}
```

## Integration Examples

### Example 1: Web UI - Page-Based Navigation

```typescript
// React component
const [page, setPage] = useState(1);
const [limit] = useState(20);

const fetchListings = async () => {
  const res = await fetch(`/marketplace/listings?page=${page}&limit=${limit}`);
  return res.json();
};

// Render:
// <button onClick={() => setPage(page - 1)}>Previous</button>
// <span>Page {page} of {totalPages}</span>
// <button onClick={() => setPage(page + 1)}>Next</button>
```

### Example 2: Mobile App - Infinite Scroll

```typescript
// React Native component
const [cursor, setCursor] = useState<string | null>(null);
const [listings, setListings] = useState([]);

const loadMore = async () => {
  const params = cursor 
    ? `?cursor=${cursor}&limit=20`
    : `?limit=20`;
  
  const res = await fetch(`/marketplace/listings${params}`);
  const { listings: newListings, next_cursor } = await res.json();
  
  setListings([...listings, ...newListings]);
  setCursor(next_cursor || null);
};
```

### Example 3: CLI Tool - All Results

```bash
# Fetch all listings (with pagination)
function getAllListings() {
  local page=1
  while true; do
    response=$(curl -s "https://api.carbonledger.io/marketplace/listings?page=$page&limit=100")
    listings=$(echo "$response" | jq '.listings')
    
    # Process listings...
    echo "$listings" >> all_listings.json
    
    has_more=$(echo "$response" | jq '.has_more')
    if [ "$has_more" = "false" ]; then
      break
    fi
    
    page=$((page + 1))
  done
}
```

## Testing

Run the comprehensive pagination test suite:

```bash
# Run all pagination tests
npm run test:e2e -- marketplace-pagination.e2e-spec.ts

# Run specific test group
npm run test:e2e -- marketplace-pagination.e2e-spec.ts -t "Page-Based Pagination"

# Run with verbose output
npm run test:e2e -- marketplace-pagination.e2e-spec.ts --verbose
```

**Test Coverage:**
- ✅ Page-based pagination (page 0, 1, 2, 3, out of range)
- ✅ Limit enforcement (1-100, capped, invalid values)
- ✅ Cursor-based pagination (valid, invalid, malformed)
- ✅ Offset-based pagination (0, 10, 40, out of range)
- ✅ Sorting (price asc/desc, vintage, methodology, date)
- ✅ Filtering (methodology, vintage, country, price range, search)
- ✅ Combined scenarios (page + sort + filter)
- ✅ Response structure validation
- ✅ Edge cases (null values, zero values, negative values)
- ✅ Consistency (total_count stability, no duplicate items)
- ✅ Caching behavior

## Migration from Unimplemented Pagination

If migrating from a previous unimplemented endpoint:

1. **Update client code** to use `page` or `offset` parameters
2. **Handle new response structure** with pagination metadata
3. **Adjust UI** for page navigation or cursor caching
4. **Update tests** to validate pagination fields

## Support & Troubleshooting

**Q: How do I know when to use page vs cursor pagination?**
A: Use page-based for web UIs with numbered buttons. Use cursor-based for mobile, APIs, or real-time feeds.

**Q: Why is my limit capped at 100?**
A: The 100-item limit prevents resource exhaustion and improves response time. Use pagination instead of fetching all items.

**Q: Why are my prices not sorting correctly?**
A: Prices are stored as Strings to preserve decimal precision. Sorting occurs in-memory with numeric comparison.

**Q: Can I get total_count without pagination?**
A: Yes, page-based and offset-based pagination always return `total_count`. Cursor-based does not count for performance.

**Q: How often is the cache cleared?**
A: Cache expires after 5 minutes (300 seconds) or when listings change (create, update, purchase, delist).

## Related Files

- Implementation: `backend/src/marketplace/marketplace.service.ts`
- DTOs: `backend/src/marketplace/marketplace.dto.ts`
- Utilities: `backend/src/common/cursor-pagination.ts`
- Tests: `backend/test/marketplace-pagination.e2e-spec.ts`
- Controller: `backend/src/marketplace/marketplace.controller.ts`
