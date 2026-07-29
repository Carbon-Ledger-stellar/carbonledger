# Development Guidelines

## Pre-commit hooks (issue #647)

CarbonLedger uses the [pre-commit](https://pre-commit.com) framework to
enforce Rust formatting/linting, TypeScript/JavaScript linting, Python
formatting/linting, secret detection, and Conventional Commits message
format before code is committed. See `.pre-commit-config.yaml` for the full
hook list.

### One-command install

Assuming you've already followed `CONTRIBUTING.md` to install Rust,
Node.js, and Python:

```bash
pip install -r requirements-dev.txt && pre-commit install --install-hooks --hook-type pre-commit --hook-type commit-msg
```

That's it — `git commit` now runs the relevant hooks automatically. To run
everything on demand (e.g. before opening a PR):

```bash
pre-commit run --all-files
```

### What each hook checks

| Hook | Tool | Scope | Notes |
|---|---|---|---|
| `rustfmt` | `cargo fmt --check` | `contracts/**/*.rs` | Formatting only — fast regardless of build cache |
| `clippy` | `cargo clippy -- -D warnings` | `contracts/**/*.rs` | Compiles the workspace — see caveat below |
| `eslint-frontend` | `eslint` | `frontend/**/*.{ts,tsx,js,jsx}` | Requires `npm install` in `frontend/` first |
| `black` | `black` | `oracle/`, `scripts/`, `tests/fuzz/`, `generate_png.py` | Config in root `pyproject.toml` |
| `ruff` | `ruff check --fix` | same as black | Config in root `pyproject.toml` |
| `detect-secrets` | `detect-secrets-hook` | all staged files (except lockfiles) | Baseline: `.secrets.baseline` |
| `conventional-commit-msg` | `scripts/check_conventional_commit.py` | commit message | `commit-msg` stage; see below |

Every hook is `repo: local` — nothing is fetched from an external
pre-commit hook repository at install time. Hooks that need a specific
working directory (rustfmt, clippy, eslint) shell out via a small wrapper
in `scripts/hooks/`; the rest run directly against the already-installed
project tooling.

### Performance: staying under ~30 seconds

Each hook's `files:` pattern (see `.pre-commit-config.yaml`) means it's
**skipped entirely** when your changeset doesn't touch that language —
that's the main lever for keeping a typical PR's hook run fast, since
`clippy` and `eslint` can't easily be scoped to individual changed files
the way `black`/`ruff` can.

**Caveat:** `clippy` compiles the `contracts/` workspace, so it relies on
cargo's incremental build cache (`contracts/target/`) to stay fast. The
*first* run in a fresh clone or after `cargo clean` will take noticeably
longer than 30 seconds — that's expected. Subsequent runs, with a warm
cache, are fast because only the crates touched by your change need
recompiling.

### Conventional Commits

Commit messages must follow `<type>(<optional scope>)!: <description>`,
type one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`. Examples:

```
feat(marketplace): add bulk purchase discount tiers
fix: correct off-by-one in serial range validation
docs(benchmarking): document regression threshold
```

`git merge`/`git revert` commits and `fixup!`/`squash!` messages are
exempted automatically.

### Secret detection baseline

`.secrets.baseline` is the `detect-secrets` allowlist — findings already in
it are treated as reviewed/accepted (test fixtures, dummy keys, etc.), and
only *new* findings block the commit. When you intentionally add something
that looks like a secret to a config file (a new dummy test key, a
documented placeholder, etc.), regenerate the baseline and commit it:

```bash
detect-secrets scan --baseline .secrets.baseline
git add .secrets.baseline
```

Never regenerate the baseline to silence a finding you haven't actually
reviewed — that defeats the point of the check.

### Rollout note for this initial setup

This is a **new** hook suite being introduced into an existing codebase
that wasn't previously enforcing these tools. Two things to expect:

1. `.secrets.baseline` currently has empty `results` — it hasn't been
   scanned against the existing repo yet. Before `detect-secrets` is
   treated as a hard gate for everyone, run `detect-secrets scan --baseline
   .secrets.baseline` once locally and commit the result, so pre-existing
   test fixtures (dummy Stellar keys, HMAC test secrets, etc.) are
   baselined rather than flagged as new findings on unrelated PRs.
2. `pre-commit run --all-files` (what CI runs, see below) checks the
   *entire* repository, not just changed files. If the existing codebase
   isn't already 100% `black`/`ruff`/`clippy`-clean, the first CI run after
   this lands may fail on pre-existing files. The fix is a one-time
   "bring the repo into compliance" pass (`cargo fmt`, `black .`,
   `ruff check --fix .`, `npx eslint --fix .` from `frontend/`), not a
   change to the hook config.

### CI enforcement

The `pre-commit` job in `.github/workflows/ci.yml` runs
`pre-commit run --all-files` on every PR and fails the build on any
violation, using the same `.pre-commit-config.yaml` you run locally.
