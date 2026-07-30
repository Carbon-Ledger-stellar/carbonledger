## Summary

<!-- Describe what this PR changes and why -->

---

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Security patch
- [ ] Documentation
- [ ] Infrastructure / CI

---

## Testing

- [ ] Existing tests pass (`npm test` in `backend/`)
- [ ] New tests added for new functionality
- [ ] E2E tests pass (if applicable)

---

## Security Patch Checklist

**⚠️ If this PR contains a security patch, both boxes must be checked before merge:**

- [ ] **Security patch:** Added a corresponding regression test in `tests/security-regressions/`
      (see [README](../tests/security-regressions/README.md) for instructions)
- [ ] **Test ID assigned:** Updated the test inventory table in `tests/security-regressions/README.md`
      with a new REG-NNN entry linking to this PR or the original issue

> The `security-regression-tests` CI job is a **required check** and cannot be bypassed.
> PRs that introduce a security fix without a regression test will not be merged.

---

## Deployment Notes

<!-- Any migration steps, environment variable changes, or deployment order requirements -->

---

## Checklist

- [ ] Self-review completed
- [ ] No secrets committed
- [ ] Documentation updated (if applicable)
- [ ] Branch protection rules satisfied
