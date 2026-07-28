# Contract Performance Benchmarks

Automated regression benchmarks for the most resource-intensive Soroban
contract functions (issue #642): `mint_credits`, `retire_credits`,
`verify_serial_range` (all `carbon_credit`), and `bulk_purchase`
(`carbon_marketplace`).

## What's measured

Each benchmark is a normal `#[test]` in `contracts/<crate>/tests/benchmarks.rs`
that invokes the target function once against a freshly-initialized contract
and reports two kinds of numbers:

1. **Soroban instruction count and memory bytes — measured dynamically**,
   via the host's metering budget (`env.budget()`), which Soroban itself
   uses to enforce the network's per-transaction resource limits. Each
   benchmark snapshots `cpu_instruction_cost()`/`memory_bytes_cost()`
   immediately before and after the call under test and reports the delta,
   so setup cost (contract registration, `initialize`, minting fixture data)
   is excluded from the measurement.
2. **Ledger entry reads/writes — declared, hand-derived from source**, one
   row per `env.storage()` call site in the function under benchmark (see
   `DeclaredIo` in each `tests/benchmarks.rs`). This follows the same
   methodology already established in `docs/resource-profile.md` for
   `carbon_marketplace`. We count *operation sites*, not deduplicated unique
   keys — a key read twice counts as 2 — matching how `docs/resource-profile.md`
   already presents `carbon_marketplace`'s cost tables. This isn't
   dynamically measured because the stable, public way to obtain a footprint
   (unique read/write ledger key sets) from a Soroban SDK test `Env` is the
   host's `simulateTransaction`-style resource estimation, which isn't
   exercised by in-process unit tests — see "Future improvement" below.
   **Whenever a function's storage access pattern changes, update its
   `DeclaredIo` value in the same PR** — this is a manual invariant, not
   CI-enforced, so it lives right next to the test that uses it and is
   called out in code review.

Each test prints one machine-readable line to stdout:

```
BENCH_RESULT {"function":"mint_credits","cpu_instructions":123456,"mem_bytes":7890,"reads":5,"writes":4}
```

## Running locally

```bash
cd contracts
cargo test --test benchmarks -- --nocapture   # per-crate; carbon_credit and carbon_marketplace
```

Or via the same script CI uses, which also does the regression comparison:

```bash
python3 scripts/compare_benchmarks.py --run   # runs cargo test, parses output, compares to baseline
```

## CI integration

The `contract-benchmarks` job in `.github/workflows/ci.yml`:

1. Runs `cargo test --test benchmarks -- --nocapture` for `carbon_credit`
   and `carbon_marketplace`, capturing stdout.
2. Runs `scripts/compare_benchmarks.py`, which parses the `BENCH_RESULT`
   lines into `benchmarks/current.json` and compares each function's
   `cpu_instructions` against `benchmarks/baseline.json` (the committed
   baseline, captured on `main`).
3. **Fails the job — blocking merge — if any function's `cpu_instructions`
   increases by more than 10%** relative to baseline, printing a
   markdown regression report (function, baseline, current, % change) to
   the job summary.
4. Uploads `benchmarks/current.json` and the regression report as a build
   artifact on every run (`actions/upload-artifact`), so results are
   inspectable even when the job passes.

## Updating the baseline

`benchmarks/baseline.json` is a normal committed file, intentionally **not**
auto-updated by CI (no bot-commit step) — resource-usage changes should be
reviewed like any other code change. When a PR intentionally changes a
benchmarked function's cost (e.g. a deliberate optimization, or an accepted
cost increase for a new feature):

1. Run `python3 scripts/compare_benchmarks.py --run` locally, or download
   the `benchmarks/current.json` artifact from the PR's CI run.
2. Replace `benchmarks/baseline.json` with the new numbers in the same PR.
3. Append a row to `benchmarks/history.csv` (see below) so the change is
   visible in the trend history, with the PR number in the `note` column.

## Historical trend data

`benchmarks/history.csv` is the committed trend file: one row per baseline
update, columns `date,function,cpu_instructions,mem_bytes,reads,writes,note`.
Plot it with any spreadsheet tool or a quick pandas/matplotlib script — it's
plain CSV specifically so it doesn't require a hosted dashboard to be
useful. `benchmarks/current.json` (the latest per-run snapshot, uploaded as
a CI artifact) has the same per-function shape.

## Regression threshold

10%, checked against `cpu_instructions` only (the binding resource in
practice — see `docs/resource-profile.md`'s note that instruction budget,
not entry-count limits, is the practical constraint for `bulk_purchase`).
Declared `reads`/`writes` are reported for visibility but are not part of
the automated regression gate, since they're hand-derived rather than
dynamically measured (see above) and change in discrete, code-reviewed
steps rather than drifting.

## Future improvement

If/when the Soroban SDK test harness exposes a stable, public API for
per-call ledger footprint (unique read/write key sets) — analogous to
`env.budget()` but for storage footprint rather than CPU/memory — the
`DeclaredIo` hand-derivation should be replaced with a dynamically measured
value and folded into the automated regression gate.
