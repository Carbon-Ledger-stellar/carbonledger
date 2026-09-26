# Spec: Disaster Recovery, End-to-End Testing & Performance Optimization

**Status:** In Progress  
**Branch:** `feature/dr-testing-performance`  
**Created:** August 28, 2026

---

## Overview

This spec consolidates three critical initiatives for the Carbon Ledger platform:

1. **Disaster Recovery Plan** - Establish formal RTO/RPO targets and tested failover procedures
2. **End-to-End Integration Tests** - Complete user journeys with test database verification
3. **Query Performance Optimization** - Prisma middleware caching for frequent queries

---

## Task 1: Disaster Recovery Plan & Testing

### Overview
Document and test disaster recovery procedures to ensure business continuity with defined Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets.

### Proposed Change
- **DR Plan Document** with RTO/RPO targets
- **Failover procedures** documented and tested
- **Communication plan** for incidents
- **Quarterly testing schedule**

### Acceptance Criteria
- [ ] DR plan document created and reviewed
- [ ] Failover procedures tested quarterly
- [ ] **RTO < 1 hour** (target recovery time)
- [ ] **RPO < 30 minutes** (target data loss window)
- [ ] Communication plan clearly defined
- [ ] Test results documented and tracked

### Implementation Tasks

#### Task 1.1: Create DR Plan Document
**Description:** Create comprehensive disaster recovery plan with infrastructure, data, and application recovery procedures.

**Acceptance Criteria:**
- [ ] Document includes infrastructure failover procedures
- [ ] Database backup & recovery procedures detailed
- [ ] RTO/RPO targets clearly defined
- [ ] Recovery procedures for all critical services
- [ ] Communication escalation plan
- [ ] Document location: `docs/DISASTER_RECOVERY_PLAN.md`

**Files to Create/Modify:**
- `docs/DISASTER_RECOVERY_PLAN.md` (new)
- `docs/INCIDENT_RESPONSE.md` (new)

#### Task 1.2: Implement Backup & Recovery Infrastructure
**Description:** Set up automated backup procedures and recovery testing infrastructure.

**Acceptance Criteria:**
- [ ] Automated daily backups configured
- [ ] Weekly backup integrity testing
- [ ] Point-in-time recovery capability verified
- [ ] Cross-region backup replication (if applicable)
- [ ] Backup storage encrypted and audited

**Files to Create/Modify:**
- `.github/workflows/backup-verification.yml` (new)
- `scripts/backup-restore-test.sh` (new)

#### Task 1.3: Document Failover Procedures
**Description:** Create runbooks for all failover scenarios.

**Acceptance Criteria:**
- [ ] Database failover runbook
- [ ] API service failover runbook
- [ ] Cache/session failover runbook
- [ ] DNS/routing failover procedures
- [ ] Each runbook includes estimated RTO
- [ ] Step-by-step instructions with verification steps

**Files to Create/Modify:**
- `docs/FAILOVER_RUNBOOKS.md` (new)
- `docs/FAILOVER_CHECKLIST.md` (new)

#### Task 1.4: Establish Testing Schedule
**Description:** Set up quarterly DR testing procedures and track results.

**Acceptance Criteria:**
- [ ] Quarterly testing calendar established
- [ ] Test procedures automated where possible
- [ ] Results tracked in issue tracker
- [ ] Lessons learned captured after each test
- [ ] Timeline for procedure improvements

**Files to Create/Modify:**
- `docs/DR_TESTING_SCHEDULE.md` (new)

---

## Task 2: End-to-End Integration Testing

### Overview
Implement comprehensive end-to-end tests for critical user journeys with test database verification.

### Proposed Change
- **Complete user flow tests**: register → verify → mint → retire
- **End-to-end integration tests** with dedicated test database
- **Error scenario coverage**
- **Database state verification**
- **Performance assertions**

### Acceptance Criteria
- [ ] Happy path tested for: register, mint, retire
- [ ] Error scenarios covered (invalid inputs, edge cases)
- [ ] Database state verified after each operation
- [ ] Performance acceptable (response times, database queries)
- [ ] 3+ user journeys tested
- [ ] Tests reliable and not flaky
- [ ] Tests run in CI pipeline
- [ ] Screenshots/logs on failure

### Implementation Tasks

#### Task 2.1: Set Up E2E Testing Infrastructure
**Description:** Configure test database, test user accounts, and E2E testing framework.

**Acceptance Criteria:**
- [ ] Test database provisioned and populated
- [ ] Test fixtures created for common scenarios
- [ ] Test user accounts with various permission levels
- [ ] Database cleanup/reset between test runs
- [ ] Test database completely isolated from production
- [ ] Connection pooling configured for test DB

**Files to Create/Modify:**
- `backend/test/e2e/setup.ts` (new)
- `backend/test/e2e/fixtures.ts` (new)
- `backend/docker-compose.e2e.yml` (new)
- `backend/.env.e2e.example` (new)

#### Task 2.2: Implement Core User Journey Tests
**Description:** Create E2E tests for primary user workflows.

**Acceptance Criteria:**
- [ ] Project registration flow tested
- [ ] Credit purchase flow tested
- [ ] Credit retirement flow tested
- [ ] Each test verifies database state
- [ ] Test data cleaned up after execution
- [ ] Tests take < 5 minutes per journey
- [ ] Clear error messages on failure

**Files to Create/Modify:**
- `backend/test/e2e/user-journeys.spec.ts` (new)
- `backend/test/e2e/project-registration.spec.ts` (new)
- `backend/test/e2e/credit-lifecycle.spec.ts` (new)

#### Task 2.3: Implement Error Scenario Tests
**Description:** Cover error paths and edge cases.

**Acceptance Criteria:**
- [ ] Invalid input validation tested
- [ ] Concurrent operation handling tested
- [ ] Database constraint violations handled
- [ ] Rate limiting tested
- [ ] Authorization failures tested
- [ ] Network timeout scenarios covered
- [ ] At least 15 error scenarios

**Files to Create/Modify:**
- `backend/test/e2e/error-scenarios.spec.ts` (new)

#### Task 2.4: Database State Verification
**Description:** Implement utilities to verify database state after operations.

**Acceptance Criteria:**
- [ ] Verify correct records created
- [ ] Verify audit logs recorded
- [ ] Verify soft deletes honored
- [ ] Verify foreign key constraints
- [ ] Verify data types correct
- [ ] Verify timestamps accurate

**Files to Create/Modify:**
- `backend/test/e2e/database-assertions.ts` (new)

#### Task 2.5: CI Integration
**Description:** Integrate E2E tests into CI/CD pipeline.

**Acceptance Criteria:**
- [ ] Tests run on every PR
- [ ] Tests timeout after 15 minutes
- [ ] Failed tests block merge
- [ ] Screenshots/logs captured on failure
- [ ] Test reports visible in CI dashboard
- [ ] Performance metrics tracked

**Files to Create/Modify:**
- `.github/workflows/e2e-tests.yml` (new)

---

## Task 3: Query Performance Optimization with Caching

### Overview
Implement Prisma middleware for automatic query caching to improve performance.

### Proposed Change
- **Prisma middleware** for query result caching
- **Configurable TTL** (Target: 5-minute default)
- **Automatic cache invalidation** on mutations
- **Performance monitoring** and metrics

### Acceptance Criteria
- [ ] Cache hit rate > 60%
- [ ] Cache invalidation on mutations
- [ ] Performance improved 40%+
- [ ] Metrics logged and monitored
- [ ] Configuration options documented
- [ ] Backward compatible (no breaking changes)
- [ ] Cache memory usage monitored

### Implementation Tasks

#### Task 3.1: Implement Caching Middleware
**Description:** Create Prisma middleware for query caching.

**Acceptance Criteria:**
- [ ] Middleware intercepts SELECT queries
- [ ] Cache key generated from query + args
- [ ] TTL configurable per query type
- [ ] Environment-based cache enable/disable
- [ ] Memory management (LRU eviction)
- [ ] Thread-safe cache operations
- [ ] Cache statistics tracking

**Files to Create/Modify:**
- `backend/src/prisma/caching-middleware.ts` (new)
- `backend/src/prisma/cache-stats.ts` (new)
- `backend/src/config/cache.config.ts` (new)

#### Task 3.2: Configure Cached Queries
**Description:** Identify and configure frequently accessed queries for caching.

**Acceptance Criteria:**
- [ ] Project queries cached (TTL: 5 min)
- [ ] User queries cached (TTL: 5 min)
- [ ] Credit metadata queries cached (TTL: 10 min)
- [ ] Marketplace listings cached (TTL: 5 min)
- [ ] Category/taxonomy data cached (TTL: 30 min)
- [ ] Cache invalidation on related mutations
- [ ] Configuration documented

**Files to Create/Modify:**
- `backend/src/config/cache-policy.ts` (new)
- `backend/src/prisma/cache-invalidation.ts` (new)

#### Task 3.3: Cache Invalidation Strategy
**Description:** Implement automatic cache invalidation on data mutations.

**Acceptance Criteria:**
- [ ] CREATE operations invalidate relevant caches
- [ ] UPDATE operations invalidate relevant caches
- [ ] DELETE operations invalidate relevant caches
- [ ] Bulk operations invalidate efficiently
- [ ] No stale data served
- [ ] Invalidation timing < 10ms
- [ ] Cascade invalidation handled correctly

**Files to Create/Modify:**
- `backend/src/prisma/cache-invalidation.ts` (updated)

#### Task 3.4: Performance Monitoring
**Description:** Add metrics and monitoring for cache performance.

**Acceptance Criteria:**
- [ ] Cache hit/miss ratio tracked
- [ ] Average response time improvement measured
- [ ] Cache size monitored
- [ ] Query performance logged
- [ ] Metrics exported to monitoring system
- [ ] Alerts on cache degradation
- [ ] Dashboard showing cache stats

**Files to Create/Modify:**
- `backend/src/monitoring/cache-metrics.ts` (new)
- `.github/workflows/cache-performance-test.yml` (new)

#### Task 3.5: Testing & Documentation
**Description:** Test caching implementation and document configuration.

**Acceptance Criteria:**
- [ ] Unit tests for cache logic
- [ ] Integration tests with real queries
- [ ] Cache hit rate benchmark > 60%
- [ ] Performance improvement test > 40%
- [ ] Configuration guide documented
- [ ] Troubleshooting guide created
- [ ] Examples for common patterns

**Files to Create/Modify:**
- `backend/test/unit/caching-middleware.spec.ts` (new)
- `backend/test/integration/cache-integration.spec.ts` (new)
- `backend/docs/QUERY_CACHING.md` (new)

---

## Implementation Order

1. **Phase 1 (Week 1)**: Disaster Recovery Foundation
   - Create DR plan document
   - Implement backup infrastructure
   - Document failover procedures

2. **Phase 2 (Week 2-3)**: End-to-End Testing
   - Set up E2E testing infrastructure
   - Implement core user journey tests
   - Add error scenario coverage

3. **Phase 3 (Week 4)**: Performance Optimization
   - Implement caching middleware
   - Configure cached queries
   - Add monitoring & metrics

4. **Phase 4 (Ongoing)**: Testing & Validation
   - Run E2E tests in CI
   - Conduct quarterly DR tests
   - Monitor cache performance

---

## Testing Strategy

### DR Testing
- **Monthly**: Backup restoration test
- **Quarterly**: Full failover simulation
- **On-demand**: Emergency procedures

### E2E Testing
- **CI**: All E2E tests on every PR
- **Nightly**: Full test suite
- **Manual**: Before major releases

### Performance Testing
- **Daily**: Cache metrics collection
- **Weekly**: Performance regression tests
- **Monthly**: Cache effectiveness review

---

## Success Metrics

### DR Plan
- ✓ RTO < 1 hour
- ✓ RPO < 30 minutes
- ✓ Quarterly testing completion
- ✓ Zero unplanned incidents with recovery > 4 hours

### E2E Tests
- ✓ 3+ user journeys automated
- ✓ Test pass rate > 95%
- ✓ Test execution time < 15 minutes
- ✓ Error scenario coverage > 80%

### Query Caching
- ✓ Cache hit rate > 60%
- ✓ Response time improvement > 40%
- ✓ Cache memory < 500MB
- ✓ No stale data incidents

---

## Dependencies & Risks

### Dependencies
- Database backup infrastructure access
- CI/CD pipeline modifications
- Prisma middleware API stability

### Risks
- E2E test flakiness in CI environment
- Cache invalidation edge cases
- Production data breach during DR tests

### Mitigation
- Dedicated test database environment
- Comprehensive cache invalidation testing
- DR tests on cloned production environment only

---

## Files Summary

### New Documentation Files
- `docs/DISASTER_RECOVERY_PLAN.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/FAILOVER_RUNBOOKS.md`
- `docs/FAILOVER_CHECKLIST.md`
- `docs/DR_TESTING_SCHEDULE.md`
- `backend/docs/QUERY_CACHING.md`

### New Test Files
- `backend/test/e2e/setup.ts`
- `backend/test/e2e/fixtures.ts`
- `backend/test/e2e/user-journeys.spec.ts`
- `backend/test/e2e/project-registration.spec.ts`
- `backend/test/e2e/credit-lifecycle.spec.ts`
- `backend/test/e2e/error-scenarios.spec.ts`
- `backend/test/e2e/database-assertions.ts`
- `backend/test/unit/caching-middleware.spec.ts`
- `backend/test/integration/cache-integration.spec.ts`

### New Implementation Files
- `backend/src/prisma/caching-middleware.ts`
- `backend/src/prisma/cache-stats.ts`
- `backend/src/prisma/cache-invalidation.ts`
- `backend/src/config/cache.config.ts`
- `backend/src/config/cache-policy.ts`
- `backend/src/monitoring/cache-metrics.ts`

### New Infrastructure Files
- `backend/docker-compose.e2e.yml`
- `backend/.env.e2e.example`
- `.github/workflows/e2e-tests.yml`
- `.github/workflows/backup-verification.yml`
- `.github/workflows/cache-performance-test.yml`
- `scripts/backup-restore-test.sh`

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-28 | Initial | Created comprehensive spec for DR, E2E testing, and performance optimization |

