# Projects API Documentation

## Overview

The Projects API provides comprehensive search and filtering capabilities for carbon offset projects. It supports full-text search, multi-criteria filtering, and cursor-based pagination with sub-200ms response times.

## Base URL

```
GET /api/v1/projects
```

## Endpoints

### 1. Get All Projects (Legacy)

```http
GET /api/v1/projects
```

**Description**: Legacy endpoint for basic filtering. Maintained for backward compatibility.

**Query Parameters**:
- `methodology` (string, optional): Filter by methodology (e.g., "VCS", "GS")
- `country` (string, optional): Filter by country code (e.g., "BR", "US")
- `vintage` (string, optional): Filter by vintage year (e.g., "2023")

**Response**:
```json
[
  {
    "id": "cuid123",
    "projectId": "proj-001",
    "name": "Amazon Reforestation",
    "methodology": "VCS",
    "country": "BR",
    "status": "Verified",
    "vintageYear": 2023,
    "totalCreditsIssued": 1000,
    "totalCreditsRetired": 300,
    "createdAt": "2023-01-15T10:30:00Z",
    "updatedAt": "2023-01-15T10:30:00Z"
  }
]
```

### 2. Search Projects (Advanced)

```http
GET /api/v1/projects/search
```

**Description**: Advanced search endpoint with comprehensive filtering, full-text search, and pagination.

#### Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `search` | string | Full-text search on name and description | "sustainable forestry" |
| `methodology` | string[] | Filter by methodology(ies) | ["VCS", "GS"] |
| `country` | string[] | Filter by country code(s) | ["BR", "US"] |
| `status` | string[] | Filter by project status(es) | ["Verified", "Pending"] |
| `vintageYear` | number[] | Filter by vintage year(s) | [2022, 2023, 2024] |
| `oracleFreshness` | enum | Filter by oracle data freshness | "fresh" \| "stale" \| "unknown" |
| `cursor` | string | Pagination cursor (project ID) | "cuid123" |
| `limit` | number | Results per page (1-100, default: 20) | 50 |
| `sortBy` | string | Sort field | "createdAt" \| "vintageYear" \| "totalCreditsIssued" \| "name" |
| `sortOrder` | string | Sort order (default: "desc") | "asc" \| "desc" |

#### Status Values

- `Pending` - Project awaiting verification
- `Verified` - Project verified by accredited verifier
- `Rejected` - Project rejected due to issues
- `Suspended` - Project temporarily suspended
- `Completed` - Project completed
- `Certified` - Project certified (v2+)

#### Oracle Freshness Values

- `fresh` - Monitoring data updated within last 30 days
- `stale` - Monitoring data older than 30 days or missing
- `unknown` - No monitoring data available

#### Response Format

```json
{
  "projects": [
    {
      "id": "cuid123",
      "projectId": "proj-001",
      "name": "Amazon Reforestation",
      "description": "Large-scale reforestation project in the Amazon rainforest",
      "methodology": "VCS",
      "country": "BR",
      "projectType": "forestry",
      "status": "Verified",
      "vintageYear": 2023,
      "totalCreditsIssued": 1000,
      "totalCreditsRetired": 300,
      "metadataCid": "QmTest123",
      "verifierAddress": "0x123...",
      "ownerAddress": "0x456...",
      "coordinates": null,
      "lastMonitoringAt": "2023-12-01T10:30:00Z",
      "createdAt": "2023-01-15T10:30:00Z",
      "updatedAt": "2023-12-01T10:30:00Z"
    }
  ],
  "nextCursor": "cuid456",
  "hasMore": true,
  "total": 150
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `projects` | array | Array of project objects |
| `nextCursor` | string \| null | Cursor for next page (null if no more pages) |
| `hasMore` | boolean | Whether more results are available |
| `total` | number | Total number of matching projects |

## Usage Examples

### Basic Search

```bash
GET /api/v1/projects/search?search=forestry
```

### Filter by Methodology and Country

```bash
GET /api/v1/projects/search?methodology=VCS&country=BR
```

### Multiple Values (Arrays)

```bash
GET /api/v1/projects/search?methodology=VCS&methodology=GS&country=BR&country=US
```

### Complex Filtering

```bash
GET /api/v1/projects/search?methodology=VCS&country=BR&status=Verified&vintageYear=2023&oracleFreshness=fresh
```

### Full-Text Search with Filters

```bash
GET /api/v1/projects/search?search=sustainable&methodology=VCS&status=Verified
```

### Pagination

```bash
# First page
GET /api/v1/projects/search?limit=20

# Next page
GET /api/v1/projects/search?limit=20&cursor=cuid123
```

### Sorting

```bash
# Sort by name ascending
GET /api/v1/projects/search?sortBy=name&sortOrder=asc

# Sort by vintage year descending
GET /api/v1/projects/search?sortBy=vintageYear&sortOrder=desc
```

## Performance

### Response Times

- **Target**: < 200ms for all queries
- **Typical**: 50-150ms depending on complexity
- **Pagination**: Efficient cursor-based pagination
- **Search**: Optimized full-text search with indexing

### Database Indexes

The following database indexes ensure optimal performance:

```sql
-- Single column indexes
CREATE INDEX idx_methodology ON carbon_projects(methodology);
CREATE INDEX idx_country ON carbon_projects(country);
CREATE INDEX idx_status ON carbon_projects(status);
CREATE INDEX idx_vintage_year ON carbon_projects(vintage_year);
CREATE INDEX idx_created_at ON carbon_projects(created_at);
CREATE INDEX idx_last_monitoring_at ON carbon_projects(last_monitoring_at);

-- Composite indexes
CREATE INDEX idx_methodology_country_status ON carbon_projects(methodology, country, status);

-- Full-text search index
CREATE INDEX idx_search_name ON carbon_projects USING gin(to_tsvector('english', name));
CREATE INDEX idx_search_description ON carbon_projects USING gin(to_tsvector('english', description));
```

### Performance Tips

1. **Use specific filters**: More specific filters = faster queries
2. **Limit page size**: Use appropriate `limit` values (default: 20, max: 100)
3. **Cursor pagination**: Use cursor-based pagination for large datasets
4. **Avoid wildcards**: Full-text search handles relevance automatically
5. **Combine filters**: Multiple filters are more efficient than post-filtering

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": ["limit must not be greater than 100"],
  "error": "Bad Request"
}
```

#### 422 Unprocessable Entity
```json
{
  "statusCode": 422,
  "message": ["vintageYear must be between 1990 and current year + 1"],
  "error": "Unprocessable Entity"
}
```

#### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

### Validation Rules

- `limit`: Must be between 1 and 100
- `vintageYear`: Must be between 1990 and current year + 1
- `methodology`, `country`, `status`, `vintageYear`: Support multiple values
- `cursor`: Must be a valid project ID if provided
- `sortBy`: Must be one of allowed fields
- `sortOrder`: Must be "asc" or "desc"

## Rate Limiting

- **Standard**: 100 requests per minute per IP
- **Authenticated**: 1000 requests per minute per user
- **Burst**: Up to 10 requests per second

## Caching

- **Cache TTL**: 5 minutes for search results
- **Cache Key**: Based on query parameters
- **Cache Invalidation**: Manual or on project updates

## SDK Examples

### JavaScript/TypeScript

```typescript
interface SearchParams {
  search?: string;
  methodology?: string[];
  country?: string[];
  status?: ('Pending' | 'Verified' | 'Rejected' | 'Suspended' | 'Completed' | 'Certified')[];
  vintageYear?: number[];
  oracleFreshness?: 'fresh' | 'stale' | 'unknown';
  cursor?: string;
  limit?: number;
  sortBy?: 'createdAt' | 'vintageYear' | 'totalCreditsIssued' | 'name';
  sortOrder?: 'asc' | 'desc';
}

interface SearchResponse {
  projects: Project[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}

async function searchProjects(params: SearchParams): Promise<SearchResponse> {
  const queryParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => queryParams.append(key, v.toString()));
    } else if (value !== undefined) {
      queryParams.append(key, value.toString());
    }
  });
  
  const response = await fetch(`/api/v1/projects/search?${queryParams}`);
  return response.json();
}

// Example usage
const results = await searchProjects({
  search: 'sustainable forestry',
  methodology: ['VCS'],
  country: ['BR'],
  status: ['Verified'],
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc'
});
```

### Python

```python
import requests
from typing import List, Optional, Dict, Any

def search_projects(
    search: Optional[str] = None,
    methodology: Optional[List[str]] = None,
    country: Optional[List[str]] = None,
    status: Optional[List[str]] = None,
    vintage_year: Optional[List[int]] = None,
    oracle_freshness: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = 20,
    sort_by: str = 'createdAt',
    sort_order: str = 'desc'
) -> Dict[str, Any]:
    params = {}
    
    if search:
        params['search'] = search
    if methodology:
        params['methodology'] = methodology
    if country:
        params['country'] = country
    if status:
        params['status'] = status
    if vintage_year:
        params['vintageYear'] = vintage_year
    if oracle_freshness:
        params['oracleFreshness'] = oracle_freshness
    if cursor:
        params['cursor'] = cursor
    if limit != 20:
        params['limit'] = limit
    if sort_by != 'createdAt':
        params['sortBy'] = sort_by
    if sort_order != 'desc':
        params['sortOrder'] = sort_order
    
    response = requests.get('/api/v1/projects/search', params=params)
    response.raise_for_status()
    return response.json()

# Example usage
results = search_projects(
    search='sustainable forestry',
    methodology=['VCS'],
    country=['BR'],
    status=['Verified'],
    limit=50
)
```

## Testing

### Performance Tests

Run the performance test suite:

```bash
npm run test:performance -- projects
```

### Unit Tests

Run the unit test suite:

```bash
npm run test -- projects
```

### Integration Tests

Run integration tests:

```bash
npm run test:e2e -- projects
```

## Monitoring

### Key Metrics

- **Response Time**: Average, P95, P99
- **Throughput**: Requests per second
- **Error Rate**: Percentage of failed requests
- **Cache Hit Rate**: Percentage of cache hits
- **Database Query Time**: Average query duration

### Alerts

- Response time > 300ms
- Error rate > 5%
- Database query time > 100ms
- Cache hit rate < 80%

## Changelog

### v2.0.0
- Added advanced search endpoint
- Full-text search support
- Cursor-based pagination
- Oracle freshness filtering
- Performance optimizations
- Comprehensive indexing

### v1.0.0
- Basic project listing
- Simple filtering
- Legacy endpoint
