"""
price_oracle.py
Fetches carbon credit benchmark prices from Xpansiv CBL and Toucan Protocol,
calculates weighted average per methodology/vintage, and pushes to carbon_oracle
every 12 hours. Alerts admin if price deviation exceeds 15%.
"""

import json
import os
import time
import logging
import schedule
import requests
from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
from stellar_sdk.soroban_rpc import SendTransactionStatus

load_dotenv()
from log import get_logger  # noqa: E402 — must come after load_dotenv
log = get_logger("price_oracle")

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY    = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID   = os.environ["CARBON_ORACLE_CONTRACT_ID"]
STELLAR_RPC_URL      = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK_PASSPHRASE   = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
XPANSIV_API_KEY      = os.environ.get("XPANSIV_API_KEY", "")
TOUCAN_API_KEY       = os.environ.get("TOUCAN_API_KEY", "")
ADMIN_ALERT_WEBHOOK  = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
BACKEND_API_URL      = os.environ.get("BACKEND_API_URL", "http://localhost:3001/api/v1")
BACKEND_JWT_TOKEN    = os.environ.get("BACKEND_JWT_TOKEN", "") # Used for authenticated POSTs
PRICE_DEVIATION_ALERT = 0.15  # 15%
USDC_STROOPS         = 10_000_000  # 1 USDC = 10^7 stroops

# Maximum age (seconds) for a cached price to be used as fallback (48 hours)
MAX_FALLBACK_AGE_SECS = 48 * 60 * 60

# In-memory cache of last pushed prices for deviation detection
_last_prices: dict[tuple[str, int], int] = {}

# ── Redis client for last-good price persistence ─────────────────────────────

_redis_client = None

def _get_redis():
    """Lazily initialize a Redis connection. Returns None if unavailable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis as redis_lib
        _redis_client = redis_lib.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            password=os.environ.get("REDIS_PASSWORD") or None,
            decode_responses=True,
            socket_connect_timeout=5,
        )
        _redis_client.ping()
        return _redis_client
    except Exception as e:
        log.warning("Redis unavailable, fallback disabled: %s", e)
        _redis_client = None
        return None


def _last_good_key(methodology: str, vintage: int) -> str:
    return f"carbonledger:price:last_good:{methodology}:{vintage}"


def persist_last_good_price(methodology: str, vintage: int, stroops: int) -> None:
    """Persist a verified price to Redis as the last-known-good value."""
    r = _get_redis()
    if r is None:
        return
    try:
        payload = json.dumps({
            "stroops": stroops,
            "saved_at": int(time.time()),
        })
        r.set(_last_good_key(methodology, vintage), payload)
    except Exception as e:
        log.error("Failed to persist last-good price for %s/%d: %s", methodology, vintage, e)


def load_last_good_price(methodology: str, vintage: int) -> tuple[int, float] | None:
    """Load last-known-good price from Redis.

    Returns (stroops, age_seconds) or None if unavailable / stale.
    """
    r = _get_redis()
    if r is None:
        return None
    try:
        raw = r.get(_last_good_key(methodology, vintage))
        if not raw:
            return None
        data = json.loads(raw)
        stroops = int(data["stroops"])
        saved_at = int(data["saved_at"])
        age = time.time() - saved_at
        if age > MAX_FALLBACK_AGE_SECS:
            log.warning("Cached price for %s/%d is stale (%.0fs old, max %ds)",
                        methodology, vintage, age, MAX_FALLBACK_AGE_SECS)
            return None
        return stroops, age
    except Exception as e:
        log.error("Failed to load last-good price for %s/%d: %s", methodology, vintage, e)
        return None

# ── Price feed fetchers ───────────────────────────────────────────────────────

def fetch_xpansiv_prices() -> list[dict]:
    """Fetch benchmark prices from Xpansiv CBL API."""
    if not XPANSIV_API_KEY:
        log.warning("XPANSIV_API_KEY not set — skipping Xpansiv feed")
        return []
    try:
        resp = requests.get(
            "https://api.xpansiv.com/v1/carbon/benchmarks",
            headers={"X-API-Key": XPANSIV_API_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("benchmarks", [])
    except Exception as e:
        log.error("Xpansiv fetch failed: %s", e)
        return []

def fetch_toucan_prices() -> list[dict]:
    """Fetch benchmark prices from Toucan Protocol price feed."""
    if not TOUCAN_API_KEY:
        log.warning("TOUCAN_API_KEY not set — skipping Toucan feed")
        return []
    try:
        resp = requests.get(
            "https://api.toucan.earth/v1/prices",
            headers={"Authorization": f"Bearer {TOUCAN_API_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("prices", [])
    except Exception as e:
        log.error("Toucan fetch failed: %s", e)
        return []

# ── Price aggregation ─────────────────────────────────────────────────────────

def aggregate_prices(xpansiv: list[dict], toucan: list[dict]) -> dict[tuple[str, int], float]:
    """
    Calculate volume-weighted average price per (methodology, vintage_year).
    Returns prices in USD (float).
    """
    buckets: dict[tuple[str, int], list[tuple[float, float]]] = {}

    for item in xpansiv:
        key = (item.get("methodology", "VCS"), int(item.get("vintage_year", 2023)))
        price  = float(item.get("price_usd", 0))
        volume = float(item.get("volume", 1))
        if price > 0:
            buckets.setdefault(key, []).append((price, volume))

    for item in toucan:
        key = (item.get("methodology", "VCS"), int(item.get("vintage_year", 2023)))
        price  = float(item.get("price_usd", 0))
        volume = float(item.get("volume", 1))
        if price > 0:
            buckets.setdefault(key, []).append((price, volume))

    result = {}
    for key, entries in buckets.items():
        total_volume = sum(v for _, v in entries)
        if total_volume == 0:
            continue
        wavg = sum(p * v for p, v in entries) / total_volume
        result[key] = wavg

    return result

def to_stroops(usd: float) -> int:
    return int(usd * USDC_STROOPS)

# ── Stellar submission ────────────────────────────────────────────────────────

def build_and_submit(server: SorobanServer, keypair: Keypair, function_name: str, args: list) -> str:
    account = server.load_account(keypair.public_key)
    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=NETWORK_PASSPHRASE,
            base_fee=300,
        )
        .append_invoke_contract_function_op(
            contract_id=ORACLE_CONTRACT_ID,
            function_name=function_name,
            parameters=args,
        )
        .set_timeout(30)
        .build()
    )
    tx = server.prepare_transaction(tx)
    tx.sign(keypair)
    response = server.send_transaction(tx)

    if response.status == SendTransactionStatus.ERROR:
        raise RuntimeError(f"Transaction failed: {response.error_result_xdr}")

    for _ in range(20):
        time.sleep(3)
        result = server.get_transaction(response.hash)
        if result.status == "SUCCESS":
            return response.hash
        if result.status == "FAILED":
            raise RuntimeError(f"Transaction FAILED: {result}")

    raise TimeoutError(f"Transaction {response.hash} not confirmed")

def alert_admin(message: str):
    if not ADMIN_ALERT_WEBHOOK:
        log.warning("ADMIN ALERT: %s", message)
        return
    try:
        requests.post(ADMIN_ALERT_WEBHOOK, json={"text": message}, timeout=10)
    except Exception as e:
        log.error("Alert webhook failed: %s", e)

def hold_price_update(methodology: str, vintage_year: int, stroops: int, deviation: float):
    """Notify backend to hold a price update for admin approval."""
    try:
        resp = requests.post(
            f"{BACKEND_API_URL}/oracle/price-approvals/hold",
            json={
                "methodology": methodology,
                "vintageYear": vintage_year,
                "priceStroops": str(stroops),
                "deviation": deviation,
            },
            headers={"Authorization": f"Bearer {BACKEND_JWT_TOKEN}"} if BACKEND_JWT_TOKEN else {},
            timeout=10,
        )
        if resp.status_code == 201:
            log.info("Price update held in backend for approval: %s/%d", methodology, vintage_year)
            alert_admin(f"🚨 Price update HELD for {methodology}/{vintage_year} due to {deviation:.1%} deviation.")
        else:
            log.error("Failed to hold price update in backend: %s", resp.text)
    except Exception as e:
        log.error("Failed to contact backend for hold: %s", e)


def _set_fallback_gauge(value: int) -> None:
    """Set the oracle_using_fallback_price Prometheus gauge.

    Writes a Prometheus text format metric to a file or stdout.
    In production, use the prometheus_client library; here we emit
    a simple metric line that can be scraped by Prometheus.
    """
    try:
        from prometheus_client import Gauge, REGISTRY
        gauge_name = "oracle_using_fallback_price"
        # Reuse existing gauge if already registered
        gauge = None
        for collector in list(REGISTRY._names_to_collectors.values()):
            if getattr(collector, "_name", None) == gauge_name:
                gauge = collector
                break
        if gauge is None:
            gauge = Gauge(gauge_name, "1 when oracle is using fallback price data",
                          ["methodology", "vintage"])
        # We set a global flag; methodology/vintage are set per-price
        gauge.labels(methodology="*", vintage="*").set(value)
    except ImportError:
        # prometheus_client not installed — emit a structured log instead
        if value:
            log.warning("PROMETHEUS: oracle_using_fallback_price=1")
        else:
            log.info("PROMETHEUS: oracle_using_fallback_price=0")


def _load_fallback_prices() -> dict[tuple[str, int], float]:
    """Load prices from Redis cache for all previously persisted methodology/vintage pairs.

    Returns a dict mapping (methodology, vintage) → price_usd.
    """
    fallback_prices: dict[tuple[str, int], float] = {}
    r = _get_redis()
    if r is None:
        return fallback_prices

    try:
        # Scan for all last_good keys
        cursor = 0
        pattern = "carbonledger:price:last_good:*"
        while True:
            cursor, keys = r.scan(cursor=cursor, match=pattern, count=100)
            for key in keys:
                try:
                    raw = r.get(key)
                    if not raw:
                        continue
                    data = json.loads(raw)
                    stroops = int(data["stroops"])
                    saved_at = int(data["saved_at"])
                    age = time.time() - saved_at

                    if age > MAX_FALLBACK_AGE_SECS:
                        log.warning("Skipping stale fallback price: %s (age %.0fs)", key, age)
                        continue

                    # Parse methodology and vintage from key
                    # Format: carbonledger:price:last_good:{methodology}:{vintage}
                    parts = key.split(":")
                    methodology = parts[4]
                    vintage = int(parts[5])
                    price_usd = stroops / USDC_STROOPS

                    fallback_prices[(methodology, vintage)] = price_usd
                    log.info("Loaded fallback price %s/%d → $%.2f USD (age %.0fs)",
                             methodology, vintage, price_usd, age)
                except Exception as e:
                    log.error("Failed to parse fallback price key %s: %s", key, e)

            if cursor == 0:
                break
    except Exception as e:
        log.error("Failed to scan Redis for fallback prices: %s", e)

    return fallback_prices

def process_approved_prices():
    """Poll backend for approved price updates and submit them on-chain."""
    log.info("Checking for approved price updates...")
    try:
        resp = requests.get(
            f"{BACKEND_API_URL}/oracle/price-approvals",
            headers={"Authorization": f"Bearer {BACKEND_JWT_TOKEN}"} if BACKEND_JWT_TOKEN else {},
            timeout=10,
        )
        if resp.status_code != 200:
            log.error("Failed to fetch approvals: %s", resp.text)
            return

        server  = SorobanServer(STELLAR_RPC_URL)
        keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
        approvals = resp.json()

        for app in approvals:
            if app["status"] == "Approved":
                methodology = app["methodology"]
                vintage_year = int(app["vintageYear"])
                stroops = int(app["priceStroops"])
                
                log.info("Pushing APPROVED price: %s/%d", methodology, vintage_year)
                try:
                    tx_hash = build_and_submit(
                        server, keypair,
                        "update_credit_price",
                        [
                            scval.to_address(keypair.public_key),
                            scval.to_string(methodology),
                            scval.to_uint32(vintage_year),
                            scval.to_int128(stroops),
                        ],
                    )
                    log.info("Successfully pushed approved price: %s/%d (tx %s)", methodology, vintage_year, tx_hash)
                    
                    # Mark as finalized in backend (optional, but good practice)
                    # For this simulation, we'll just log it.
                except Exception as e:
                    log.error("Failed to push approved price %s/%d: %s", methodology, vintage_year, e)
    except Exception as e:
        log.error("Failed to process approved prices: %s", e)

# ── Core update logic ─────────────────────────────────────────────────────────

def update_prices():
    log.info("Starting price oracle update cycle")
    server  = SorobanServer(STELLAR_RPC_URL)
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)

    xpansiv_data = fetch_xpansiv_prices()
    toucan_data  = fetch_toucan_prices()
    prices       = aggregate_prices(xpansiv_data, toucan_data)

    both_feeds_failed = len(xpansiv_data) == 0 and len(toucan_data) == 0
    feed_names = []
    feed_errors = []

    if not xpansiv_data:
        feed_names.append("Xpansiv")
        feed_errors.append("Xpansiv CBL feed unavailable")
    if not toucan_data:
        feed_names.append("Toucan")
        feed_errors.append("Toucan Protocol feed unavailable")

    if both_feeds_failed:
        log.warning("Both price feeds failed — attempting fallback to last-known-good prices")
        _set_fallback_gauge(1)
        alert_admin(
            f"Price oracle fallback activated: {', '.join(feed_errors)}. "
            f"Attempting to use cached prices from Redis."
        )
        prices = _load_fallback_prices()
    else:
        _set_fallback_gauge(0)

    if not prices:
        log.warning("No price data available from any feed or cache")
        return

    for (methodology, vintage_year), price_usd in prices.items():
        stroops = to_stroops(price_usd)
        key     = (methodology, vintage_year)

        if key in _last_prices:
            last = _last_prices[key]
            deviation = abs(stroops - last) / last if last > 0 else 0
            if deviation > PRICE_DEVIATION_ALERT:
                log.warning(f"⚠️ High price deviation detected for {methodology}/{vintage_year}: {deviation:.1%}")
                hold_price_update(methodology, vintage_year, stroops, deviation)
                continue # HOLD: do not submit on-chain

        is_fallback = both_feeds_failed

        try:
            tx_hash = build_and_submit(
                server, keypair,
                "update_credit_price",
                [
                    scval.to_address(keypair.public_key),
                    scval.to_string(methodology),
                    scval.to_uint32(vintage_year),
                    scval.to_int128(stroops),
                ],
            )
            _last_prices[key] = stroops

            if not is_fallback:
                persist_last_good_price(methodology, vintage_year, stroops)

            log.info("Updated price %s/%d → $%.2f USD (tx %s)%s",
                     methodology, vintage_year, price_usd, tx_hash,
                     " [fallback]" if is_fallback else "")

        except Exception as e:
            log.error("Failed to push price for %s/%d: %s", methodology, vintage_year, e)

    log.info("Price oracle update cycle complete — %d prices pushed", len(prices))

# ── Scheduler ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Price oracle starting — updating every 12 hours")
    update_prices()
    schedule.every(12).hours.do(update_prices)
    
    # Check for approvals more frequently (e.g. every 5 minutes)
    log.info("Approval poller starting — checking every 5 minutes")
    process_approved_prices()
    schedule.every(5).minutes.do(process_approved_prices)

    while True:
        schedule.run_pending()
        time.sleep(60)
