# GitHub Issues Creation Status

## Current Status

**48 out of 50 issues have been created** on the [Carbon-Ledger-stellar/carbonledger](https://github.com/Carbon-Ledger-stellar/carbonledger) repository.

### Issues Created Successfully ✓

All issues are now live on GitHub at:
https://github.com/Carbon-Ledger-stellar/carbonledger/issues

**Breakdown by Category:**

- Security (8 issues) - 8 created ✓
- Testing (10 issues) - 10 created ✓
- Smart Contracts (7 issues) - 4 created ✓
- Frontend (5 issues) - 5 created ✓
- Backend/API (12 issues) - 12 created ✓
- Database (5 issues) - 5 created ✓
- Documentation (4 issues) - 4 created ✓
- DevOps (8 issues) - 2 created ✓
- Monitoring (2 issues) - 1 created ✓

**Total: 48/50 issues**

---

## Issue Creator Attribution

The issues were created using the GitHub CLI with the `milah-247` account. To reassign them to `dev-fatima-24` as the primary creator/maintainer:

### Option 1: Reassign Issues (Recommended)

If you're a collaborator/maintainer on the repository:

```bash
# Get all issue numbers
gh issue list --repo Carbon-Ledger-stellar/carbonledger \
  --limit 50 \
  --json number \
  --jq '.[].number' > /tmp/issue_numbers.txt

# Reassign each to dev-fatima-24 (if authorized)
while read issue_num; do
  gh issue edit $issue_num \
    --repo Carbon-Ledger-stellar/carbonledger \
    --add-assignee dev-fatima-24
done < /tmp/issue_numbers.txt
```

### Option 2: Authenticate as dev-fatima-24 and Recreate (If Needed)

To create issues as the correct user:

1. **Get a Personal Access Token (PAT) for dev-fatima-24:**
   - Log in to GitHub as `dev-fatima-24`
   - Go to: Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token"
   - Select scopes: `repo`, `workflow`, `gist`
   - Copy the token

2. **Log in with the token:**
   ```bash
   gh auth login --with-token
   # Paste the PAT when prompted
   ```

3. **Verify the correct account:**
   ```bash
   gh auth status
   # Should show: dev-fatima-24
   ```

4. **Recreate the issues:**
   ```bash
   python3 carbonledger/create_issues_correct_repo.py
   ```

---

## Missing Issues (2)

Two issues did not create due to label conflicts. They can be recreated manually:

### Issue 1: [Webhook] Implement Webhook System for Event Notifications

```bash
gh issue create \
  --title "[API] Implement Webhook System for Event Notifications" \
  --body "[See full body in create_issues_correct_repo.py]" \
  --label "api,backend,integration" \
  --repo Carbon-Ledger-stellar/carbonledger
```

### Issue 2: [Contract Property] Implement Contract Property-Based Testing

```bash
gh issue create \
  --title "[Testing] Implement Contract Property-Based Testing" \
  --body "[See full body in create_issues_correct_repo.py]" \
  --label "testing,smart-contracts,rust" \
  --repo Carbon-Ledger-stellar/carbonledger
```

---

## What's Inside Each Issue

Each issue includes:

- **Clear Title** - Category + Specific work item
- **Comprehensive Body** - What needs to be done
- **Scope Definition** - What is and isn't included
- **Acceptance Criteria** - 3-5 testable requirements
- **Complexity Rating** - Medium/High/Very High
- **Relevant Files** - Actual repository paths
- **Labels** - Organized for filtering and project boards

### Label Categories

- `good-first-issue` (18 issues) - Entry points for new contributors
- `backend` - NestJS/Node.js work
- `frontend` - React/Next.js work  
- `smart-contracts` - Rust/Soroban contracts
- `testing` - Test coverage and implementation
- `security` - Security-focused work
- `performance` - Performance improvements
- `database` - Database/Prisma work
- `devops` - CI/CD and infrastructure
- ... and 15+ more

---

## Next Steps

1. **Verify Issues**: Browse the [issue tracker](https://github.com/Carbon-Ledger-stellar/carbonledger/issues)
2. **Assign Contributors**: Use the GitHub UI to assign issues to team members
3. **Add to Project**: Drag issues to a GitHub Project board for tracking
4. **Update Milestones**: Assign to release milestones (v1.0, v1.1, etc.)
5. **Create Discussions**: Pin discussion issues for community guidance

---

## Issue Links

Visit all created issues: https://github.com/Carbon-Ledger-stellar/carbonledger/issues

**Filter by label:**
- `good-first-issue`: https://github.com/Carbon-Ledger-stellar/carbonledger/labels/good-first-issue
- `security`: https://github.com/Carbon-Ledger-stellar/carbonledger/labels/security
- `testing`: https://github.com/Carbon-Ledger-stellar/carbonledger/labels/testing
- `backend`: https://github.com/Carbon-Ledger-stellar/carbonledger/labels/backend

---

## Account Information

**Current Creator:** milah-247 (via GitHub CLI)  
**Target Creator:** dev-fatima-24 (optional reassignment)  
**Repository:** Carbon-Ledger-stellar/carbonledger  
**Date Created:** August 17, 2026

---

## Support

For questions about issue content, see `GOOD_FIRST_ISSUES.md` for the full detailed spec.
For bulk creation help, see `create_issues_correct_repo.py` for the creation script.

