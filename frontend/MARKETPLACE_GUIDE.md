# Marketplace Trading Interface Guide

## Overview

The CarbonLedger Marketplace provides a comprehensive trading interface for buying and selling verified carbon credits on the Stellar blockchain. Users can browse, filter, compare, and purchase credits with Freighter wallet integration for seamless blockchain transactions.

**Issue Reference**: #1026

## Features

### 1. **Listings Grid**

The marketplace displays a virtualized grid of carbon credit listings with:
- **Project Information**: Name, country, location on interactive map
- **Carbon Details**: Methodology, vintage year, available tonnes
- **Pricing**: Price per tonne in USDC
- **Verification Status**: Verification date and methodology

**Performance**: Uses virtualized rendering for efficient display of large datasets (100+ listings).

### 2. **Search and Filter**

#### Quick Filters
- **Country**: Brazil, Indonesia, Kenya, India, Colombia, Peru, USA
- **Methodology**: VCS, Gold Standard, ACR, CAR, Plan Vivo
- **Project Type**: Reforestation, DAC, Renewable Energy, Methane Capture, Blue Carbon, Agroforestry, Soil Carbon, Waste to Energy, Forest Conservation

#### Advanced Refinement (Sidebar)
- **Price Range**: Min-max slider for USDC price per tonne
- **Carbon Reduction**: Min-max tonnes available
- **Vintage Year Range**: Filter by credit vintage years
- **Verifiers**: Multi-select verifier organizations
- **Availability**: "Available now" checkbox for instant availability

#### Search
- **Autocomplete**: Project names, countries, methodologies
- **Highlighting**: Matched text highlighted in results
- **Suggestions**: Auto-generated from current listings

### 3. **Sorting**

Sort listings by:
- **Price**: Low to high or high to low
- **Date Listed**: Newest or oldest first
- **Popularity**: Most viewed or traded
- **Default**: Price ascending (lowest first)

All sort preferences are saved in URL params for shareable views.

### 4. **Add to Cart**

- **Single Add**: Add individual listings to cart
- **Bulk Purchase**: Cart supports multiple listings
- **Visual Feedback**: Item shows "In Cart" button state
- **Cart Count Badge**: Header shows total items

### 5. **Comparison Tool**

- **Select Up to 4 Listings**: Compare checkboxes on each item
- **Comparison Tray**: Side-by-side view at bottom of page
- **Quick Compare**: View key metrics of selected credits
- **Remove**: Easily remove items from comparison

### 6. **Interactive Map**

- **Project Locations**: Pins on world map showing credit origins
- **Zoom and Pan**: Explore regions of interest
- **Click to Details**: Map pins link to project details
- **Missing Coordinates Fallback**: Graceful handling of unmapped projects

### 7. **Purchase Flow**

#### Option A: Direct Purchase
```
Listing → Buy Now → Freighter Connection → Transaction Confirmation
```

#### Option B: Cart Purchase
```
Add to Cart → View Cart → Freighter Connection → Bulk Transaction Confirmation
```

### 8. **Freighter Wallet Integration**

The purchase flow integrates with [Freighter Wallet](https://developers.stellar.org/tools/wallets/freighter) for:
- **Wallet Connection**: One-click Freighter authorization
- **Transaction Signing**: User confirms transaction details
- **USDC Payment**: Automatic settlement in USDC stablecoin
- **Blockchain Settlement**: Credits transferred to user account on Stellar
- **Transaction Receipt**: Confirmation with transaction hash

### 9. **Transaction Confirmation**

After purchase, users receive:
- **Confirmation Toast**: Success notification
- **Order Summary**: Credits received, amount paid
- **Transaction Hash**: Stellar network transaction ID
- **Order Status**: Real-time status updates
- **Receipt**: Downloadable proof of purchase

## Technical Architecture

### Data Flow

```
API → useListings Hook → VirtualizedList → Listing Component
                ↓
            Filters/Sort
                ↓
            Client-side Refinement
                ↓
            Displayed Results
```

### State Management

- **Filters**: URL-based (shareable, bookmarkable)
- **Refinements**: URL-based (advanced filters)
- **Sort**: URL-based (price, date, popularity)
- **Cart**: Client-side store (useCartStore hook)
- **Comparison**: Local component state

### API Integration

**GET `/api/v1/marketplace/listings`**

Query Parameters:
- `country` — Filter by country
- `methodology` — Filter by carbon methodology
- `vintage` — Filter by vintage year
- `minPrice` — Minimum price per tonne
- `maxPrice` — Maximum price per tonne
- `projectType` — Filter by project type
- `search` — Search project names
- `sortBy` — "price", "vintageYear", "methodology", "verificationDate"
- `sortOrder` — "asc" or "desc"
- `limit` — Results per page (default: 100)

**GET `/api/v1/projects/map`**

Returns project coordinates for map visualization.

### Performance Optimizations

1. **Virtualized Rendering**: Only visible items rendered (typical viewport: 6-8 items)
2. **Lazy Loading**: Heavy components (charts, maps) loaded on-demand
3. **Auto-refresh**: Prices refreshed every 30 seconds
4. **Debounced Search**: Input debounced before API call
5. **Client-side Filtering**: Refinements applied locally (instant feedback)

## User Workflows

### Workflow 1: Browse and Filter

```
1. User lands on /marketplace
2. Sees all listings sorted by price (default)
3. Filters by country (e.g., Brazil)
4. Further filters by methodology (e.g., VCS)
5. Results update in real-time
6. URL changes to: ?country=Brazil&methodology=VCS (shareable)
```

### Workflow 2: Search and Compare

```
1. User searches for "reforestation" (autocomplete shows suggestions)
2. Results filtered to matching projects
3. User selects 3 listings for comparison
4. Comparison tray shows side-by-side metrics
5. User clicks "Buy Now" on preferred listing
```

### Workflow 3: Cart Purchase

```
1. User adds 5 listings to cart
2. Cart badge shows "🛒 5 items"
3. User clicks cart link → /buy/cart
4. Reviews cart items, total price
5. Connects Freighter wallet
6. Signs transaction (USDC payment)
7. Stellar network processes transaction
8. Credits deposited to user account
9. Confirmation page shows receipt
```

## URL Parameters

### Bookmark Shareable Filtered Views

```
/marketplace?country=Brazil&methodology=VCS&sort=price&order=asc
/marketplace?search=solar&minPrice=10&maxPrice=50
```

### URL Parameter Reference

| Parameter | Example | Description |
|-----------|---------|-------------|
| `country` | Brazil | Filter by country |
| `methodology` | VCS | Filter by methodology |
| `vintageYear` | 2023 | Filter by vintage year |
| `minPrice` | 25.00 | Minimum price per tonne |
| `maxPrice` | 75.00 | Maximum price per tonne |
| `projectType` | Reforestation | Filter by project type |
| `search` | solar | Search project names |
| `sort` | price | Sort field |
| `order` | asc | Sort direction (asc/desc) |
| `availableOnly` | true | Show only available now |
| `verifiers` | VCS,Gold | Verifier filter (comma-separated) |

## Mobile Experience

### Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| < 768px | Single column (full-width) |
| ≥ 768px | Two column (sidebar + content) |
| ≥ 1200px | Optimized container width |

### Mobile Optimizations

- **Touch Targets**: 44px minimum tap area
- **Text Truncation**: Ellipsis for long project names
- **Simplified Filters**: Essential filters only on mobile
- **Sticky Header**: Cart button always visible
- **Virtual Scrolling**: Smooth scroll performance

## Accessibility

### Keyboard Navigation

- `Tab`: Navigate filters, buttons, links
- `Enter/Space`: Activate buttons, checkboxes
- `Arrow Keys`: Navigate dropdowns (if implemented)

### Screen Reader Support

- ARIA labels on checkboxes: "Compare [project name]"
- Live region for results: `aria-live="polite"`
- Semantic HTML: `<button>`, `<select>`, proper `<label>` associations
- Form labels clearly associated with inputs

### Translation (i18n)

The marketplace is fully internationalized:

```typescript
const t = useTranslations("marketplace");
t("title")          // Marketplace
t("subtitle")       // Subtitle text
t("buyNow")         // Buy Now button
t("addToCart")      // Add to Cart button
t("inCart")         // In Cart (button state)
t("clearFilters")   // Clear Filters button
```

## Error Handling

### Listing Fetch Error

If the API fails to load listings:
- **Error State**: "Failed to load listings"
- **Retry Button**: User can retry the fetch
- **Fallback UI**: Error boundary catches exceptions

### Empty Results

- **All Listings**: "No listings available" message
- **After Filter**: "No projects match your search" with clear filters option

### Missing Coordinates

- **Map**: "X projects do not have location data"
- **Fallback**: Map still renders, non-mapped items excluded

## Testing

### Unit Tests

See `__tests__/marketplace.spec.ts` for comprehensive test coverage including:
- Listings grid rendering
- Search and filter functionality
- Add to cart operations
- Sorting and comparison
- Mobile responsiveness
- Accessibility
- Error handling

### Manual Testing Checklist

- [ ] Load marketplace at `/marketplace`
- [ ] Verify listings display with images (map)
- [ ] Test each filter (country, methodology, vintage)
- [ ] Verify search autocomplete
- [ ] Sort by price, date, popularity
- [ ] Add items to cart
- [ ] Compare 3 listings
- [ ] Test on mobile (< 768px) for responsive layout
- [ ] Click "Buy Now" and verify /buy page loads
- [ ] Click cart and verify /buy/cart page loads
- [ ] Check URL parameters sync with filters

## Configuration

### Environment Variables

```bash
# Frontend API endpoint
NEXT_PUBLIC_API_URL=https://api.carbon-ledger.com/api/v1

# Freighter wallet config (defaults to mainnet)
NEXT_PUBLIC_FREIGHTER_NETWORK=testnet  # or mainnet
```

### Listing Limits

```typescript
// app/marketplace/page.tsx
const LISTING_ROW_HEIGHT = 96;           // Height per virtualized item
const LISTING_VIEWPORT_HEIGHT = 640;     // Viewport height
```

### Comparison Limit

```typescript
// components/ComparisonTray.tsx
export const MAX_COMPARISON_ITEMS = 4;   // Maximum comparisons
```

## Related Features

- **[Project Browser](#)** (Issue #1025) — Browse verified projects
- **[API Request Logging](#)** (Issue #1020) — API request monitoring
- **[CORS Configuration](#)** (Issue #1021) — Cross-origin setup

## Future Enhancements

- [ ] Real-time price ticker
- [ ] Price alerts ("notify me if drops below X")
- [ ] Favorites/watchlist
- [ ] Purchase history
- [ ] Portfolio tracking
- [ ] Batch operations
- [ ] Advanced charting (TradingView widget)
- [ ] API for programmatic access
- [ ] Mobile app

## Support

### Common Issues

**Q: Credits not appearing in cart**
A: Check browser storage (localStorage). Clear cache and retry.

**Q: Freighter wallet not connecting**
A: Ensure Freighter is installed, network is correct (testnet/mainnet).

**Q: Prices look stale**
A: Prices refresh every 30 seconds. Refresh page for manual update.

**Q: Filter not working**
A: Check URL params and API response. Verify API is accessible.

### Contact

For issues with the marketplace, file a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if applicable)
- Browser/device info

## References

- [Stellar Documentation](https://developers.stellar.org/)
- [Freighter Wallet Integration](https://developers.stellar.org/tools/wallets/freighter)
- [USDC on Stellar](https://stellar.org/usdc)
- [MDN Virtual Scrolling](https://developer.mozilla.org/en-US/docs/Web/Performance/Rendering_performance)
