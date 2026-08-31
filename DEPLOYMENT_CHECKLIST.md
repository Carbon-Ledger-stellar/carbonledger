# Project Registration with Documents - Deployment Checklist

## Pre-Deployment Review

- [ ] Read `IMPLEMENTATION_SUMMARY.md` for overview
- [ ] Review all modified files in `backend/src/projects/`
- [ ] Review new test file `backend/test/projects-register-documents.e2e-spec.ts`
- [ ] Review API docs in `backend/docs/PROJECT_REGISTRATION_DOCUMENTS.md`

## Code Changes to Review

### Modified Files (4)
1. [ ] `backend/src/projects/projects.controller.ts`
   - New endpoint: POST /projects/register-with-documents
   - New imports: FileInterceptor, UploadedFile, UseInterceptors

2. [ ] `backend/src/projects/projects.dto.ts`
   - New DTO: RegisterProjectWithDocumentsDto
   - Validation rules imported from existing validators

3. [ ] `backend/src/projects/projects.service.ts`
   - New method: registerWithDocuments()
   - New dependency: IpfsUploadService
   - File validation: type (PDF/PNG), size (≤10MB)

4. [ ] `backend/src/projects/projects.module.ts`
   - New import: UploadsModule
   - Ensures IpfsUploadService available to ProjectsService

### New Files (2)
1. [ ] `backend/test/projects-register-documents.e2e-spec.ts`
   - 20+ comprehensive test cases
   - All error scenarios covered
   - Integration tests verify database

2. [ ] `backend/docs/PROJECT_REGISTRATION_DOCUMENTS.md`
   - Complete API documentation
   - Usage examples (cURL, JavaScript, Python)
   - Troubleshooting guide

## Pre-Deployment Testing

### Run Existing Tests (Ensure No Regression)

```bash
# Run all project tests
npm run test:e2e -- projects

# Run existing projects e2e tests
npm run test:e2e -- projects.e2e-spec
```

**Expected**: ✓ All tests pass (no regression)

### Run New Tests

```bash
# Run new feature tests
npm run test:e2e -- projects-register-documents

# Expected: 20+ tests pass
```

**Expected**: ✓ All tests pass

### Manual Testing (Optional)

1. **Happy Path**
   - Register project with valid PDF
   - Verify CID returned
   - Verify project in database
   - Verify document accessible via gateway

2. **Error Paths**
   - Test with oversized file (>10MB)
   - Test with invalid file type (JPEG)
   - Test without authentication
   - Test with insufficient permissions

## Environment Configuration

### Required Environment Variables (Verify Existing)

```
IPFS_API_URL=https://api.pinata.cloud
IPFS_API_KEY=<your-key>
IPFS_SECRET_KEY=<your-secret>
JWT_SECRET=<your-secret>
DATABASE_URL=postgresql://...
```

**Action**: [ ] Confirm all variables are set in deployment environment

### Optional (Already Handled)

```
FRONTEND_URL=https://your-frontend.com
```

## Database Verification

- [ ] CarbonProject table has metadataCid column (nullable string)
- [ ] IPFSFile table exists with required columns
- [ ] Indexes exist on: cid, linkedEntityType, linkedEntityId
- [ ] Database migrations up-to-date

**Check**: Run Prisma migrations

```bash
npx prisma migrate deploy
```

## Dependency Verification

- [ ] NestJS platform-express installed (`@nestjs/platform-express`)
- [ ] File upload functionality available
- [ ] IPFS upload service available (`IpfsUploadService`)
- [ ] All decorators and utilities available

**Check**:
```bash
npm list | grep -E "express|nest"
```

## Security Verification

- [ ] File type validation in place (MIME type check)
- [ ] File size limits enforced (10 MB)
- [ ] JWT authentication required
- [ ] Role-based access control verified (project_developer, admin only)
- [ ] Input sanitization applied
- [ ] Stellar address validation active
- [ ] Error messages don't leak internals

## Performance Verification

- [ ] File upload doesn't block request (async pinning)
- [ ] Response time acceptable for 10 MB files
- [ ] Database indexes present for queries
- [ ] IPFS/Pinata connectivity verified
- [ ] Rate limiting configured (if applicable)

**Test**: Upload 10 MB file and verify response < 5 seconds

## Integration Verification

- [ ] Works with existing authentication
- [ ] Works with existing authorization
- [ ] Existing endpoints still functional
- [ ] No breaking changes introduced
- [ ] Cache invalidation works correctly

**Check**: Run full test suite

```bash
npm run test:e2e
```

## Documentation Deployment

- [ ] API documentation deployed/accessible
  - `backend/docs/PROJECT_REGISTRATION_DOCUMENTS.md`
  - `backend/docs/PROJECT_REGISTRATION_QUICK_START.md`

- [ ] Include in API documentation site
- [ ] Update API specifications/OpenAPI if applicable
- [ ] Communicate to frontend team

## Frontend Integration

- [ ] Frontend developers notified of new endpoint
- [ ] API documentation shared with frontend team
- [ ] Example code provided (JavaScript, React)
- [ ] Error handling tested on frontend
- [ ] File upload UI implemented
- [ ] Form validation implemented

**Provide To Frontend**:
- [ ] Endpoint: POST /projects/register-with-documents
- [ ] Full API docs
- [ ] JavaScript example
- [ ] React component example
- [ ] Common errors and solutions

## Rollout Strategy

### Stage 1: Verification (Pre-Deployment)

```bash
# 1. Code review
# ✓ All changes reviewed by team

# 2. Test locally
npm run test:e2e -- projects-register-documents
# ✓ All tests pass

# 3. Verify no regression
npm run test:e2e -- projects
# ✓ All existing tests pass

# 4. Manual testing
# ✓ Tested with valid files
# ✓ Tested with invalid files
# ✓ Tested error scenarios
```

- [ ] Code review approved
- [ ] All tests passing
- [ ] No regressions found
- [ ] Manual testing complete

### Stage 2: Staging Deployment

```bash
# 1. Deploy to staging environment
# 2. Run test suite against staging
npm run test:e2e -- projects-register-documents --env staging
# ✓ All tests pass

# 3. Manual testing in staging
# - Test with real IPFS/Pinata instance
# - Test with staging database
# - Test with staging auth

# 4. Load testing (optional)
# - Test with concurrent uploads
# - Verify no bottlenecks

# 5. Security testing (optional)
# - Test with oversized files
# - Test with malformed requests
# - Test with invalid tokens
```

- [ ] Deployed to staging
- [ ] Tests pass in staging
- [ ] Manual testing complete
- [ ] No issues found

### Stage 3: Production Deployment

```bash
# 1. Code freeze (no new changes)
# 2. Create release branch
# 3. Deploy to production
# 4. Run smoke tests
# 5. Monitor logs for errors
# 6. Verify in production
```

- [ ] Pre-deployment meeting held
- [ ] Deployment window scheduled
- [ ] Rollback plan documented
- [ ] Team on standby

## Post-Deployment Verification

### Immediate (0-5 minutes)

- [ ] Application started without errors
- [ ] New endpoint accessible
- [ ] Health check passing
- [ ] Logs look normal

**Check**:
```bash
curl -H "Authorization: Bearer {token}" \
  https://api.your-domain.com/projects/register-with-documents \
  -F "projectId=test" ...
```

### Short-term (5-30 minutes)

- [ ] No error rate spike
- [ ] Response times normal
- [ ] Database queries performing
- [ ] IPFS uploads successful
- [ ] No authentication issues

**Monitor**:
- Application logs
- Database metrics
- IPFS/Pinata status
- Error rates

### Medium-term (1-24 hours)

- [ ] Endpoint handling real traffic
- [ ] No unusual errors
- [ ] File uploads working
- [ ] Documents accessible
- [ ] Database integrity maintained

**Check**:
- Log aggregation system
- Monitoring dashboards
- Database backups
- Error tracking

## Rollback Plan

**If issues found during deployment**:

### Immediate Rollback

```bash
# 1. Stop traffic to new endpoint
# 2. Revert code to previous version
# 3. Restart application
# 4. Verify old endpoint still works
```

- [ ] Previous version tagged in git
- [ ] Rollback tested locally
- [ ] Rollback time < 10 minutes

### Post-Rollback Actions

- [ ] Identify root cause
- [ ] Fix issue
- [ ] Redeploy when ready
- [ ] Document incident

## Documentation After Deployment

- [ ] Update API documentation on public docs site
- [ ] Notify API consumers of new endpoint
- [ ] Update changelog/release notes
- [ ] Add to API migration guide (if breaking changes)
- [ ] Provide support contact info

## Team Communication

### Pre-Deployment

- [ ] Notify all stakeholders
- [ ] Provide implementation summary
- [ ] Share testing results
- [ ] Discuss deployment window
- [ ] Confirm rollback procedures

### Post-Deployment

- [ ] Send success notification
- [ ] Provide usage instructions
- [ ] Share API documentation
- [ ] Offer assistance to consumers
- [ ] Ask for feedback

## Monitoring After Deployment

### Metrics to Monitor

- [ ] Endpoint response time (target: <1s for small files)
- [ ] Error rate (target: <1%)
- [ ] IPFS upload success rate (target: >99%)
- [ ] File storage costs (Pinata)
- [ ] Database query performance
- [ ] 10 MB file upload success rate

### Alerts to Configure

- [ ] High error rate (>5%)
- [ ] High response time (>5s)
- [ ] IPFS upload failures
- [ ] Database connection issues
- [ ] Disk space warnings
- [ ] IPFS/Pinata connectivity issues

### Logs to Monitor

```
Search patterns:
- "registerWithDocuments"
- "File size exceeds"
- "Invalid file type"
- "uploadToPinata"
- "pinStatus"
```

## Success Criteria

✅ Deployment successful if:

1. [ ] New endpoint accessible
2. [ ] All tests passing
3. [ ] No regressions in existing functionality
4. [ ] File uploads working correctly
5. [ ] Documents stored in IPFS
6. [ ] Database records created
7. [ ] Error handling working
8. [ ] Authentication/authorization enforced
9. [ ] Response times acceptable
10. [ ] No unusual errors in logs

## Support Resources

### For Developers

- API Documentation: `backend/docs/PROJECT_REGISTRATION_DOCUMENTS.md`
- Quick Start: `backend/docs/PROJECT_REGISTRATION_QUICK_START.md`
- Implementation Details: `IMPLEMENTATION_SUMMARY.md`
- Test Suite: `backend/test/projects-register-documents.e2e-spec.ts`

### For DevOps

- Deployment changes: None (no new services)
- Environment variables: IPFS credentials (already configured)
- Database migrations: None (columns already exist)
- Monitoring: Add alerts for IPFS failures

### For Support Team

- API endpoint: POST /projects/register-with-documents
- File formats: PDF, PNG
- Size limit: 10 MB
- Roles: project_developer, admin
- Common issues: See troubleshooting guide

## Sign-off Checklist

### Development Team

- [ ] Code review completed
- [ ] All tests passing locally
- [ ] No regressions found
- [ ] Documentation complete

### QA Team

- [ ] Test plan reviewed
- [ ] Test cases executed
- [ ] All scenarios covered
- [ ] Edge cases tested

### DevOps Team

- [ ] Deployment plan reviewed
- [ ] Infrastructure ready
- [ ] Monitoring configured
- [ ] Rollback tested

### Product Team

- [ ] Feature requirements met
- [ ] Acceptance criteria verified
- [ ] Documentation reviewed
- [ ] Stakeholders informed

## Final Checklist Before Deploy

- [ ] All code reviewed and approved
- [ ] All tests passing
- [ ] No regressions found
- [ ] Documentation complete
- [ ] Deployment plan confirmed
- [ ] Monitoring configured
- [ ] Team briefed
- [ ] Rollback plan ready
- [ ] Approval from tech lead
- [ ] Deployment window open

---

**Deployment Status**: Ready for Production

**Risk Level**: Low (integrated with existing systems, comprehensive tests)

**Estimated Deployment Time**: 5-10 minutes

**Estimated Rollback Time**: <5 minutes

**Support Contact**: [Your team contact info]

**Last Updated**: 2026-08-30
