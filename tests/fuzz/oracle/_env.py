"""Shared test bootstrap: put oracle/ on sys.path and stub required env vars
before any oracle module is imported, so module-level `os.environ[...]`
reads (ORACLE_SECRET_KEY, CARBON_ORACLE_CONTRACT_ID, ...) don't raise.

Mirrors the pattern already used by oracle/test_price_cross_validation.py,
oracle/test_satellite_webhook_auth.py, and oracle/test_verification_cache.py.
"""

import os
import sys

_ORACLE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "oracle")
)
if _ORACLE_DIR not in sys.path:
    sys.path.insert(0, _ORACLE_DIR)

os.environ.setdefault(
    "ORACLE_SECRET_KEY", "SDUMMYKEYFORTEST000000000000000000000000000000000000000"
)
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID", "C" + "A" * 55)
os.environ.setdefault("CARBON_REGISTRY_CONTRACT_ID", "C" + "B" * 55)
os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("GEE_WEBHOOK_SECRET", "")
