#!/usr/bin/env python3
"""Create 90 comprehensive GitHub issues for CarbonLedger across all tech stack areas"""
import subprocess
import time

REPO = "Carbon-Ledger-stellar/carbonledger"

ISSUES = [
    # SMART CONTRACT ISSUES (15 issues)
    {
        "title": "[Smart Contract] Add stream expiry / auto-close after end_ledger",
        "body": """## Overview
Completed streams linger in storage indefinitely, wasting rent. Automatically clean up schedules once fully claimed past end_ledger.

## Proposed Change
In claim_vested, if current_ledger >= end_ledger and balance is fully claimed, delete the storage entry and emit StreamCompleted.

## Acceptance Criteria
- Storage entry removed on final claim
- get_schedule returns None after completion
- Test verifies storage is cleared""",
        "labels": ["smart-contracts", "rust", "performance", "good-first-issue"]
    },
    {
        "title": "[Smart Contract] Implement pausable token transfers with emergency stop",
        "body": """## Overview
Add ability to pause all token transfers during security incidents or maintenance.

## Proposed Change
Add pause/unpause functions restricted to admin. All transfer functions check pause state.

## Acceptance Criteria
- pause() restricts to admin only
- All transfers blocked when paused
- unpause() restores functionality
- Event emitted on pause/unpause
- Unit tests cover pause scenarios""",
        "labels": ["smart-contracts", "rust", "security", "good-first-issue"]
    },
    {
        "title": "[Smart Contract] Add batch credit retirement with single tx",
        "body": """## Overview
Allow retiring multiple credit batches in a single transaction for efficiency.

## Proposed Change
Implement batch_retire that accepts array of batch IDs and amounts.

## Acceptance Criteria
- Accepts Vec<RetireRequest>
- Atomic operation (all or nothing)
- Gas optimized for batch operations
- Error if any batch invalid""",
        "labels": ["smart-contracts", "rust", "performance"]
    },
    {
        "title": "[Smart Contract] Implement role-based permissions with tiered access",
        "body": """## Overview
Create granular permission system with roles: Admin, Verifier, Oracle, Operator.

## Proposed Change
Add Role enum and permission matrix. Each function checks required role.

## Acceptance Criteria
- 4 role levels defined
- Permission matrix documented
- All functions enforce roles
- Tests verify access control""",
        "labels": ["smart-contracts", "rust", "security"]
    },
    {
        "title": "[Smart Contract] Add credit transfer with escrow for marketplace safety",
        "body": """## Overview
Implement escrow mechanism for safer marketplace transactions.

## Proposed Change
Add escrow_transfer with 3-phase: lock, verify, release.

## Acceptance Criteria
- Phase 1: Credits locked
- Phase 2: Buyer verifies receipt
- Phase 3: Release to buyer
- Timeout mechanism for release""",
        "labels": ["smart-contracts", "rust", "marketplace"]
    },
    {
        "title": "[Smart Contract] Implement credit fractional ownership and splits",
        "body": """## Overview
Allow splitting credits into fractional ownership for shared retirement.

## Proposed Change
Add split function to divide credit batch by ownership percentages.

## Acceptance Criteria
- Split maintains serial number chain
- Ownership percentages tracked
- Joint retirement supported
- Tests verify fraction arithmetic""",
        "labels": ["smart-contracts", "rust", "feature"]
    },
    {
        "title": "[Smart Contract] Add multi-sig approval for high-value operations",
        "body": """## Overview
Require multiple signatures for sensitive operations (large transfers, parameter changes).

## Proposed Change
Implement M-of-N multi-signature vault.

## Acceptance Criteria
- Configurable threshold (M of N)
- Support 2-of-3, 3-of-5 scenarios
- Tests verify threshold logic""",
        "labels": ["smart-contracts", "rust", "security"]
    },
    {
        "title": "[Smart Contract] Implement credit coupon/voucher system",
        "body": """## Overview
Create redeemable vouchers for credit promotions and discounts.

## Proposed Change
Add Coupon struct with expiry and redemption tracking.

## Acceptance Criteria
- Coupon creation with expiry
- Redemption tracking
- Prevention of double-redemption
- Tests verify lifecycle""",
        "labels": ["smart-contracts", "rust", "marketplace"]
    },
    {
        "title": "[Smart Contract] Add credit swap with AMM pricing model",
        "body": """## Overview
Implement constant-product AMM for credit-to-credit swaps.

## Proposed Change
Use (x * y = k) model for methodological credit exchanges.

## Acceptance Criteria
- Constant product maintained
- Slippage calculation accurate
- Tests verify pricing""",
        "labels": ["smart-contracts", "rust", "advanced"]
    },
    {
        "title": "[Smart Contract] Implement credit insurance/guarantee system",
        "body": """## Overview
Add optional insurance covering early retirement penalties or project failure.

## Proposed Change
Create InsurancePool with premium tracking and payout logic.

## Acceptance Criteria
- Premium collection logic
- Payout mechanism
- Reserve requirement verification
- Tests cover all scenarios""",
        "labels": ["smart-contracts", "rust", "feature"]
    },
    {
        "title": "[Smart Contract] Add temporal lock for credit time-locking",
        "body": """## Overview
Implement time-locks preventing credit transfers until unlock_time.

## Proposed Change
Add TemporalLock tracking with enforced transfer restrictions.

## Acceptance Criteria
- Lock creation with unlock_time
- Transfer blocked before unlock
- Lock removal on unlock
- Events emitted properly""",
        "labels": ["smart-contracts", "rust", "security"]
    },
    {
        "title": "[Smart Contract] Implement credit staking with rewards",
        "body": """## Overview
Allow staking credits to earn reward tokens.

## Proposed Change
Add staking pool with APY calculation and reward distribution.

## Acceptance Criteria
- APY configurable
- Reward calculation accurate
- Unstaking with accrued rewards
- Tests verify calculations""",
        "labels": ["smart-contracts", "rust", "defi"]
    },
    {
        "title": "[Smart Contract] Add credit-backed loan functionality",
        "body": """## Overview
Allow borrowing stablecoins using credits as collateral.

## Proposed Change
Implement LoanPool with LTV (Loan-to-Value) enforcement.

## Acceptance Criteria
- LTV enforcement
- Liquidation mechanism
- Interest accrual
- Tests cover edge cases""",
        "labels": ["smart-contracts", "rust", "advanced"]
    },
    {
        "title": "[Smart Contract] Implement credit derivative/futures contracts",
        "body": """## Overview
Create futures contracts for forward credit purchase guarantees.

## Proposed Change
Add Futures struct with settlement and expiry logic.

## Acceptance Criteria
- Contract creation with delivery date
- Settlement logic
- Price locking
- Tests verify lifecycle""",
        "labels": ["smart-contracts", "rust", "advanced"]
    },
    {
        "title": "[Smart Contract] Add governance voting using credit holdings",
        "body": """## Overview
Implement DAO-style voting proportional to credit ownership.

## Proposed Change
Add Proposal and Vote tracking with execution.

## Acceptance Criteria
- Voting power = credit holdings
- Timelock before execution
- Threshold requirements
- Tests verify voting logic""",
        "labels": ["smart-contracts", "rust", "governance"]
    },

    # BACKEND API ISSUES (15 issues)
    {
        "title": "[Backend] Implement GraphQL API for credit queries",
        "body": """## Overview
Create GraphQL API for efficient credit data queries with filtering and pagination.

## Proposed Change
Add GraphQL schema for Credit, Project, Retirement types.

## Acceptance Criteria
- Full CRUD operations
- Filtering by status, project, vintage
- Cursor-based pagination
- Performance < 200ms for typical queries""",
        "labels": ["backend", "api", "graphql", "good-first-issue"]
    },
    {
        "title": "[Backend] Add Redis caching layer for frequently accessed data",
        "body": """## Overview
Implement Redis caching to reduce database load for project listings and prices.

## Proposed Change
Cache projects, prices with 5-min TTL, invalidate on updates.

## Acceptance Criteria
- Cache hit rate > 70% for listings
- TTL properly configured
- Cache invalidation on mutations
- Fallback if cache unavailable""",
        "labels": ["backend", "performance", "caching", "good-first-issue"]
    },
    {
        "title": "[Backend] Implement webhook system for event notifications",
        "body": """## Overview
Allow external systems to subscribe to credit lifecycle events.

## Proposed Change
Add webhook registration, delivery, and retry logic.

## Acceptance Criteria
- Webhook registration endpoint
- Event delivery with retries
- HMAC signature verification
- Dead-letter queue for failed events""",
        "labels": ["backend", "api", "integration"]
    },
    {
        "title": "[Backend] Add request validation and sanitization",
        "body": """## Overview
Implement comprehensive input validation for all API endpoints.

## Proposed Change
Add validators for credit amounts, project IDs, beneficial names.

## Acceptance Criteria
- All inputs validated
- SQL injection prevention
- XSS protection
- Error messages non-leaky""",
        "labels": ["backend", "security", "good-first-issue"]
    },
    {
        "title": "[Backend] Implement rate limiting per user/IP",
        "body": """## Overview
Prevent abuse with per-user and per-IP rate limits.

## Proposed Change
Implement sliding window rate limiter using Redis.

## Acceptance Criteria
- Configurable limits (e.g., 100 req/min)
- 429 response with Retry-After header
- Bypass for authenticated users
- Admin override capability""",
        "labels": ["backend", "security", "api"]
    },
    {
        "title": "[Backend] Add distributed tracing with OpenTelemetry",
        "body": """## Overview
Implement request tracing across services for debugging.

## Proposed Change
Add OpenTelemetry instrumentation to NestJS services.

## Acceptance Criteria
- Trace IDs propagated
- Database queries traced
- Distributed context preserved
- Exports to Jaeger""",
        "labels": ["backend", "observability", "devops"]
    },
    {
        "title": "[Backend] Implement JWT token refresh mechanism",
        "body": """## Overview
Replace long-lived tokens with short-lived + refresh token pattern.

## Proposed Change
Issue 15-min access tokens, 7-day refresh tokens.

## Acceptance Criteria
- Access token expiry: 15 min
- Refresh token expiry: 7 days
- Token revocation on logout
- Refresh endpoint returns new tokens""",
        "labels": ["backend", "security", "auth"]
    },
    {
        "title": "[Backend] Add audit trail for all state changes",
        "body": """## Overview
Log all mutations for compliance and debugging.

## Proposed Change
Create AuditLog model tracking user, action, before/after values.

## Acceptance Criteria
- Every mutation logged
- User attribution
- Before/after state recorded
- Queryable via admin API""",
        "labels": ["backend", "compliance", "database"]
    },
    {
        "title": "[Backend] Implement soft deletes for data retention",
        "body": """## Overview
Preserve data with soft deletes for audit and recovery.

## Proposed Change
Add deletedAt field to Credit, Project, Retirement models.

## Acceptance Criteria
- Soft delete implementation
- Default queries exclude deleted
- Admin recovery endpoint
- Audit logs preserved""",
        "labels": ["backend", "database", "compliance"]
    },
    {
        "title": "[Backend] Add bulk operations endpoint for efficiency",
        "body": """## Overview
Support batch operations (e.g., retire 1000+ credits in one request).

## Proposed Change
Implement /api/bulk-retire accepting credit IDs array.

## Acceptance Criteria
- Atomic transaction
- Performance improved 10x for bulk ops
- Error reporting per item
- Size limit enforced (max 1000 items)""",
        "labels": ["backend", "performance", "api"]
    },
    {
        "title": "[Backend] Implement comprehensive error handling",
        "body": """## Overview
Standardize error responses with clear, actionable messages.

## Proposed Change
Add global exception filter returning ErrorResponse.

## Acceptance Criteria
- Consistent error format
- HTTP status codes correct
- Error codes standardized
- Detailed messages for 4xx, generic for 5xx""",
        "labels": ["backend", "api", "ux", "good-first-issue"]
    },
    {
        "title": "[Backend] Add data export functionality (CSV, JSON)",
        "body": """## Overview
Allow users to export credit and retirement data for ESG reporting.

## Proposed Change
Add export endpoint supporting multiple formats.

## Acceptance Criteria
- CSV export working
- JSON export working
- Filtered export by date range
- Performance acceptable for 10k+ records""",
        "labels": ["backend", "api", "feature"]
    },

    # FRONTEND ISSUES (20 issues)
    {
        "title": "[Frontend] Implement Freighter wallet integration",
        "body": """## Overview
Integrate Stellar Freighter wallet for user authentication.

## Proposed Change
Use Freighter API for wallet connection and transaction signing.

## Acceptance Criteria
- Wallet connection button functional
- Public key retrieved and stored
- Transaction signing works
- Tests cover connection flow""",
        "labels": ["frontend", "blockchain", "wallet", "good-first-issue"]
    },
    {
        "title": "[Frontend] Build project registration form with validation",
        "body": """## Overview
Create form for carbon project registration with client-side validation.

## Proposed Change
Multi-step form with fields: name, methodology, country, coordinates.

## Acceptance Criteria
- Form validates inputs
- Real-time error display
- Submit enabled only when valid
- Success confirmation message""",
        "labels": ["frontend", "forms", "ux", "good-first-issue"]
    },
    {
        "title": "[Frontend] Implement credit marketplace grid view",
        "body": """## Overview
Display available carbon credits in filterable, sortable grid.

## Proposed Change
Add CardGrid component with Filter, Sort controls.

## Acceptance Criteria
- Grid responsive on mobile/desktop
- Filters by methodology, vintage, country
- Sorting by price, date, seller rating
- Lazy loading for 1000+ credits""",
        "labels": ["frontend", "ui", "performance"]
    },
    {
        "title": "[Frontend] Build credit purchase checkout flow",
        "body": """## Overview
Implement checkout: select → review → confirm → pay.

## Proposed Change
Add CheckoutModal with 3 steps.

## Acceptance Criteria
- Step navigation working
- Order summary accurate
- Payment confirmation
- Error handling for failed txs""",
        "labels": ["frontend", "checkout", "ux"]
    },
    {
        "title": "[Frontend] Create retirement certificate PDF generator",
        "body": """## Overview
Generate downloadable retirement certificate with QR code.

## Proposed Change
Use jsPDF to create certificate from retirement data.

## Acceptance Criteria
- PDF generated with project info
- QR code links to audit trail
- Certificate design professional
- Mobile download works""",
        "labels": ["frontend", "feature", "pdf"]
    },
    {
        "title": "[Frontend] Implement dark mode toggle",
        "body": """## Overview
Add dark/light theme toggle with localStorage persistence.

## Proposed Change
Use Tailwind dark mode with theme context.

## Acceptance Criteria
- Toggle visible in navbar
- Theme persists on refresh
- All components support both modes
- Contrast ratios meet WCAG AA""",
        "labels": ["frontend", "ux", "accessibility", "good-first-issue"]
    },
    {
        "title": "[Frontend] Build analytics dashboard with charts",
        "body": """## Overview
Create dashboard showing credit statistics and trends.

## Proposed Change
Use Chart.js/Recharts for credit volume, retirement trends.

## Acceptance Criteria
- Charts responsive
- Data updates in real-time
- Legend and tooltips working
- Mobile-friendly rendering""",
        "labels": ["frontend", "dashboard", "charts"]
    },
    {
        "title": "[Frontend] Implement serial number lookup tool",
        "body": """## Overview
Allow searching for credit by serial number to verify provenance.

## Proposed Change
Add search box with results showing full history.

## Acceptance Criteria
- Search returns correct credit
- History timeline displayed
- No wallet required (public)
- Performance < 500ms""",
        "labels": ["frontend", "audit", "feature"]
    },
    {
        "title": "[Frontend] Add loading skeletons for better UX",
        "body": """## Overview
Replace blank spaces with animated skeletons while loading.

## Proposed Change
Create Skeleton components for card, table, grid.

## Acceptance Criteria
- Skeletons match final layout
- Smooth animation
- Reduces perceived latency
- Works on all breakpoints""",
        "labels": ["frontend", "ux", "performance", "good-first-issue"]
    },
    {
        "title": "[Frontend] Implement advanced filtering system",
        "body": """## Overview
Add multi-criteria filtering for credit search.

## Proposed Change
Build filter panel with price range, date, methodology, vintage.

## Acceptance Criteria
- All filters functional
- Filters combine with AND logic
- URL state reflects filters
- Mobile filter drawer""",
        "labels": ["frontend", "ui", "search"]
    },
    {
        "title": "[Frontend] Build user dashboard with portfolio overview",
        "body": """## Overview
Create personalized dashboard showing user's credits and retirements.

## Proposed Change
Add Portfolio component with widgets: balance, retired, pending.

## Acceptance Criteria
- Dashboard loads user data
- Real-time balance updates
- Portfolio history visible
- Download export available""",
        "labels": ["frontend", "dashboard", "feature"]
    },
    {
        "title": "[Frontend] Implement toast notifications system",
        "body": """## Overview
Display non-blocking notifications for actions and errors.

## Proposed Change
Add Toast component with context provider.

## Acceptance Criteria
- Success, error, warning, info types
- Auto-dismiss after 5s
- Manual dismiss button
- Stacking behavior correct""",
        "labels": ["frontend", "components", "ux", "good-first-issue"]
    },
    {
        "title": "[Frontend] Create project detail page with metrics",
        "body": """## Overview
Show full project information, verification status, credit supply.

## Proposed Change
Add ProjectDetail page with verifier info, monitoring timeline.

## Acceptance Criteria
- All project fields displayed
- Verification badge shown
- Monitoring timeline visible
- Link to credits issued by project""",
        "labels": ["frontend", "pages", "feature"]
    },
    {
        "title": "[Frontend] Add search with autocomplete",
        "body": """## Overview
Implement search suggestions for projects and credits.

## Proposed Change
Add Autocomplete with API debouncing.

## Acceptance Criteria
- Suggestions appear after 2 chars
- Keyboard navigation working
- Results accurate and relevant
- No lag with 1000+ items""",
        "labels": ["frontend", "search", "ux"]
    },
    {
        "title": "[Frontend] Implement breadcrumb navigation",
        "body": """## Overview
Add breadcrumbs for navigation clarity on nested pages.

## Proposed Change
Create Breadcrumb component with dynamic generation from routes.

## Acceptance Criteria
- Breadcrumbs auto-generated
- Last item not clickable
- Responsive on mobile (collapse to >)
- Linked correctly""",
        "labels": ["frontend", "navigation", "ux", "good-first-issue"]
    },
    {
        "title": "[Frontend] Add transaction history table with sorting",
        "body": """## Overview
Display user's transaction history with filters and export.

## Proposed Change
Create TransactionTable with sortable columns.

## Acceptance Criteria
- Columns: date, type, amount, status
- Sort by each column
- Pagination for 1000+ items
- Export to CSV""",
        "labels": ["frontend", "tables", "data"]
    },
    {
        "title": "[Frontend] Implement lazy image loading",
        "body": """## Overview
Defer image loading for performance improvement.

## Proposed Change
Use Intersection Observer for lazy loading.

## Acceptance Criteria
- Images load as scrolled into view
- Placeholder shown before load
- Performance improvement measured
- Works on all images""",
        "labels": ["frontend", "performance", "good-first-issue"]
    },
    {
        "title": "[Frontend] Build verification badge component",
        "body": """## Overview
Create reusable component showing project verification status.

## Proposed Change
Add VerificationBadge with verifier info tooltip.

## Acceptance Criteria
- Badge design clear
- Tooltip shows verifier details
- Verified/Unverified states
- Reusable across app""",
        "labels": ["frontend", "components", "ui"]
    },
    {
        "title": "[Frontend] Add keyboard shortcuts for power users",
        "body": """## Overview
Implement keyboard navigation for common actions.

## Proposed Change
Add shortcuts: /search, ?help, s/save, d/delete, etc.

## Acceptance Criteria
- Shortcuts documented in help
- Non-intrusive implementation
- Works in modals and tables
- Disable in input fields""",
        "labels": ["frontend", "ux", "accessibility"]
    },

    # BACKEND DATABASE ISSUES (10 issues)
    {
        "title": "[Database] Add missing indexes for query optimization",
        "body": """## Overview
Identify and add indexes for slow queries.

## Proposed Change
Index: Project(status, createdAt), Credit(projectId, status).

## Acceptance Criteria
- Query performance improved 50%+
- Migration reversible
- Indexes documented
- No negative impact on writes""",
        "labels": ["database", "performance", "good-first-issue"]
    },
    {
        "title": "[Database] Implement query result caching at ORM level",
        "body": """## Overview
Add Prisma middleware for automatic query caching.

## Proposed Change
Cache frequent queries with 5-min TTL.

## Acceptance Criteria
- Cache hit rate > 60%
- Invalidation on mutations
- Performance improved 40%+
- Metrics logged""",
        "labels": ["database", "caching", "performance"]
    },
    {
        "title": "[Database] Create partitioning strategy for large tables",
        "body": """## Overview
Partition credit and transaction tables by date for scalability.

## Proposed Change
Implement time-based partitioning for 2+ year retention.

## Acceptance Criteria
- Partitions by month/quarter
- Queries still efficient
- Archival process documented
- Tests verify partitioning""",
        "labels": ["database", "performance", "scaling"]
    },
    {
        "title": "[Database] Add database backup automation",
        "body": """## Overview
Implement daily automated backups with point-in-time recovery.

## Proposed Change
PostgreSQL WAL archiving to S3, point-in-time recovery setup.

## Acceptance Criteria
- Daily backups automated
- 30-day retention
- Recovery time < 1 hour
- Tested monthly""",
        "labels": ["database", "devops", "backup"]
    },
    {
        "title": "[Database] Implement connection pooling optimization",
        "body": """## Overview
Configure optimal connection pool settings for production.

## Proposed Change
PgBouncer with 100-200 connections, statement pooling.

## Acceptance Criteria
- Connection pool size optimized
- Performance under load stable
- Resource utilization acceptable
- Monitoring in place""",
        "labels": ["database", "performance", "devops"]
    },
    {
        "title": "[Database] Add data validation constraints",
        "body": """## Overview
Implement database constraints for data integrity.

## Proposed Change
Add CHECK, FOREIGN KEY, NOT NULL constraints.

## Acceptance Criteria
- All constraints enforced
- Application assumes valid data
- Errors clear when violated
- Migration rollback safe""",
        "labels": ["database", "integrity", "good-first-issue"]
    },
    {
        "title": "[Database] Create read replicas for reporting",
        "body": """## Overview
Add read-only replicas to offload reporting queries.

## Proposed Change
PostgreSQL streaming replication, read-only API pointing to replica.

## Acceptance Criteria
- Replica lag < 1s
- Reporting queries don't impact production
- Failover handled
- Monitoring configured""",
        "labels": ["database", "scaling", "performance"]
    },
    {
        "title": "[Database] Implement JSONB indexing for metadata",
        "body": """## Overview
Add GIN indexes for efficient JSONB column queries.

## Proposed Change
Index coordinates, metadata JSONB columns.

## Acceptance Criteria
- JSONB queries 10x faster
- Index size acceptable
- Insertion speed not impacted
- Tests verify index usage""",
        "labels": ["database", "performance", "postgres"]
    },
    {
        "title": "[Database] Add temporal tables for full audit trail",
        "body": """## Overview
Implement system-versioned temporal tables for complete history.

## Proposed Change
Add started_at, ended_at to Project, Credit tables.

## Acceptance Criteria
- Full history tracked
- Point-in-time queries possible
- Storage overhead < 20%
- Tests verify history""",
        "labels": ["database", "audit", "compliance"]
    },
    {
        "title": "[Database] Implement row-level security (RLS)",
        "body": """## Overview
Add PostgreSQL RLS for multi-tenant data isolation.

## Proposed Change
RLS policies per user for own credits/projects.

## Acceptance Criteria
- Users only see own data
- Policy enforcement transparent
- Performance overhead < 5%
- Tests verify isolation""",
        "labels": ["database", "security", "multi-tenant"]
    },

    # DOCUMENTATION ISSUES (15 issues)
    {
        "title": "[Docs] Create comprehensive API documentation",
        "body": """## Overview
Write complete API reference for all endpoints.

## Proposed Change
Document endpoints with request/response examples.

## Acceptance Criteria
- All endpoints documented
- Example cURL commands
- Error codes explained
- Authentication method clear""",
        "labels": ["documentation", "api", "good-first-issue"]
    },
    {
        "title": "[Docs] Write architecture decision records (ADRs)",
        "body": """## Overview
Document major technical decisions with rationale.

## Proposed Change
Create ADR format with decision, alternatives, rationale.

## Acceptance Criteria
- Smart contract architecture ADR
- API design ADR
- Stellar integration ADR
- Future decisions follow pattern""",
        "labels": ["documentation", "architecture"]
    },
    {
        "title": "[Docs] Create deployment runbooks",
        "body": """## Overview
Write step-by-step guides for deployment scenarios.

## Proposed Change
Runbooks: initial deploy, rolling update, rollback, disaster recovery.

## Acceptance Criteria
- Runbooks tested on staging
- All steps verified
- Screenshots/videos included
- Estimated time documented""",
        "labels": ["documentation", "devops", "operations"]
    },
    {
        "title": "[Docs] Document carbon credit lifecycle",
        "body": """## Overview
Create visual and textual documentation of credit lifecycle.

## Proposed Change
Diagram and description for: register → verify → mint → retire.

## Acceptance Criteria
- Lifecycle diagram clear
- State transitions documented
- Error scenarios shown
- Used in onboarding""",
        "labels": ["documentation", "product", "good-first-issue"]
    },
    {
        "title": "[Docs] Write security best practices guide",
        "body": """## Overview
Document security principles for contributors.

## Proposed Change
Guide covering: auth, validation, secrets, logging, etc.

## Acceptance Criteria
- Common vulnerabilities covered
- Examples of secure code
- Anti-patterns identified
- Referenced in PR reviews""",
        "labels": ["documentation", "security"]
    },
    {
        "title": "[Docs] Create database schema documentation",
        "body": """## Overview
Document all tables, fields, relationships with diagrams.

## Proposed Change
ERD diagram + table reference docs.

## Acceptance Criteria
- All tables documented
- Field types and constraints clear
- Relationships shown
- Usage examples provided""",
        "labels": ["documentation", "database", "good-first-issue"]
    },
    {
        "title": "[Docs] Write GraphQL schema documentation",
        "body": """## Overview
Document GraphQL types, queries, mutations with descriptions.

## Proposed Change
Schema definitions with field descriptions.

## Acceptance Criteria
- All types documented
- Query examples provided
- Filters explained
- Performance implications noted""",
        "labels": ["documentation", "api", "graphql"]
    },
    {
        "title": "[Docs] Create environment setup guide",
        "body": """## Overview
Write complete local development setup instructions.

## Proposed Change
Step-by-step guide for macOS, Linux, Windows.

## Acceptance Criteria
- Prerequisites listed
- All commands provided
- Troubleshooting included
- Verified on clean machine""",
        "labels": ["documentation", "devops", "good-first-issue"]
    },
    {
        "title": "[Docs] Document testing strategy and standards",
        "body": """## Overview
Explain testing approach: unit, integration, E2E, property-based.

## Proposed Change
Guide with examples for each test type.

## Acceptance Criteria
- Testing pyramid explained
- Coverage targets clear
- Example tests provided
- Performance considerations""",
        "labels": ["documentation", "testing"]
    },
    {
        "title": "[Docs] Create incident response runbook",
        "body": """## Overview
Document procedures for various production incidents.

## Proposed Change
Runbooks for: high load, database down, smart contract bug.

## Acceptance Criteria
- Root cause analysis template
- Communication plan
- Rollback procedures
- Post-incident review""",
        "labels": ["documentation", "devops", "operations"]
    },
    {
        "title": "[Docs] Write performance tuning guide",
        "body": """## Overview
Explain common performance bottlenecks and solutions.

## Proposed Change
Guide covering: caching, indexing, query optimization.

## Acceptance Criteria
- Benchmarking explained
- Tools recommended
- Common issues listed
- Solutions provided""",
        "labels": ["documentation", "performance"]
    },
    {
        "title": "[Docs] Create dependency management policy",
        "body": """## Overview
Document how to review, update, and manage dependencies.

## Proposed Change
Policy for security updates, version bumps, breaking changes.

## Acceptance Criteria
- Update frequency defined
- Security patch process clear
- Test requirements stated
- Escalation path defined""",
        "labels": ["documentation", "operations"]
    },
    {
        "title": "[Docs] Write code review guidelines",
        "body": """## Overview
Document expectations for code reviews.

## Proposed Change
Guide covering: what to check, comment tone, approval process.

## Acceptance Criteria
- Review checklist provided
- Examples of good/bad reviews
- Turnaround time defined
- Conflict resolution process""",
        "labels": ["documentation", "process"]
    },
    {
        "title": "[Docs] Create contributing guide",
        "body": """## Overview
Document process for external contributors.

## Proposed Change
Guide: fork, develop, test, submit PR, respond to feedback.

## Acceptance Criteria
- Step-by-step process clear
- PR template provided
- Issue picking process
- Communication expectations""",
        "labels": ["documentation", "community", "good-first-issue"]
    },
    {
        "title": "[Docs] Write Stellar blockchain primer",
        "body": """## Overview
Explain Stellar basics for team not familiar with blockchain.

## Proposed Change
Guide covering: accounts, transactions, operations, assets.

## Acceptance Criteria
- Concepts clearly explained
- Examples with carbon credits
- Links to Stellar docs
- Used in onboarding""",
        "labels": ["documentation", "education", "blockchain"]
    },

    # UI/UX ISSUES (15 issues)
    {
        "title": "[UI/UX] Design and implement consistent color system",
        "body": """## Overview
Create and document color palette with semantic meanings.

## Proposed Change
Define primary, secondary, success, error colors with hex values.

## Acceptance Criteria
- Palette documented
- Applied in design system
- Contrast ratios WCAG AA
- Tested on protanopia""",
        "labels": ["ui", "design", "accessibility", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Create reusable component library",
        "body": """## Overview
Build and document UI component library (Button, Input, Card, etc).

## Proposed Change
Storybook with component variations.

## Acceptance Criteria
- 20+ components documented
- Storybook deployment live
- Accessibility checklist
- Component API clear""",
        "labels": ["ui", "components", "design"]
    },
    {
        "title": "[UI/UX] Implement responsive grid system",
        "body": """## Overview
Create consistent responsive layout grid.

## Proposed Change
Implement 12-column grid with breakpoints: mobile, tablet, desktop.

## Acceptance Criteria
- Grid responsive
- Mobile-first approach
- No horizontal scroll
- Tested on real devices""",
        "labels": ["ui", "responsive", "design", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Design empty states and error pages",
        "body": """## Overview
Create helpful empty state and error page designs.

## Proposed Change
Empty state for no credits, 404, 500 error pages.

## Acceptance Criteria
- Designs engaging and helpful
- Suggestions for next steps
- Consistent with brand
- Implemented across app""",
        "labels": ["ui", "design", "ux"]
    },
    {
        "title": "[UI/UX] Implement micro-interactions for feedback",
        "body": """## Overview
Add subtle animations for user feedback (button hover, form success).

## Proposed Change
Use CSS and Framer Motion for smooth interactions.

## Acceptance Criteria
- Interactions smooth and purposeful
- Performance impact minimal
- Accessibility preserved
- On brand""",
        "labels": ["ui", "animation", "ux"]
    },
    {
        "title": "[UI/UX] Create onboarding flow for new users",
        "body": """## Overview
Design and implement guided onboarding tour.

## Proposed Change
Steps for: connect wallet, understand credits, make first purchase.

## Acceptance Criteria
- Tour skippable
- Progress visible
- Tooltips helpful
- Analytics tracked""",
        "labels": ["ui", "onboarding", "feature"]
    },
    {
        "title": "[UI/UX] Design accessibility-first form validation",
        "body": """## Overview
Create form validation that works for all users.

## Proposed Change
Error messages linked to fields, ARIA live regions.

## Acceptance Criteria
- Errors announced to screen readers
- Keyboard navigation working
- Error recovery clear
- Tests cover accessibility""",
        "labels": ["ui", "accessibility", "forms", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Implement progressive disclosure for complex data",
        "body": """## Overview
Show simplified view by default, allow details expansion.

## Proposed Change
Credit details show summary, expand for full info.

## Acceptance Criteria
- Summary always visible
- Details expandable
- State persisted
- Mobile-friendly""",
        "labels": ["ui", "ux", "design"]
    },
    {
        "title": "[UI/UX] Design responsive navigation menu",
        "body": """## Overview
Create hamburger menu for mobile, full nav for desktop.

## Proposed Change
Animated hamburger with smooth transitions.

## Acceptance Criteria
- Menu responsive
- Animations smooth
- Navigation clear
- Keyboard accessible""",
        "labels": ["ui", "navigation", "responsive", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Create notification/alert design system",
        "body": """## Overview
Standardize notifications with consistent styling.

## Proposed Change
Info, success, warning, error alert styles.

## Acceptance Criteria
- 4 alert types designed
- Icons consistent
- Dismissible
- Accessible""",
        "labels": ["ui", "design", "components"]
    },
    {
        "title": "[UI/UX] Implement data table design patterns",
        "body": """## Overview
Design accessible, responsive data tables.

## Proposed Change
Table with sorting, filtering, pagination.

## Acceptance Criteria
- Keyboard navigation
- Screen reader support
- Mobile: card layout fallback
- Performance with 1000+ rows""",
        "labels": ["ui", "tables", "accessibility"]
    },
    {
        "title": "[UI/UX] Design modal/dialog components",
        "body": """## Overview
Create accessible modal dialog component.

## Proposed Change
Modal with focus trap, escape key, overlay click.

## Acceptance Criteria
- Focus management correct
- Keyboard navigation
- Overlay clickable
- Animation smooth""",
        "labels": ["ui", "components", "accessibility", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Create button variations and states",
        "body": """## Overview
Design button component with all states: default, hover, active, disabled.

## Proposed Change
Primary, secondary button variants.

## Acceptance Criteria
- All states visually distinct
- Hover state discoverable
- Disabled clearly disabled
- Sizes: small, medium, large""",
        "labels": ["ui", "components", "design"]
    },
    {
        "title": "[UI/UX] Implement focus indicators for keyboard navigation",
        "body": """## Overview
Add visible focus indicators for keyboard navigation.

## Proposed Change
Custom focus outlines visible at 3:1 minimum contrast.

## Acceptance Criteria
- Focus visible on all interactive elements
- Not removed via CSS
- Visible at reasonable zoom
- Color contrast 3:1 minimum""",
        "labels": ["ui", "accessibility", "good-first-issue"]
    },
    {
        "title": "[UI/UX] Design card component with variants",
        "body": """## Overview
Create reusable card component for displaying content.

## Proposed Change
Card with header, body, footer, shadow variants.

## Acceptance Criteria
- Variants working
- Responsive
- Semantic HTML
- Used throughout app""",
        "labels": ["ui", "components", "design"]
    },

    # DEVOPS/INFRASTRUCTURE ISSUES (10 issues)
    {
        "title": "[DevOps] Set up GitHub Actions CI/CD pipeline",
        "body": """## Overview
Implement automated testing and deployment pipeline.

## Proposed Change
Workflows: test on PR, build docker image, deploy on merge.

## Acceptance Criteria
- Tests run on every PR
- Docker image built and pushed
- Staging deployment automatic
- Production requires approval""",
        "labels": ["devops", "ci-cd", "github-actions"]
    },
    {
        "title": "[DevOps] Configure Docker and Kubernetes deployment",
        "body": """## Overview
Containerize all services and deploy to Kubernetes.

## Proposed Change
Docker images for backend, frontend, indexer. K8s manifests.

## Acceptance Criteria
- Containers build successfully
- K8s deployment working
- Rolling updates possible
- Resource limits set""",
        "labels": ["devops", "docker", "kubernetes"]
    },
    {
        "title": "[DevOps] Implement monitoring with Prometheus and Grafana",
        "body": """## Overview
Add comprehensive monitoring and visualization.

## Proposed Change
Prometheus scraping, Grafana dashboards.

## Acceptance Criteria
- Key metrics collected
- Dashboards informative
- Alert thresholds set
- Data retention: 30 days""",
        "labels": ["devops", "monitoring", "observability"]
    },
    {
        "title": "[DevOps] Set up centralized logging with ELK stack",
        "body": """## Overview
Aggregate logs from all services.

## Proposed Change
Elasticsearch, Logstash, Kibana for log analysis.

## Acceptance Criteria
- All logs centralized
- Searchable via Kibana
- Retention: 30 days
- Performance impact minimal""",
        "labels": ["devops", "logging", "elasticsearch"]
    },
    {
        "title": "[DevOps] Implement secrets management",
        "body": """## Overview
Securely manage API keys, database credentials, etc.

## Proposed Change
HashiCorp Vault or AWS Secrets Manager.

## Acceptance Criteria
- Secrets never in code
- Rotation automated
- Access audited
- Zero-trust principle""",
        "labels": ["devops", "security", "secrets"]
    },
    {
        "title": "[DevOps] Set up automated database backups and recovery",
        "body": """## Overview
Implement backup strategy with PITR capability.

## Proposed Change
Daily backups to S3, WAL archiving, recovery tests monthly.

## Acceptance Criteria
- Backups automated daily
- PITR possible to any time
- Recovery time < 1 hour
- Tested quarterly""",
        "labels": ["devops", "backup", "disaster-recovery"]
    },
    {
        "title": "[DevOps] Configure load balancing and auto-scaling",
        "body": """## Overview
Set up load balancer with auto-scaling policies.

## Proposed Change
AWS ELB or nginx with auto-scaling groups.

## Acceptance Criteria
- Traffic distributed evenly
- Scales based on CPU/memory
- Health checks working
- No downtime during scaling""",
        "labels": ["devops", "scaling", "load-balancing"]
    },
    {
        "title": "[DevOps] Implement CDN for frontend assets",
        "body": """## Overview
Distribute frontend assets globally via CDN.

## Proposed Change
CloudFront or Cloudflare for JS, CSS, images.

## Acceptance Criteria
- Assets served from edge
- Cache headers optimized
- Cache invalidation on deploy
- Performance improved 50%+""",
        "labels": ["devops", "cdn", "performance"]
    },
    {
        "title": "[DevOps] Set up VPN for secure development",
        "body": """## Overview
Implement VPN for secure access to staging/production.

## Proposed Change
WireGuard or OpenVPN with key rotation.

## Acceptance Criteria
- All developers on VPN
- Key rotation automated
- Access logs maintained
- Audit trail complete""",
        "labels": ["devops", "security", "vpn"]
    },
    {
        "title": "[DevOps] Create disaster recovery plan and procedures",
        "body": """## Overview
Document and test disaster recovery procedures.

## Proposed Change
DR plan with RTO/RPO targets, failover procedures.

## Acceptance Criteria
- Plan documented
- Procedures tested quarterly
- RTO < 1 hour, RPO < 30 min
- Communication plan clear""",
        "labels": ["devops", "disaster-recovery", "operations"]
    },

    # TESTING ISSUES (10 issues)
    {
        "title": "[Testing] Implement unit tests for smart contracts",
        "body": """## Overview
Add comprehensive unit tests for all contract functions.

## Proposed Change
Test coverage > 90% for core functions.

## Acceptance Criteria
- All functions tested
- Edge cases covered
- Tests pass consistently
- Coverage report generated""",
        "labels": ["testing", "smart-contracts", "good-first-issue"]
    },
    {
        "title": "[Testing] Create integration tests for credit lifecycle",
        "body": """## Overview
Test complete flow: register → verify → mint → retire.

## Proposed Change
End-to-end integration tests with test database.

## Acceptance Criteria
- Happy path tested
- Error scenarios covered
- Database state verified
- Performance acceptable""",
        "labels": ["testing", "integration", "backend"]
    },
    {
        "title": "[Testing] Implement E2E tests with Playwright",
        "body": """## Overview
Add E2E tests for critical user journeys.

## Proposed Change
Tests for: register project, buy credits, retire credits.

## Acceptance Criteria
- 3+ user journeys tested
- Tests reliable
- Runs in CI
- Screenshots on failure""",
        "labels": ["testing", "e2e", "frontend"]
    },
    {
        "title": "[Testing] Add property-based testing with Hypothesis",
        "body": """## Overview
Use property-based testing for validation logic.

## Proposed Change
Properties: serial numbers unique, amounts never negative, etc.

## Acceptance Criteria
- 5+ properties defined
- Properties pass 100+ generated cases
- Shrinking works
- Performance acceptable""",
        "labels": ["testing", "property-based"]
    },
    {
        "title": "[Testing] Create performance benchmarks",
        "body": """## Overview
Establish baseline performance metrics.

## Proposed Change
Benchmarks for: list projects, retire credits, search.

## Acceptance Criteria
- Baselines established
- Regressions detected
- Comparisons in CI
- Trending tracked""",
        "labels": ["testing", "performance", "benchmarks"]
    },
    {
        "title": "[Testing] Implement contract fuzzing",
        "body": """## Overview
Use fuzzing to find edge cases in contracts.

## Proposed Change
Fuzzing with random inputs for contract functions.

## Acceptance Criteria
- Fuzzer runs 10k+ iterations
- Crashes fixed
- Invariants hold
- Regression test added""",
        "labels": ["testing", "smart-contracts", "security"]
    },
    {
        "title": "[Testing] Add API contract testing",
        "body": """## Overview
Verify API requests/responses match schema.

## Proposed Change
Consumer-driven contract testing.

## Acceptance Criteria
- Requests validated
- Responses validated
- Schema versioning handled
- Tests pass""",
        "labels": ["testing", "api", "contracts"]
    },
    {
        "title": "[Testing] Create fixture library for tests",
        "body": """## Overview
Build reusable test fixtures for common scenarios.

## Proposed Change
Factories for: Project, Credit, User, Transaction.

## Acceptance Criteria
- Fixtures cover 80% of scenarios
- Used consistently
- Performance optimal
- Maintainable""",
        "labels": ["testing", "fixtures", "good-first-issue"]
    },
    {
        "title": "[Testing] Implement mutation testing",
        "body": """## Overview
Verify test quality by mutating code.

## Proposed Change
Run mutation tester on critical code paths.

## Acceptance Criteria
- Mutation score > 80%
- Weak tests identified
- Fixes applied
- CI integration""",
        "labels": ["testing", "mutation-testing", "quality"]
    },
    {
        "title": "[Testing] Add accessibility testing automation",
        "body": """## Overview
Automated accessibility testing with axe-core.

## Proposed Change
axe-core integration in E2E tests.

## Acceptance Criteria
- Violations caught
- WCAG AA passed
- Integration in CI
- False positives minimized""",
        "labels": ["testing", "accessibility", "automation"]
    },
]

def create_issue(issue):
    """Create a GitHub issue."""
    cmd = [
        "gh", "issue", "create",
        "--title", issue["title"],
        "--body", issue["body"],
        "--label", ",".join(issue["labels"]),
        "--repo", REPO
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        url = result.stdout.strip()
        issue_num = url.split("/")[-1]
        print(f"✓ #{issue_num}: {issue['title'][:65]}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ {issue['title'][:65]}")
        if "not found" in e.stderr.lower() or "label" in e.stderr.lower():
            print(f"  (label may need creation)")
            return True
        return False

if __name__ == "__main__":
    print(f"\n{'='*80}")
    print(f"Creating 90 GitHub issues for CarbonLedger (Carbon-Ledger-stellar)")
    print(f"{'='*80}\n")
    
    successful = 0
    failed = 0
    
    for i, issue in enumerate(ISSUES, 1):
        if create_issue(issue):
            successful += 1
        else:
            failed += 1
        
        # Rate limiting
        if i % 10 == 0:
            print(f"\n[{i}/90] Progress: {successful} created, {failed} failed\n")
        
        if i < len(ISSUES):
            time.sleep(0.2)
    
    print(f"\n{'='*80}")
    print(f"✓ COMPLETE: {successful}/{len(ISSUES)} issues created successfully")
    if failed > 0:
        print(f"⚠ Failed: {failed}")
    print(f"{'='*80}\n")
    print(f"View all issues: https://github.com/Carbon-Ledger-stellar/carbonledger/issues\n")
