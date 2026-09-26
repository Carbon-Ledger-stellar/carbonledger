# Marketplace Pagination - Quick Reference

## TL;DR

| Strategy | When to Use | Syntax |
|----------|-------------|--------|
| **Page-based** | Web UI with page buttons | `?page=2&limit=20` |
| **Offset-based** | API clients | `?offset=40&limit=20` |
| **Cursor-based** | Mobile / real-time | `?cursor=opaque_string&limit=20` |

## API Endpoint

```
GET /marketplace/listings
```

Public, rate-limited to 100 req/min per IP.

## Common Queries

### Web UI - Page 1, Page 2, Page 3

```bash
# Page 1
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20"

# Page 2
curl "https://api.carbonledger.io/marketplace/listings?page=2&limit=20"

# Page 3
curl "https://api.carbonledger.io/marketplace/listings?page=3&limit=20"
```

### Mobile - Infinite Scroll

```bash
# First request
curl "https://api.carbonledger.io/marketplace/listings?limit=20"

# Extract next_cursor from response, use in next request:
curl "https://api.carbonledger.io/marketplace/listings?cursor=eyJ...&limit=20"
```

### With Filters

```bash
# Filter by methodology and vintage
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&methodology=ACM0002&vintage=2024"

# Filter by price range
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&minPrice=5&maxPrice=20"

# Full-text search
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&search=solar"
```

### With Sorting

```bash
# Sort by price (lowest first)
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&sortBy=price&sortOrder=asc"

# Sort by price (highest first)
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&sortBy=price&sortOrder=desc"

# Sort by vintage year
curl "https://api.carbonledger.io/marketplace/listings?page=1&limit=20&sortBy=vintageYear&sortOrder=desc"
```

## Response Format

```json
{
  "listings": [
    {
      "id": "uuid",
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
      "projectName": "Solar Farm Kenya"
    }
  ],
  "total_count": 250,
  "total": 250,
  "limit": 20,
  "offset": 0,
  "page": 1,
  "total_pages": 13,
  "has_more": true,
  "hasMore": true,
  "nextOffset": 20
}
```

## Parameters

| Param | Type | Default | Max | Notes |
|-------|------|---------|-----|-------|
| `page` | int | 1 | - | Start at 1 |
| `offset` | int | 0 | - | Start at 0 |
| `limit` | int | 20 | **100** | Capped at 100 |
| `cursor` | string | - | - | Opaque, from `next_cursor` |
| `sortBy` | enum | - | - | price\|vintageYear\|methodology\|verificationDate |
| `sortOrder` | enum | asc | - | asc\|desc |
| `methodology` | string | - | - | Exact match |
| `vintage` | int | - | - | Exact match |
| `country` | string | - | - | Exact match |
| `minPrice` | string | - | - | Numeric string (e.g., "5.50") |
| `maxPrice` | string | - | - | Numeric string (e.g., "20.00") |
| `search` | string | - | - | Free-text search |

## Key Differences

### Page-Based
- Use: **Web UI with page numbers**
- Response includes: `page`, `total_pages`, `nextOffset`
- Offset calculation: `(page - 1) * limit`
- ✅ Good for: Random access, page buttons
- ❌ Bad for: Deep pagination (slow at page 1000)

### Offset-Based
- Use: **API pagination**
- Response includes: `offset`, `nextOffset`
- Calculation: Direct offset skip
- ✅ Good for: Simple iteration
- ❌ Bad for: Insertions/deletions cause drift

### Cursor-Based
- Use: **Mobile, real-time feeds**
- Response includes: `next_cursor`, `prev_cursor`
- No count query: Very efficient
- ✅ Good for: All positions, stable with changes
- ❌ Bad for: Random access

## Limits & Protection

- **Max limit:** 100 (requests for 200+ are capped)
- **Min limit:** 1
- **Default limit:** 20
- **Invalid limit:** Uses default or errors

```bash
# All capped to 100 items
curl "?page=1&limit=200"     # Returns 100 items
curl "?page=1&limit=1000"    # Returns 100 items
curl "?page=1&limit=999999"  # Returns 100 items
```

## Error Handling

### Invalid Page/Limit
```bash
# page=0 → Error 400 or defaults to 1
# page=-1 → Error 400 or defaults to 1
# limit=0 → Error 400 or defaults to 1
# limit=-5 → Error 400 or defaults to 1
```

### Invalid Filters
```bash
# minPrice > maxPrice → Error 400
# minPrice=invalid → Error 400
# Invalid cursor → Error 400 or handled gracefully
```

### Out of Range (OK)
```bash
# page=99999 → Returns [], has_more=false (200 OK)
# offset=999999 → Returns [], has_more=false (200 OK)
```

## Performance Tips

1. **Use cursor-based pagination** for infinite scroll
2. **Use page-based** for numbered page UI
3. **Limit to 20-50 items** per request for mobile
4. **Limit to 50-100 items** for web
5. **Filter before paginating** (smaller result set)
6. **Sort by indexed columns** (price sorts in-memory)
7. **Cache results** locally for 5+ minutes

## Code Examples

### JavaScript / Node.js

```javascript
// Page-based
async function getListingsPage(page, limit = 20) {
  const url = new URL('https://api.carbonledger.io/marketplace/listings');
  url.searchParams.set('page', page);
  url.searchParams.set('limit', limit);
  
  const res = await fetch(url);
  return res.json();
}

// Usage
const page1 = await getListingsPage(1);
console.log(`Page 1 of ${page1.total_pages}`);

const page2 = await getListingsPage(2);
```

### Cursor-based (React)

```jsx
import { useState, useEffect } from 'react';

export function InfiniteScroll() {
  const [listings, setListings] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadMore = async () => {
    setLoading(true);
    const params = cursor 
      ? `?cursor=${cursor}&limit=20`
      : `?limit=20`;
    
    const res = await fetch(`/marketplace/listings${params}`);
    const data = await res.json();
    
    setListings(prev => [...prev, ...data.listings]);
    setCursor(data.next_cursor || null);
    setLoading(false);
  };

  return (
    <div>
      {listings.map(l => <ListingCard key={l.id} listing={l} />)}
      <button onClick={loadMore} disabled={loading || !cursor}>
        {loading ? 'Loading...' : 'Load More'}
      </button>
    </div>
  );
}
```

### Python

```python
import requests

# Page-based
def get_listings_page(page, limit=20):
    url = 'https://api.carbonledger.io/marketplace/listings'
    params = {'page': page, 'limit': limit}
    return requests.get(url, params=params).json()

# Cursor-based
def get_all_listings():
    url = 'https://api.carbonledger.io/marketplace/listings'
    cursor = None
    
    while True:
        params = {'limit': 100}
        if cursor:
            params['cursor'] = cursor
        
        response = requests.get(url, params=params).json()
        yield from response['listings']
        
        cursor = response.get('next_cursor')
        if not cursor:
            break
```

## Fields in Response

| Field | Type | Always? | Notes |
|-------|------|---------|-------|
| `listings` | array | ✅ | Same as `data` |
| `data` | array | ✅ | Same as `listings` |
| `total_count` | number | ✅ | Total matching items |
| `total` | number | ✅ | Same as `total_count` |
| `limit` | number | ✅ | Items per page |
| `offset` | number | ✅ | Current offset |
| `has_more` | boolean | ✅ | More pages exist |
| `hasMore` | boolean | ✅ | Same as `has_more` |
| `page` | number | ✅ (page-based) | Current page |
| `total_pages` | number | ✅ (page-based) | Total pages |
| `nextOffset` | number | ✅ (page-based) | Offset of next page |
| `next_cursor` | string | ✅ (cursor-based) | For next page |
| `prev_cursor` | string | ✅ (cursor-based) | For previous page |

## Caching

- **TTL:** 5 minutes (300 seconds)
- **Key:** Query hash
- **Invalidated on:** Create, update, purchase, delist

Results are cached automatically. Same query = same results from cache.

## Testing

```bash
# Run pagination tests
npm run test:e2e -- marketplace-pagination.e2e-spec.ts

# Coverage:
# - Page-based pagination ✅
# - Offset-based pagination ✅
# - Cursor-based pagination ✅
# - Limit enforcement ✅
# - Sorting ✅
# - Filtering ✅
# - Edge cases ✅
# - Response validation ✅
# - Consistency checks ✅
```

## Related

- Full docs: `MARKETPLACE_PAGINATION.md`
- Controller: `src/marketplace/marketplace.controller.ts`
- Service: `src/marketplace/marketplace.service.ts`
- DTOs: `src/marketplace/marketplace.dto.ts`
- Tests: `test/marketplace-pagination.e2e-spec.ts`
