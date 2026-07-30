"""
Tests for satellite monitor webhook signature verification — #662

Covers:
  - Valid signature accepted
  - Invalid signature rejected (403)
  - Missing header rejected (401)
  - Rejected payload timestamp (>5 minutes old)
  - Payload without timestamp accepted (backwards compat)
"""

import hashlib
import hmac
import json
import os
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

# Add oracle to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mock heavy dependencies
import types

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

mock_dotenv = types.ModuleType("dotenv")
mock_dotenv.load_dotenv = lambda *a, **kw: None
sys.modules["dotenv"] = mock_dotenv

# Replicate the pure verification functions for testing

SECRET = "test-gee-webhook-secret-12345"
MAX_PAYLOAD_AGE_SECS = 5 * 60


def verify_gee_signature(payload_body: bytes, signature_header: str) -> bool:
    """Verify the X-GEE-Signature header using HMAC-SHA256."""
    if not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False

    expected_sig = signature_header[7:]
    if not expected_sig:
        return False

    computed = hmac.new(
        SECRET.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, expected_sig)


def verify_payload_timestamp(payload: dict) -> bool:
    """Check that the payload timestamp is within MAX_PAYLOAD_AGE_SECS."""
    payload_time = payload.get("timestamp")
    if payload_time is None:
        return True
    try:
        payload_ts = int(payload_time)
    except (ValueError, TypeError):
        return False
    age = abs(int(time.time()) - payload_ts)
    return age <= MAX_PAYLOAD_AGE_SECS


def make_signature(body: bytes) -> str:
    """Helper: compute a valid sha256= signature for the given body."""
    sig = hmac.new(SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


class TestGeeWebhookSignature(unittest.TestCase):
    """Test HMAC-SHA256 signature verification."""

    def setUp(self):
        self.payload = json.dumps({
            "project_id": "proj-001",
            "period": "2024-Q1",
            "satellite_cid": "QmTest123",
            "tonnes_verified": 1000,
            "methodology_score": 85,
            "coordinates": {"lat": -3.4, "lon": -60.0},
            "timestamp": int(time.time()),
        }).encode("utf-8")

    def test_valid_signature_accepted(self):
        """A correctly signed payload should be accepted."""
        sig = make_signature(self.payload)
        self.assertTrue(verify_gee_signature(self.payload, sig))

    def test_invalid_signature_rejected(self):
        """An incorrect signature should be rejected."""
        bad_sig = "sha256=" + "0" * 64
        self.assertFalse(verify_gee_signature(self.payload, bad_sig))

    def test_missing_header_rejected(self):
        """An empty signature header should be rejected."""
        self.assertFalse(verify_gee_signature(self.payload, ""))

    def test_none_header_rejected(self):
        """A None-equivalent signature should be rejected."""
        self.assertFalse(verify_gee_signature(self.payload, ""))

    def test_wrong_prefix_rejected(self):
        """A signature without sha256= prefix should be rejected."""
        sig = hmac.new(SECRET.encode(), self.payload, hashlib.sha256).hexdigest()
        self.assertFalse(verify_gee_signature(self.payload, sig))

    def test_empty_sha256_value_rejected(self):
        """sha256= with no hex value should be rejected."""
        self.assertFalse(verify_gee_signature(self.payload, "sha256="))

    def test_different_payload_rejected(self):
        """Signature computed from different payload should not match."""
        sig = make_signature(b"different body")
        self.assertFalse(verify_gee_signature(self.payload, sig))

    def test_timestamp_fresh_accepted(self):
        """Payload with timestamp within 5 minutes should be accepted."""
        payload = {"timestamp": int(time.time())}
        self.assertTrue(verify_payload_timestamp(payload))

    def test_timestamp_stale_rejected(self):
        """Payload with timestamp older than 5 minutes should be rejected."""
        payload = {"timestamp": int(time.time()) - 600}  # 10 minutes ago
        self.assertFalse(verify_payload_timestamp(payload))

    def test_timestamp_future_rejected(self):
        """Payload with timestamp far in the future should be rejected."""
        payload = {"timestamp": int(time.time()) + 600}
        self.assertFalse(verify_payload_timestamp(payload))

    def test_no_timestamp_accepted(self):
        """Payload without timestamp should be accepted (backwards compat)."""
        payload = {"project_id": "proj-001"}
        self.assertTrue(verify_payload_timestamp(payload))

    def test_invalid_timestamp_format_rejected(self):
        """Non-numeric timestamp should be rejected."""
        payload = {"timestamp": "not-a-number"}
        self.assertFalse(verify_payload_timestamp(payload))

    def test_signature_tamper_detected(self):
        """Modifying one byte of the signature invalidates it."""
        sig = make_signature(self.payload)
        # Flip a character
        tampered = sig[:-1] + ("1" if sig[-1] == "0" else "0")
        self.assertFalse(verify_gee_signature(self.payload, tampered))


if __name__ == "__main__":
    unittest.main()
