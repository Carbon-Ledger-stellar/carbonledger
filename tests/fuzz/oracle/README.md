# Oracle fuzz & property-based tests (issue #641)

Fuzz testing for the Python oracle services (`oracle/verification_listener.py`,
`oracle/price_oracle.py`, `oracle/satellite_monitor.py`), targeting the data
parsing and validation functions that process untrusted external input
(verifier API reports, price-feed JSON, satellite webhook payloads) before
that data reaches the blockchain submission layer.

Two complementary layers:

## 1. Hypothesis property tests (run on every PR)

- `test_hypothesis_verification_listener.py`
- `test_hypothesis_price_oracle.py`
- `test_hypothesis_satellite_monitor.py`

Each file asserts at least 3 invariants per target function (never raises,
output stays within documented bounds, structural properties like symmetry).
Run locally:

```bash
pip install -r ../../../oracle/requirements.txt -r ../../../oracle/requirements-dev.txt
pytest tests/fuzz/oracle/test_hypothesis_*.py -v
```

## 2. Atheris (libFuzzer) harnesses (scheduled / manual — heavier, longer-running)

- `verification_listener/fuzz_validate_methodology_report.py`
- `price_oracle/fuzz_cross_validate_prices.py`
- `satellite_monitor/fuzz_detect_contradiction.py`

Each harness feeds raw bytes, decoded as JSON, straight into the target
function(s). Requires `atheris`, which needs clang and is Linux/macOS only,
so it isn't installed for the PR-blocking `oracle` CI job — it runs in the
scheduled/`workflow_dispatch` `fuzz` job with a short time budget instead
(see `.github/workflows/ci.yml`).

```bash
pip install atheris
python tests/fuzz/oracle/price_oracle/fuzz_cross_validate_prices.py \
    tests/fuzz/oracle/price_oracle/corpus/ -max_total_time=60
```

Each harness also runs with **no** arguments (and without atheris installed)
to replay its committed `corpus/` seeds once as a cheap smoke check — this
is what CI uses when atheris isn't available.

Each `<service>/corpus/` directory holds committed seed payloads (valid,
missing-fields, wrong-types, and NaN/Infinity variants) for reproducibility
and to give the fuzzer a useful starting point instead of empty input.

## Fixing crashes

If either layer finds an unhandled exception, the fix belongs in the
oracle service itself (see `oracle/utils/safe_parse.py` for the
`safe_int`/`safe_float` coercion helpers added for this issue — malformed
untrusted values should degrade to a safe default, not raise), not in the
test. Add the crashing input as a new corpus seed once fixed.
