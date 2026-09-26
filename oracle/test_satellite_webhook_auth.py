"""
test_satellite_webhook_auth.py
Unit tests for Feature #585: HMAC-SHA256 webhook signing for satellite_monitor.py.

Test cases:
  - Valid HMAC signature → accepted (200)
  - Invalid signature → rejected (401)
  - Expired timestamp (>5 min old) → rejected (400)
  - Future timestamp (>5 min ahead) → rejected (400)
  - Unknown provider_id → rejected (401)
  - Missing X-Provider-ID → legacy GEE_WEBHOOK_SECRET path used
  - Missing required payload fields → 400
"""

import hashlib
import hmac as _hmac
import json
import os
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

# Ensure we load the module with required env vars set.
os.environ.setdefault("ORACLE_SECRET_KEY",         "SD4NJN4F5675MWLD27U23EPTF22UIBWCWLM66PWMAHV7MXEGZQHFH5PT")
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID", "CDUMMY_CONTRACT")
os.environ.setdefault("GEE_WEBHOOK_SECRET",        "")  # start with no legacy secret
os.environ.setdefault("DATABASE_URL",              "")  # no real DB in unit tests

sys.path.insert(0, os.path.dirname(__file__))

from satellite_monitor import app, verify_webhook_signature, _provider_cache, TIMESTAMP_TOLERANCE

# ── Test helpers ──────────────────────────────────────────────────────────────

PROVIDER_ID  = "gee-provider-1"
PROVIDER_KEY = bytes.fromhex("deadbeef" * 8)  # 32 bytes


def _make_signature(provider_id: str, timestamp: int, body: bytes, key: bytes) -> str:
    """Compute the expected HMAC-SHA256 signature for a request."""
    msg = f"{provider_id}.{timestamp}".encode() + b"." + body
    return _hmac.new(key=key, msg=msg, digestmod=hashlib.sha256).hexdigest()


def _valid_payload() -> dict:
    return {
        "project_id":    "PROJ-001",
        "period":        "2024-Q1",
        "satellite_cid": "QmTest123",
        "tonnes_verified": 500,
        "methodology_score": 85,
        "coordinates":   {"lat": 1.0, "lon": 2.0},
    }


class TestHmacWebhookAuth(unittest.TestCase):

    def setUp(self):
        """Use the Flask test client and inject the provider key via cache."""
        self.client = app.test_client()
        # Inject provider key directly into the in-process cache to avoid DB.
        _provider_cache[PROVIDER_ID] = {
            "key_bytes": PROVIDER_KEY,
            "expires_at": time.monotonic() + 3600,
        }
        # Ensure legacy secret is empty for HMAC tests.
        self._orig_gee_secret = os.environ.get("GEE_WEBHOOK_SECRET", "")
        os.environ["GEE_WEBHOOK_SECRET"] = ""

    def tearDown(self):
        os.environ["GEE_WEBHOOK_SECRET"] = self._orig_gee_secret
        _provider_cache.pop(PROVIDER_ID, None)

    def _post(self, body: dict, timestamp: int = None, signature: str = None,
              provider_id: str = PROVIDER_ID, extra_headers: dict = None):
        """Send a POST /webhook/satellite with HMAC headers."""
        body_bytes = json.dumps(body).encode()
        ts = timestamp if timestamp is not None else int(time.time())
        sig = signature if signature is not None else _make_signature(
            provider_id, ts, body_bytes, PROVIDER_KEY
        )
        headers = {
            "Content-Type":  "application/json",
            "X-Provider-ID": provider_id,
            "X-Timestamp":   str(ts),
            "X-Signature":   sig,
        }
        if extra_headers:
            headers.update(extra_headers)
        return self.client.post("/webhook/satellite", data=body_bytes, headers=headers)

    # ── Test 1: Valid signature ────────────────────────────────────────────────

    @patch("satellite_monitor.get_project_coordinates", return_value=None)
    @patch("satellite_monitor.build_and_submit", return_value="TXHASH123")
    def test_valid_signature_accepted(self, mock_submit, mock_coords):
        """A correctly signed request with a valid timestamp is accepted."""
        resp = self._post(_valid_payload())
        self.assertIn(resp.status_code, (200, 201))
        data = json.loads(resp.data)
        self.assertIn(data.get("status"), ("submitted", "flagged", "ok"))

    # ── Test 2: Invalid signature ──────────────────────────────────────────────

    def test_invalid_signature_rejected_401(self):
        """A request with a tampered signature is rejected with 401."""
        resp = self._post(_valid_payload(), signature="badbadbadbad")
        self.assertEqual(resp.status_code, 401)
        data = json.loads(resp.data)
        self.assertIn("Unauthorized", data.get("error", ""))
        self.assertEqual(data.get("reason"), "invalid_signature")

    # ── Test 3: Expired timestamp ─────────────────────────────────────────────

    def test_expired_timestamp_rejected_400(self):
        """A request with a timestamp >5 min in the past is rejected with 400."""
        old_ts = int(time.time()) - TIMESTAMP_TOLERANCE - 10
        resp = self._post(_valid_payload(), timestamp=old_ts)
        self.assertEqual(resp.status_code, 400)
        data = json.loads(resp.data)
        self.assertIn("expired", data.get("reason", ""))

    # ── Test 4: Future timestamp ──────────────────────────────────────────────

    def test_future_timestamp_rejected_400(self):
        """A request with a timestamp >5 min in the future is rejected with 400."""
        future_ts = int(time.time()) + TIMESTAMP_TOLERANCE + 10
        resp = self._post(_valid_payload(), timestamp=future_ts)
        self.assertEqual(resp.status_code, 400)
        data = json.loads(resp.data)
        self.assertIn("future", data.get("reason", ""))

    # ── Test 5: Unknown provider ──────────────────────────────────────────────

    def test_unknown_provider_rejected_401(self):
        """A request from a provider not in the key registry is rejected with 401."""
        # Remove the known provider and use a different ID.
        _provider_cache.pop(PROVIDER_ID, None)
        _provider_cache["__unknown__"] = {
            "key_bytes": None,   # negative-cache entry
            "expires_at": time.monotonic() + 60,
        }
        resp = self._post(_valid_payload(), provider_id="nonexistent-provider")
        self.assertEqual(resp.status_code, 401)
        data = json.loads(resp.data)
        self.assertEqual(data.get("reason"), "unknown_provider")

    # ── Test 6: Legacy GEE_WEBHOOK_SECRET path ────────────────────────────────

    @patch("satellite_monitor.get_project_coordinates", return_value=None)
    @patch("satellite_monitor.build_and_submit", return_value="TXHASH456")
    def test_legacy_secret_accepted(self, mock_submit, mock_coords):
        """Without X-Provider-ID, legacy X-GEE-Secret comparison is used."""
        body_bytes = json.dumps(_valid_payload()).encode()
        with patch("satellite_monitor.GEE_WEBHOOK_SECRET", "super_secret_token"):
            resp = self.client.post(
                "/webhook/satellite",
                data=body_bytes,
                headers={
                    "Content-Type":  "application/json",
                    "X-GEE-Secret": "super_secret_token",
                    # No X-Provider-ID → legacy path
                },
            )
        self.assertIn(resp.status_code, (200, 201))

    @patch("satellite_monitor.get_project_coordinates", return_value=None)
    def test_legacy_secret_wrong_rejected(self, mock_coords):
        """Wrong legacy X-GEE-Secret is rejected with 401."""
        body_bytes = json.dumps(_valid_payload()).encode()
        with patch("satellite_monitor.GEE_WEBHOOK_SECRET", "correct_secret"):
            resp = self.client.post(
                "/webhook/satellite",
                data=body_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-GEE-Secret": "wrong_secret",
                },
            )
        self.assertEqual(resp.status_code, 401)

    # ── Test 7: Missing required payload fields ────────────────────────────────

    @patch("satellite_monitor.get_project_coordinates", return_value=None)
    def test_missing_payload_fields_rejected_400(self, mock_coords):
        """A request with missing required fields is rejected with 400."""
        incomplete = {"project_id": "PROJ-001"}  # missing period and satellite_cid
        resp = self._post(incomplete)
        self.assertEqual(resp.status_code, 400)

    # ── Test 8: verify_webhook_signature unit tests ────────────────────────────

    def test_verify_missing_provider_id(self):
        """verify_webhook_signature returns 401 when X-Provider-ID is absent."""
        with app.test_request_context(
            "/webhook/satellite",
            method="POST",
            headers={"X-Timestamp": str(int(time.time())), "X-Signature": "sig"},
            data=b"{}",
        ):
            from flask import request as flask_req
            valid, status, reason = verify_webhook_signature(flask_req)
        self.assertFalse(valid)
        self.assertEqual(status, 401)
        self.assertEqual(reason, "missing_provider_id")

    def test_verify_missing_timestamp(self):
        """verify_webhook_signature returns 400 when X-Timestamp is absent."""
        with app.test_request_context(
            "/webhook/satellite",
            method="POST",
            headers={"X-Provider-ID": PROVIDER_ID, "X-Signature": "sig"},
            data=b"{}",
        ):
            from flask import request as flask_req
            valid, status, reason = verify_webhook_signature(flask_req)
        self.assertFalse(valid)
        self.assertEqual(status, 400)
        self.assertEqual(reason, "missing_timestamp")

    def test_verify_missing_signature(self):
        """verify_webhook_signature returns 401 when X-Signature is absent."""
        ts = int(time.time())
        with app.test_request_context(
            "/webhook/satellite",
            method="POST",
            headers={"X-Provider-ID": PROVIDER_ID, "X-Timestamp": str(ts)},
            data=b"{}",
        ):
            from flask import request as flask_req
            valid, status, reason = verify_webhook_signature(flask_req)
        self.assertFalse(valid)
        self.assertEqual(status, 401)
        self.assertEqual(reason, "missing_signature")


class TestHealthEndpoint(unittest.TestCase):
    """The /health endpoint must return 200 and include auth info."""

    def test_health_ok(self):
        client = app.test_client()
        resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("auth", data)


if __name__ == "__main__":
    unittest.main()
