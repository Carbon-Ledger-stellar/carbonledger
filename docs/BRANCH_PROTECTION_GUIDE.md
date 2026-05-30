# Branch Protection Rules Configuration Guide

This document provides step-by-step instructions for configuring GitHub branch protection rules for the `main` branch.

## Prerequisites

- GitHub repository administrator access
- Repository must be owned by an organization or have appropriate permissions

## Step-by-Step Configuration

### 1. Access Branch Protection Settings

1. Go to your GitHub repository
2. Click on **Settings** tab
3. In the left sidebar, click on **Branches**
4. Under "Branch protection rules", click **Add rule**

### 2. Configure Required Settings

In the branch protection rule configuration form:

#### Basic Settings
- **Branch name pattern**: `main`
- **Require pull request reviews before merging**: ✅ Checked
  - Minimum number of reviewers: `1`
  - Dismiss stale pull request approvals when new commits are pushed: ✅ Checked
- **Require status checks to pass before merging**: ✅ Checked
  - Require branches to be up to date before merging: ✅ Checked
  - Status checks: Select all required CI checks:
    - `CI / backend`
    - `CI / frontend`
    - `CI / contracts`
    - `CI / security-audit`
    - `CI / e2e`
    - Any other critical CI checks
- **Include administrators**: ✅ Checked (to apply rules to admins too)

#### Additional Security Settings
- **Restrict who can push to matching branches**: ✅ Checked
  - Allow force pushes: ❌ Unchecked
  - Allow deletions: ❌ Unchecked
- **Require linear history**: ✅ Checked (optional but recommended)
- **Require signed commits**: ✅ Checked (optional but recommended for security)

### 3. Save Configuration

Click **Create** or **Save changes** to apply the branch protection rules.

## Verification Steps

After configuration, verify the rules are working correctly:

1. Try to push directly to main branch - should be blocked
2. Create a PR targeting main - should require CI checks to pass
3. Create a PR targeting main - should require at least 1 review
4. Push new commits to an existing PR - should dismiss previous reviews

## Troubleshooting

### Common Issues

- **CI checks not appearing**: Ensure CI workflows have proper names and are configured to run on pull_request events
- **Reviews not required**: Check that "Require pull request reviews before merging" is enabled
- **Force pushes still allowed**: Verify "Allow force pushes" is unchecked

### Recovery

If branch protection rules prevent necessary operations:

1. Temporarily disable the rule
2. Perform the required operation
3. Re-enable the rule

## References

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/managing-a-branch-protection-rule)
- [GitHub Best Practices for Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)