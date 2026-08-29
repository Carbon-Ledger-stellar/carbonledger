"""
test_ipfs_verification.py
Unit tests for IPFS CID verification, multi-node pinning confirmation,
and tamper detection — Issue #536.

Covers:
  - fetch_ipfs_content: success, HTTP error, network failure, retry / backoff
  - verify_content_hash: matching hash, mismatched hash, case-insensitive compare
  - check_pinata_pinning: sufficient pins, insufficient pins, no credentials,
    API error, 401, malformed JSON
  - verify_ipfs_cid pipeline: all-pass, fetch failure, hash mismatch, pinning
    failure, skipped pin check (no Pinata creds)
  - Webhook endpoint integration: missing content_sha256, hash mismatch,
    insufficient pinning, full happy-path
"""

import hashlib
import json
import os
import sys
import time
import types
import unittest
from unittest.mock import MagicMock, patch, call

# ---------------------------------------------------------------------------
# Stub out heavy / environment-dependent imports before importing the module
# ---------------------------------------------------------------------------

# stellar_sdk
mock_stellar = types.ModuleType("stellar_sdk")
mock_stellar.Keypair = MagicMock()
mock_stellar.Network = MagicMock()
mock_stellar.Network.TESTNET_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
mock_stellar.SorobanServer = MagicMock()
mock_stellar.TransactionBuilder = MagicMock()
mock_stellar.scval = MagicMock()
mock_stellar_soroban = types.ModuleType("stellar_sdk.soroban_rpc")
mock_stellar_soroban.SendTransactionStatus = MagicMock()
sys.modules["stellar_sdk"] = mock_stellar
sys.modules["stellar_sdk.soroban_rpc"] = mock_stellar_soroban

# dotenv
mock_dotenv = types.ModuleType("dotenv")
mock_dotenv.load_dotenv = lambda *a, **kw: None
sys.modules["dotenv"] = mock_dotenv

# psycopg2
mock_psycopg2 = types.ModuleType("psycopg2")
mock_psycopg2.connect = MagicMock()
mock_psycopg2.extras = MagicMock()
sys.modules["psycopg2"] = mock_psycopg2
sys.modules["psycopg2.extras"] = MagicMock()

# oracle internal helpers
mock_log_mod = types.ModuleType("log")
mock_log_mod.get_logger = lambda name: MagicMock()
sys.modules["log"] = mock_log_mod

mock_cb = types.ModuleType("circuit_breaker")


class _FakeBreaker:
    def call(self, fn, *args, **kwargs):
        return fn(*args, **kwargs)


mock_cb.get_circuit_breaker = lambda name: _FakeBreaker()
mock_cb.get_all_health = lambda: {}


class CircuitOpenError(Exception):
    pass


mock_cb.CircuitOpenError = CircuitOpenError
sys.modules["circuit_breaker"] = mock_cb

mock_safe_parse = types.ModuleType("utils.safe_parse")
mock_safe_parse.safe_float = lambda v, default=0.0: float(v) if v else default
mock_safe_parse.safe_int = lambda v, default=0: int(v) if v else default
sys.modules["utils"] = types.ModuleType("utils")
sys.modules["utils.safe_parse"] = mock_safe_parse

# Set required env vars so the module-level config assignments don't KeyError
os.environ.setdefault("ORACLE_SECRET_KEY", "S" + "A" * 55)
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID", "CTEST000")

# Now import the module under test
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import satellite_monitor as sm  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_CONTENT = b'{"ndvi": 0.72, "deforestation_pct": 0.1}'
SAMPLE_SHA256 = hashlib.sha256(SAMPLE_CONTENT).hexdigest()
SAMPLE_CID = "QmTestCID1234567890"


def _make_ok_response(content: bytes) -> MagicMock:
    resp = MagicMock()
    resp.status_code = 200
    resp.content = content
    return resp


def _make_pinata_ok_response(count: int) -> MagicMock:
    resp = MagicMock()
    resp.status_code = 200
    rows = [{"status": "pinned"} for _ in range(count)]
    resp.json.return_value = {"count": count, "rows": rows}
    return resp


# ===========================================================================
# fetch_ipfs_content
# ===========================================================================

class TestFetchIpfsContent(unittest.TestCase):
    """Tests for the fetch_ipfs_content retry / back-off logic."""

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_success_on_first_attempt(self, mock_get, mock_sleep):
        mock_get.return_value = _make_ok_response(SAMPLE_CONTENT)
        result = sm.fetch_ipfs_content(SAMPLE_CID)
        self.assertEqual(result, SAMPLE_CONTENT)
        mock_sleep.assert_not_called()

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_success_on_second_attempt(self, mock_get, mock_sleep):
        """First call returns HTTP 503, second returns 200."""
        bad_resp = MagicMock()
        bad_resp.status_code = 503
        mock_get.side_effect = [bad_resp, _make_ok_response(SAMPLE_CONTENT)]
        result = sm.fetch_ipfs_content(SAMPLE_CID)
        self.assertEqual(result, SAMPLE_CONTENT)
        self.assertEqual(mock_get.call_count, 2)
        mock_sleep.assert_called_once()

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_all_retries_exhausted_raises(self, mock_get, mock_sleep):
        """All attempts return HTTP 500 → IPFSContentError raised."""
        bad_resp = MagicMock()
        bad_resp.status_code = 500
        mock_get.return_value = bad_resp
        with self.assertRaises(sm.IPFSContentError):
            sm.fetch_ipfs_content(SAMPLE_CID)
        self.assertEqual(mock_get.call_count, sm.IPFS_MAX_RETRIES)

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_network_exception_retried(self, mock_get, mock_sleep):
        """ConnectionError on every attempt → IPFSContentError."""
        import requests as req_mod
        mock_get.side_effect = req_mod.ConnectionError("timeout")
        with self.assertRaises(sm.IPFSContentError):
            sm.fetch_ipfs_content(SAMPLE_CID)

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_exponential_backoff_delays(self, mock_get, mock_sleep):
        """Sleep is called with increasing delays between retries."""
        bad_resp = MagicMock()
        bad_resp.status_code = 503
        # Succeed on the last possible attempt
        mock_get.side_effect = [bad_resp, bad_resp, _make_ok_response(SAMPLE_CONTENT)]
        sm.IPFS_MAX_RETRIES_orig = sm.IPFS_MAX_RETRIES
        # Patch to 3 retries for this test
        original_max = sm.IPFS_MAX_RETRIES
        sm.IPFS_MAX_RETRIES = 3
        try:
            sm.fetch_ipfs_content(SAMPLE_CID)
        finally:
            sm.IPFS_MAX_RETRIES = original_max
        # Delays should be base * 2^0 = 1s, base * 2^1 = 2s
        delays = [c.args[0] for c in mock_sleep.call_args_list]
        self.assertEqual(len(delays), 2)
        self.assertAlmostEqual(delays[1], delays[0] * 2, places=5)

    @patch("satellite_monitor.time.sleep")
    @patch("satellite_monitor.requests.get")
    def test_gateway_url_constructed_correctly(self, mock_get, mock_sleep):
        """URL sent to requests.get includes the gateway base + CID."""
        mock_get.return_value = _make_ok_response(SAMPLE_CONTENT)
        sm.fetch_ipfs_content("QmABC123")
        called_url = mock_get.call_args.args[0]
        self.assertIn("QmABC123", called_url)
        self.assertIn(sm.IPFS_GATEWAY_URL.rstrip("/"), called_url)


# ===========================================================================
# verify_content_hash
# ===========================================================================

class TestVerifyContentHash(unittest.TestCase):
    """Tests for SHA-256 hash comparison."""

    def test_matching_hash_returns_true(self):
        self.assertTrue(sm.verify_content_hash(SAMPLE_CONTENT, SAMPLE_SHA256))

    def test_mismatched_hash_returns_false(self):
        bad_hash = "a" * 64
        self.assertFalse(sm.verify_content_hash(SAMPLE_CONTENT, bad_hash))

    def test_hash_comparison_case_insensitive(self):
        """Uppercase hex digest should still match."""
        self.assertTrue(sm.verify_content_hash(SAMPLE_CONTENT, SAMPLE_SHA256.upper()))

    def test_empty_content_has_known_hash(self):
        empty_sha256 = hashlib.sha256(b"").hexdigest()
        self.assertTrue(sm.verify_content_hash(b"", empty_sha256))

    def test_corrupted_single_byte_detected(self):
        """Flipping one byte in content must cause hash mismatch."""
        corrupted = bytearray(SAMPLE_CONTENT)
        corrupted[0] ^= 0xFF
        self.assertFalse(sm.verify_content_hash(bytes(corrupted), SAMPLE_SHA256))


# ===========================================================================
# check_pinata_pinning
# ===========================================================================

class TestCheckPinataPinning(unittest.TestCase):
    """Tests for Pinata API pin-count verification."""

    def setUp(self):
        # Store original env values and clear credentials
        self._orig_jwt = sm.PINATA_JWT
        self._orig_key = sm.PINATA_API_KEY
        self._orig_secret = sm.PINATA_API_SECRET

    def tearDown(self):
        sm.PINATA_JWT = self._orig_jwt
        sm.PINATA_API_KEY = self._orig_key
        sm.PINATA_API_SECRET = self._orig_secret

    def test_no_credentials_returns_minus_one(self):
        """Without credentials the check is skipped and -1 is returned."""
        sm.PINATA_JWT = ""
        sm.PINATA_API_KEY = ""
        sm.PINATA_API_SECRET = ""
        result = sm.check_pinata_pinning(SAMPLE_CID)
        self.assertEqual(result, -1)

    @patch("satellite_monitor.requests.get")
    def test_sufficient_pins_returns_count(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        sm.PINATA_API_KEY = ""
        sm.PINATA_API_SECRET = ""
        mock_get.return_value = _make_pinata_ok_response(4)
        count = sm.check_pinata_pinning(SAMPLE_CID)
        self.assertEqual(count, 4)

    @patch("satellite_monitor.requests.get")
    def test_insufficient_pins_returns_low_count(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        sm.PINATA_API_KEY = ""
        sm.PINATA_API_SECRET = ""
        mock_get.return_value = _make_pinata_ok_response(1)
        count = sm.check_pinata_pinning(SAMPLE_CID)
        self.assertEqual(count, 1)
        self.assertLess(count, sm.IPFS_MIN_PIN_NODES)

    @patch("satellite_monitor.requests.get")
    def test_zero_pins_returns_zero(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        mock_get.return_value = _make_pinata_ok_response(0)
        count = sm.check_pinata_pinning(SAMPLE_CID)
        self.assertEqual(count, 0)

    @patch("satellite_monitor.requests.get")
    def test_api_key_and_secret_used_when_no_jwt(self, mock_get):
        sm.PINATA_JWT = ""
        sm.PINATA_API_KEY = "mykey"
        sm.PINATA_API_SECRET = "mysecret"
        mock_get.return_value = _make_pinata_ok_response(3)
        sm.check_pinata_pinning(SAMPLE_CID)
        headers_sent = mock_get.call_args.kwargs.get("headers", {})
        self.assertIn("pinata_api_key", headers_sent)
        self.assertIn("pinata_secret_api_key", headers_sent)
        self.assertNotIn("Authorization", headers_sent)

    @patch("satellite_monitor.requests.get")
    def test_jwt_preferred_over_key_secret(self, mock_get):
        sm.PINATA_JWT = "myjwt"
        sm.PINATA_API_KEY = "mykey"
        sm.PINATA_API_SECRET = "mysecret"
        mock_get.return_value = _make_pinata_ok_response(3)
        sm.check_pinata_pinning(SAMPLE_CID)
        headers_sent = mock_get.call_args.kwargs.get("headers", {})
        self.assertIn("Authorization", headers_sent)
        self.assertTrue(headers_sent["Authorization"].startswith("Bearer "))

    @patch("satellite_monitor.requests.get")
    def test_api_401_raises_pinning_error(self, mock_get):
        sm.PINATA_JWT = "badjwt"
        resp = MagicMock()
        resp.status_code = 401
        mock_get.return_value = resp
        with self.assertRaises(sm.IPFSPinningError):
            sm.check_pinata_pinning(SAMPLE_CID)

    @patch("satellite_monitor.requests.get")
    def test_api_500_raises_pinning_error(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        resp = MagicMock()
        resp.status_code = 500
        resp.text = "Internal Server Error"
        mock_get.return_value = resp
        with self.assertRaises(sm.IPFSPinningError):
            sm.check_pinata_pinning(SAMPLE_CID)

    @patch("satellite_monitor.requests.get")
    def test_malformed_json_raises_pinning_error(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        resp = MagicMock()
        resp.status_code = 200
        resp.json.side_effect = ValueError("No JSON")
        mock_get.return_value = resp
        with self.assertRaises(sm.IPFSPinningError):
            sm.check_pinata_pinning(SAMPLE_CID)

    @patch("satellite_monitor.requests.get")
    def test_network_error_raises_pinning_error(self, mock_get):
        sm.PINATA_JWT = "testjwt"
        import requests as req_mod
        mock_get.side_effect = req_mod.ConnectionError("unreachable")
        with self.assertRaises(sm.IPFSPinningError):
            sm.check_pinata_pinning(SAMPLE_CID)

    @patch("satellite_monitor.requests.get")
    def test_only_pinned_rows_counted(self, mock_get):
        """Rows with status other than 'pinned' should not be counted."""
        sm.PINATA_JWT = "testjwt"
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "count": 4,
            "rows": [
                {"status": "pinned"},
                {"status": "pinning"},
                {"status": "pinned"},
                {"status": "failed"},
            ],
        }
        mock_get.return_value = resp
        count = sm.check_pinata_pinning(SAMPLE_CID)
        self.assertEqual(count, 2)  # only 2 out of 4 are "pinned"


# ===========================================================================
# verify_ipfs_cid (full pipeline)
# ===========================================================================

class TestVerifyIpfsCid(unittest.TestCase):
    """Integration tests for the full IPFS verification pipeline."""

    def setUp(self):
        self._orig_jwt = sm.PINATA_JWT
        self._orig_key = sm.PINATA_API_KEY
        self._orig_secret = sm.PINATA_API_SECRET

    def tearDown(self):
        sm.PINATA_JWT = self._orig_jwt
        sm.PINATA_API_KEY = self._orig_key
        sm.PINATA_API_SECRET = self._orig_secret

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_all_checks_pass(self, mock_fetch, mock_pin):
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.return_value = 3  # exactly the minimum
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        self.assertTrue(ok)
        self.assertEqual(reason, "ok")

    @patch("satellite_monitor.fetch_ipfs_content")
    def test_fetch_failure_returns_ipfs_unavailable(self, mock_fetch):
        mock_fetch.side_effect = sm.IPFSContentError("gateway down")
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        self.assertFalse(ok)
        self.assertEqual(reason, "ipfs_unavailable")

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_hash_mismatch_returns_hash_mismatch(self, mock_fetch, mock_pin):
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.return_value = 5
        wrong_hash = "b" * 64
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, wrong_hash)
        self.assertFalse(ok)
        self.assertEqual(reason, "hash_mismatch")

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_missing_expected_hash_rejected(self, mock_fetch, mock_pin):
        mock_fetch.return_value = SAMPLE_CONTENT
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, "")
        self.assertFalse(ok)
        self.assertEqual(reason, "missing_expected_hash")
        mock_pin.assert_not_called()

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_insufficient_pinning_returns_error(self, mock_fetch, mock_pin):
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.return_value = 1  # below minimum
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        self.assertFalse(ok)
        self.assertEqual(reason, "insufficient_pinning")

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_pinning_check_error_returns_error(self, mock_fetch, mock_pin):
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.side_effect = sm.IPFSPinningError("API 500")
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        self.assertFalse(ok)
        self.assertEqual(reason, "pinning_check_error")

    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_skipped_pin_check_still_passes(self, mock_fetch, mock_pin):
        """pin_count == -1 (no credentials) should not block submission."""
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.return_value = -1
        ok, reason = sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        self.assertTrue(ok)
        self.assertEqual(reason, "ok")

    @patch("satellite_monitor.alert_admin")
    @patch("satellite_monitor.check_pinata_pinning")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_hash_mismatch_fires_admin_alert(self, mock_fetch, mock_pin, mock_alert):
        mock_fetch.return_value = SAMPLE_CONTENT
        mock_pin.return_value = 5
        sm.verify_ipfs_cid(SAMPLE_CID, "a" * 64)
        mock_alert.assert_called_once()
        alert_msg = mock_alert.call_args.args[0]
        self.assertIn("tamper", alert_msg.lower())

    @patch("satellite_monitor.alert_admin")
    @patch("satellite_monitor.fetch_ipfs_content")
    def test_fetch_failure_fires_admin_alert(self, mock_fetch, mock_alert):
        mock_fetch.side_effect = sm.IPFSContentError("down")
        sm.verify_ipfs_cid(SAMPLE_CID, SAMPLE_SHA256)
        mock_alert.assert_called_once()


# ===========================================================================
# Webhook endpoint integration
# ===========================================================================

class TestWebhookIpfsIntegration(unittest.TestCase):
    """Test the /webhook/satellite endpoint with IPFS verification wired in."""

    def setUp(self):
        sm.app.config["TESTING"] = True
        self.client = sm.app.test_client()
        # Disable HMAC auth for these integration tests
        self._orig_secret = sm.GEE_WEBHOOK_SECRET
        sm.GEE_WEBHOOK_SECRET = ""

    def tearDown(self):
        sm.GEE_WEBHOOK_SECRET = self._orig_secret

    def _valid_payload(self, **overrides) -> dict:
        base = {
            "project_id": "proj-001",
            "period": "2024-Q1",
            "satellite_cid": SAMPLE_CID,
            "content_sha256": SAMPLE_SHA256,
            "tonnes_verified": 1000,
            "methodology_score": 85,
            "coordinates": {"lat": -3.4, "lon": -60.0},
            "timestamp": int(time.time()),
        }
        base.update(overrides)
        return base

    @patch("satellite_monitor.build_and_submit")
    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_happy_path_returns_submitted(self, mock_verify, mock_coords, mock_submit):
        mock_verify.return_value = (True, "ok")
        mock_coords.return_value = None  # skip coord check
        mock_submit.return_value = "txhash123"

        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(self._valid_payload()),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "submitted")

    def test_missing_content_sha256_rejected(self):
        payload = self._valid_payload()
        del payload["content_sha256"]
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        body = resp.get_json()
        self.assertIn("content_sha256", body.get("error", ""))

    def test_empty_content_sha256_rejected(self):
        payload = self._valid_payload(content_sha256="   ")
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_hash_mismatch_returns_422(self, mock_verify, mock_coords):
        mock_verify.return_value = (False, "hash_mismatch")
        mock_coords.return_value = None
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(self._valid_payload()),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 422)
        body = resp.get_json()
        self.assertEqual(body["reason"], "hash_mismatch")

    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_ipfs_unavailable_returns_503(self, mock_verify, mock_coords):
        mock_verify.return_value = (False, "ipfs_unavailable")
        mock_coords.return_value = None
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(self._valid_payload()),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 503)

    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_insufficient_pinning_returns_422(self, mock_verify, mock_coords):
        mock_verify.return_value = (False, "insufficient_pinning")
        mock_coords.return_value = None
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(self._valid_payload()),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 422)
        body = resp.get_json()
        self.assertEqual(body["reason"], "insufficient_pinning")

    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_pinning_check_error_returns_502(self, mock_verify, mock_coords):
        mock_verify.return_value = (False, "pinning_check_error")
        mock_coords.return_value = None
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(self._valid_payload()),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 502)

    @patch("satellite_monitor.verify_ipfs_cid")
    def test_missing_project_id_rejected_before_ipfs(self, mock_verify):
        payload = self._valid_payload()
        del payload["project_id"]
        resp = self.client.post(
            "/webhook/satellite",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        # IPFS check should not even be reached
        mock_verify.assert_not_called()

    @patch("satellite_monitor.get_project_coordinates")
    @patch("satellite_monitor.verify_ipfs_cid")
    def test_verify_ipfs_cid_called_with_correct_args(self, mock_verify, mock_coords):
        """Ensure verify_ipfs_cid receives the CID and SHA-256 from the payload."""
        mock_verify.return_value = (False, "hash_mismatch")
        mock_coords.return_value = None
        payload = self._valid_payload(
            satellite_cid="QmSpecificCID",
            content_sha256="a" * 64,
        )
        self.client.post(
            "/webhook/satellite",
            data=json.dumps(payload),
            content_type="application/json",
        )
        mock_verify.assert_called_once_with("QmSpecificCID", "a" * 64)


if __name__ == "__main__":
    unittest.main()
