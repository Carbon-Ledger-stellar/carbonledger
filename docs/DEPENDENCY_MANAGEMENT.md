# Dependency Management Policy

Procedures for reviewing, updating, and managing dependencies across CarbonLedger. This policy ensures security, stability, and maintainability of the project.

## Table of Contents
- [Overview](#overview)
- [Dependency Categories](#dependency-categories)
- [Security Update Process](#security-update-process)
- [Version Bump Procedures](#version-bump-procedures)
- [Breaking Change Policy](#breaking-change-policy)
- [Test Requirements](#test-requirements)
- [Escalation Path](#escalation-path)
- [Dependency Audit](#dependency-audit)
- [Approval Workflow](#approval-workflow)

---

## Overview

### Goals
1. **Security First** - Patch security vulnerabilities immediately
2. **Stability** - Avoid unnecessary breaking changes
3. **Maintainability** - Keep dependencies current and supported
4. **Transparency** - Document all major dependency changes
5. **Efficiency** - Automate scanning and updates where possible

### Scope
- Direct production dependencies (`package.json` dependencies)
- Development dependencies (`devDependencies`)
- Transitive dependencies (dependencies of dependencies)
- System-level dependencies (Node.js, npm, Docker base images)

---

## Dependency Categories

### 1. Critical Dependencies
Impact: **High** | Update Frequency: **Daily**

Projects that form the core infrastructure:
- `express`, `fastify`, `nestjs` - Web frameworks
- `prisma` - Database ORM
- Database drivers (`pg`, `mysql2`)
- Authentication (`jsonwebtoken`, `passport`)
- Blockchain interaction (`ethers`, `web3`)

### 2. Security Dependencies
Impact: **High** | Update Frequency: **Immediate**

Handle sensitive operations:
- `bcrypt`, `argon2` - Password hashing
- `crypto`, `tweetnacl` - Cryptography
- `helmet` - Security headers
- CORS middleware
- Rate limiting libraries

### 3. Performance-Critical Dependencies
Impact: **Medium-High** | Update Frequency: **Weekly**

Affect application performance:
- Caching libraries (`redis`, `memcached`)
- Query builders
- Logging frameworks (`pino`, `winston`)
- Monitoring/APM agents

### 4. Standard Dependencies
Impact: **Medium** | Update Frequency: **Monthly**

General-purpose utilities:
- `lodash`, `ramda` - Utility functions
- `date-fns`, `moment` - Date handling
- `uuid` - ID generation
- `joi`, `zod` - Validation

### 5. Development Dependencies
Impact: **Low** | Update Frequency: **Quarterly**

Used only in development:
- Testing frameworks (`jest`, `vitest`)
- Linters (`eslint`)
- Formatters (`prettier`)
- Type checkers (`typescript`)
- Build tools

---

## Security Update Process

### Phase 1: Detection (Automatic)

**Tools Used**:
```bash
# Weekly scan via GitHub Dependabot
# Configuration in: .github/dependabot.yml

# Manual scan
npm audit
npm audit --production  # Production only

# Deep scan with Snyk
snyk test
snyk monitor  # Continuous monitoring
```

**Detection Output**:
```
┌───────────────────────────────────────────────────────┐
│                npm audit report                       │
├───────────────────────────────────────────────────────┤
│ found 3 vulnerabilities                               │
│   1 critical                                          │
│   1 high                                              │
│   1 moderate                                          │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│ CRITICAL: Cross-Site Scripting (XSS)                 │
│ Package: express-xss                                 │
│ Installed: 1.0.0                                     │
│ Fixed: 1.0.2                                         │
│ Severity: CRITICAL                                    │
│ CVE: CVE-2024-1234                                   │
└───────────────────────────────────────────────────────┘
```

### Phase 2: Assessment (1 hour for critical)

**Severity Levels**:

| Level | CVSS | Response Time | Action |
|-------|------|---------------|--------|
| Critical | 9.0-10.0 | Immediate (< 1 hour) | Apply patch/update ASAP |
| High | 7.0-8.9 | Within 24 hours | Schedule urgent update |
| Medium | 4.0-6.9 | Within 1 week | Plan update in sprint |
| Low | 0.1-3.9 | Within 30 days | Include in regular updates |

**Assessment Steps**:

```bash
# 1. Get vulnerability details
npm audit --json | jq '.vulnerabilities'

# 2. Check if vulnerability affects our code
# - Does the vulnerable function get called?
# - Are we passing untrusted input to it?

# 3. Review patch notes
# npm view package-name@latest
# GitHub repo: https://github.com/...

# 4. Check for breaking changes
# - Version bump type (major, minor, patch)
# - Changelog review
# - Migration guide (if available)
```

**Example Assessment**:

```yaml
Vulnerability: SQL Injection in Query Builder
Package: knex@2.0.0
Severity: CRITICAL
CVE: CVE-2024-5678

Analysis:
  - Affected versions: < 2.5.2
  - Current version: 2.4.1 ❌ VULNERABLE
  - Fixed version: 2.5.2 ✅
  - Version bump: Minor (2.4.1 → 2.5.2)
  - Breaking changes: None (patch fix)
  - Risk of update: LOW
  - Recommendation: UPDATE IMMEDIATELY
```

### Phase 3: Planning

**Create Security Issue**:
```markdown
# Security Update: express-xss 1.0.2

## Vulnerability
- CVE: CVE-2024-1234
- Type: Cross-Site Scripting (XSS)
- Severity: CRITICAL
- Affected versions: < 1.0.2

## Current State
- Current version: 1.0.0
- Update available: 1.0.2
- Version bump: Patch

## Action Items
- [ ] Update dependency
- [ ] Run full test suite
- [ ] Test in staging
- [ ] Deploy to production

## Timeline
- Update by: 2026-08-29 EOD
- Deploy by: 2026-08-30 09:00 UTC

## Assignee
@security-team
```

**For Critical Vulnerabilities**:
- Create GitHub issue immediately
- Assign to security team lead
- Escalate via Slack #security channel
- Add to weekly security briefing

### Phase 4: Update

**Steps**:

```bash
# 1. Create feature branch
git checkout -b security/update-express-xss-1.0.2

# 2. Update dependency
npm update express-xss  # Updates to compatible version
# OR
npm install express-xss@1.0.2  # Specific version

# 3. Review changes
git diff package.json package-lock.json

# 4. Commit (with security reference)
git commit -m "security: update express-xss to 1.0.2

Fixes XSS vulnerability CVE-2024-1234
Severity: CRITICAL
- No breaking changes
- All tests passing"

# 5. Push for CI/CD
git push origin security/update-express-xss-1.0.2
```

### Phase 5: Testing

**Required Tests** (for security updates):

```bash
# Full test suite
npm run test:full
npm run test:integration
npm run test:e2e

# Security-specific tests
npm run test:security
npm audit

# Vulnerability scan
snyk test

# Manual testing checklist
- [ ] Feature affected by vulnerability works
- [ ] Related features still function
- [ ] No console errors/warnings
- [ ] No performance regression
```

### Phase 6: Deployment

**Approval Process**:
```
Code Review
    ↓
  [2 approvals from security-team or senior-devs]
    ↓
CI/CD Pipeline
    ↓
  [All checks pass: lint, test, audit]
    ↓
Merge to main
    ↓
Automatic deploy to staging
    ↓
Manual approval for production
    ↓
Deploy to production
    ↓
Monitor for issues (24 hours)
```

**Production Deployment**:
```bash
# Deployment automatically triggered after merge to main
# OR manual deployment
npm run deploy:production

# Post-deployment monitoring
# - Check error rates in Sentry
# - Review logs for exceptions
# - Monitor performance metrics
```

### Phase 7: Verification (24 hours)

**Monitoring**:
```
Metrics to watch:
- Error rate (should be < 0.01%)
- Exception count (no new exceptions)
- Performance (no degradation)
- Security scan results (should pass)
```

**Verification Checklist**:
- [ ] Error rate normal
- [ ] No new exceptions
- [ ] Performance metrics stable
- [ ] Vulnerable package no longer reported
- [ ] Update documented in changelog

---

## Version Bump Procedures

### Version Semver Rules

```
MAJOR.MINOR.PATCH
  ↓      ↓      ↓
1.2.3 - breaking changes
      ↓ - new feature (backward compatible)
        ↓ - bug fix (backward compatible)
```

### PATCH Updates (1.0.0 → 1.0.1)

**When**: Bug fixes, security patches  
**Risk**: Low  
**Testing**: Regular test suite  
**Review**: Standard

```bash
# Automated update
npm update

# No breaking changes expected
# Safe to apply automatically (with tests)
```

**Example**:
```json
// package.json
{
  "dependencies": {
    "lodash": "4.17.20",  // ← Patch update
    "express": "4.17.1"
  }
}
```

### MINOR Updates (1.0.0 → 1.1.0)

**When**: New features (backward compatible)  
**Risk**: Medium  
**Testing**: Full test suite + manual testing  
**Review**: One developer + security (if security-related)

```bash
# Manual update (don't auto-apply)
npm install express@4.18.0

# Run tests
npm test

# Manual testing of new features
# Update documentation
```

**Procedure**:

```markdown
## Dependency Update: express 4.17.1 → 4.18.0

### Changes
- [x] New middleware API (backward compatible)
- [x] Performance improvements
- [x] No breaking changes

### Testing Completed
- [x] Unit tests: 542 passed
- [x] Integration tests: 89 passed
- [x] Manual smoke test: OK
- [x] Staging deployment: OK
- [x] npm audit: No new issues

### Approval
- Reviewed by: @dev-lead
- Approved by: @tech-lead
```

### MAJOR Updates (1.0.0 → 2.0.0)

**When**: Breaking changes  
**Risk**: High  
**Testing**: Comprehensive testing + staged rollout  
**Review**: Team discussion + approval from tech lead

```bash
# NEVER auto-apply major updates
# Requires explicit decision

# 1. Evaluate impact
npm show express@5.0.0
# → Check breaking changes in changelog

# 2. Create detailed migration plan
# → Document required code changes
# → Estimate effort
# → Identify risks

# 3. Discuss with team
# → In pull request with migration examples
# → Code review from 2+ senior developers

# 4. Create feature branch
git checkout -b feature/upgrade-express-5

# 5. Apply update + migrations
npm install express@5.0.0

# 6. Fix breaking changes
# → Update affected code
# → Run full test suite
# → Manual testing

# 7. Comprehensive testing
npm test
npm run test:e2e
npm audit

# 8. Staged rollout
# → Deploy to staging first
# → Monitor for issues
# → Deploy to production with feature flag

# 9. Document migration
# → Add migration guide to docs/
# → Document breaking changes
# → Update onboarding docs
```

**Example Major Version Update Plan**:

```markdown
## Migration Plan: express 4.x → 5.x

### Breaking Changes
1. Removed: req.files object → use middleware
2. Changed: res.sendFile() signature
3. Removed: app.use(function) → app.use(async function)

### Code Changes Required
1. Update 10 file upload routes
2. Update 5 sendFile calls
3. Convert 3 middleware functions to async

### Timeline
- Sprint 1: Evaluate + plan (2 days)
- Sprint 2: Migration (5 days)
- Sprint 3: Testing + hardening (3 days)
- Sprint 4: Staged rollout (2 days)

### Risk Mitigation
- Feature flag for new code path
- Canary deployment (5% traffic first)
- Rollback plan ready
- 24/7 monitoring during rollout

### Sign-off
- [x] Tech lead approved
- [x] QA team ready
- [x] DevOps team ready
```

---

## Breaking Change Policy

### Definition
A breaking change is any modification that requires code changes or configuration updates from users/developers.

### Examples

**IS a breaking change**:
- Function signature changed
- Removed public API
- Default behavior changed
- Error type changed
- Config format changed

**IS NOT a breaking change**:
- New optional parameter
- Performance improvement
- Bug fix that corrects behavior
- New internal implementation (same API)
- Additional validation of invalid inputs

### Handling Breaking Changes

### 1. Communication (First)

**Before update**:
```markdown
# ⚠️ Breaking Change Alert

Package: express 4.x → 5.0.0
Breaking changes:
1. Removed: req.files object
2. Changed: res.sendFile() signature

Impact on CarbonLedger:
- File upload routes (10 files)
- Static file serving (2 routes)

Migration effort: ~8 hours

Timeline:
- Available: 2026-09-01
- Planned update: 2026-09-15
- Deadline: 2026-10-01
```

### 2. Planning

```markdown
## Migration Strategy

### Phase 1: Preparation (1 week)
- Create migration branch: feature/express-5-migration
- Read upgrade guide
- Create migration checklist

### Phase 2: Code Updates (2 weeks)
- Update file upload routes
- Update static file serving
- Fix tests
- Manual testing

### Phase 3: Review & QA (1 week)
- Code review
- Integration testing
- Staging deployment
- Performance testing

### Phase 4: Rollout (1 week)
- Deploy with feature flag
- Monitor errors
- Disable if issues found
- Gradually enable for all users
```

### 3. Deprecation Policy

When possible, provide migration path:

```typescript
// ✅ GOOD: Deprecate with warning + migration path
function oldAPI(params) {
  console.warn(
    'DEPRECATED: oldAPI() will be removed in v3.0.0. ' +
    'Use newAPI() instead. ' +
    'Migration guide: https://docs.carbonledger.io/oldapi-migration'
  );
  return newAPI(params);
}

// ✅ GOOD: Support both APIs temporarily
function processData(data) {
  if (Array.isArray(data)) {
    // New API: accepts array
    return data.map(transform);
  } else {
    // Old API: accepts single object (deprecated)
    console.warn('Passing single object is deprecated. Use array.');
    return [transform(data)];
  }
}

// ❌ BAD: Immediate breaking change
function processData(data) {
  // Old API removed without migration path
  // Users who upgrade break immediately
  return data.map(transform);
}
```

---

## Test Requirements

### For All Dependency Updates

| Update Type | Unit Tests | Integration Tests | E2E Tests | Manual | Staging |
|-------------|-----------|------------------|-----------|--------|---------|
| Patch | Required | Required | Spot check | Required | Recommended |
| Minor | Required | Required | Full | Recommended | Required |
| Major | Required | Required | Full | Required | Required (full) |

### Test Commands

```bash
# Full test suite
npm run test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Security tests
npm audit
snyk test

# Type checking
npm run typecheck
```

### Test Coverage Requirements

```
Minimum coverage by update type:

Patch: 80% (no new code should decrease coverage)
Minor: 85% (new features must have coverage)
Major: 90% (significant changes require high coverage)

Command:
npm run test:coverage
```

### Staging Validation

```bash
# Deploy to staging
npm run deploy:staging

# Validate key features
curl -s https://staging-api.carbonledger.io/health | jq '.status'

# Check specific endpoints affected by update
npm run test:smoke:staging

# Monitor logs for errors
kubectl logs -f deployment/carbonledger-api -n staging --tail=100
```

---

## Escalation Path

### Escalation Triggers

**Escalate immediately if**:
- Breaking change not documented in changelog
- Update breaks CI/CD pipeline
- Transitive dependency conflicts
- Update introduces security issue
- Test coverage decreases > 5%

### Escalation Hierarchy

```
Developer
    ↓
  Issue found during update
    ↓
Code Review (Senior Developer)
    ↓
  Can't resolve / Uncertain approach
    ↓
Tech Lead
    ↓
  Architectural decision needed
    ↓
CTO / Architecture Team
```

### Escalation Example

```markdown
## Escalation: Breaking Change Not Documented

### Issue
Package: knex 2.4.0 → 2.5.0
- Changelog shows "Minor version"
- Found breaking change: Query.count() return type changed
- 3 files in codebase affected
- Tests fail with: "Cannot read property 'count' of undefined"

### Why Escalated
- Not documented as breaking change
- Upstream package error
- Affects data layer
- Cannot proceed without guidance

### Requested Decision
1. Revert to 2.4.0?
2. Wait for 2.5.1 patch?
3. Implement workaround?
4. Contact upstream?

### Assigned to
@tech-lead

### Timeline
Resolution needed by: EOD 2026-08-29
```

---

## Dependency Audit

### Automatic Audits

**Frequency**: Daily  
**Tools**:
- GitHub Dependabot
- npm audit (CI/CD)
- Snyk monitoring

**Configuration**:
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
    reviewers:
      - "security-team"
    assignees:
      - "security-team"
```

### Manual Audit Process

```bash
# Run weekly
npm audit

# Fix automatically (use with caution)
npm audit fix  # Only patches

# Review all updates
npm outdated
```

### Audit Report

**Generate**:
```bash
# Export audit report
npm audit --json > audit-report-$(date +%Y-%m-%d).json

# Summarize
npm audit --production | tee audit-summary.txt
```

**Review Meeting** (weekly):
- Security issues found
- Updates applied
- Updates pending
- Dependencies added/removed
- Risk assessment

### Vulnerability Tracking

```markdown
## Vulnerability Tracking Log

### 2026-08-29
- Found: npm security audit
- Vulnerability: express-xss XSS (CRITICAL)
- Status: PATCHED
- Update: 1.0.0 → 1.0.2
- Deployed: 2026-08-29 14:00 UTC

### 2026-08-28
- Found: Snyk continuous monitoring
- Vulnerability: bcrypt timing attack (MEDIUM)
- Status: REVIEWED
- Decision: Accept risk (bcrypt already uses salt)
- Ticket: SEC-1234
```

---

## Approval Workflow

### Standard Approval Flow

```
Developer creates PR
       ↓
npm audit passes ✓
       ↓
Automated tests pass ✓
       ↓
Code review (1 senior dev)
       ↓
Update type approval:
├─ PATCH: Auto-approve after review
├─ MINOR: 1 senior dev approval
└─ MAJOR: 2 senior dev + tech lead approval
       ↓
Merge to main
       ↓
Deploy to staging
       ↓
Manual testing (if needed)
       ↓
Deploy to production
```

### CODEOWNERS for Dependency Changes

```
# .github/CODEOWNERS
package.json @tech-lead @security-team
package-lock.json @tech-lead @security-team

# For security packages specifically
**/*/bcrypt* @security-team @tech-lead
**/*/jsonwebtoken* @security-team @tech-lead
**/*/helmet* @security-team @tech-lead
```

### PR Template for Dependency Updates

```markdown
## Dependency Update

### Dependency Information
- Package: [name]
- Current version: [version]
- New version: [version]
- Version bump: PATCH | MINOR | MAJOR

### Changes in Update
- [Breaking change or feature]
- [Breaking change or feature]

### Testing Completed
- [x] Unit tests: X passed, Y failed (if any)
- [x] Integration tests: X passed
- [x] npm audit: Clean
- [x] Manual testing: [Description]

### Breaking Changes
[ ] None
[x] Yes: [Description and migration steps]

### Staging Validation
- [x] Deployed to staging
- [x] Health check: OK
- [x] Critical endpoints tested: OK

### Approval Required
- Security team (for security packages)
- Tech lead (for major versions)
- One senior developer (for all)

### Risk Assessment
- Risk level: LOW | MEDIUM | HIGH
- Rollback plan: [How to rollback if issues occur]
```

---

## Additional Resources

### Links
- [npm audit documentation](https://docs.npmjs.com/cli/audit)
- [Snyk documentation](https://docs.snyk.io/)
- [Semantic Versioning](https://semver.org/)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)

### Tools
- Dependabot (built into GitHub)
- npm audit (built into npm)
- Snyk (for deeper analysis)
- WhiteSource (enterprise)

### Training
- Security update process: [Video link]
- Version management: [Documentation link]
- Incident response: [Runbook link]

---

## Summary

| Phase | Timeline | Owner | Approval |
|-------|----------|-------|----------|
| Detection | Immediate | Dependabot + Security | N/A |
| Assessment | 1 hour (critical) | Security team | N/A |
| Planning | Same day | Dev lead | Tech lead |
| Update | 1-2 hours | Developer | 1 senior dev |
| Testing | 2-4 hours | QA + Developer | CI/CD pipeline |
| Deployment | 1 hour | DevOps | Senior dev + tech lead |
| Verification | 24 hours | Monitoring | N/A |

---

**Document Version**: 1.0  
**Last Updated**: 2026-08-29  
**Next Review**: 2026-09-29  
**Maintained by**: @security-team @tech-lead
