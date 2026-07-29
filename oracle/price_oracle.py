"""
price_oracle.py
Fetches carbon credit benchmark prices from Xpansiv CBL, Toucan Protocol, and
Stellar DEX (SDEX), cross-validates prices with Z-score / median-deviation
outlier detection, then pushes the validated consensus price to the
carbon_oracle contract every 12 hours. Alerts admin if price deviation exceeds
15% from the last pushed value.

Feature #537: Price feed cross-validation with outlier detection.
"""

import json
import math
import os
import statistics
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
from circuit_breaker import get_circuit_breaker, get_all_health, CircuitOpenError  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY    = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID   = os.environ["CARBON_ORACLE_CONTRACT_ID"]
STELLAR_RPC_URL      = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK_PASSPHRASE   = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
XPANSIV_API_KEY      = os.environ.get("XPANSIV_API_KEY", "")
TOUCAN_API_KEY       = os.environ.get("TOUCAN_API_KEY", "")
ADMIN_ALERT_WEBHOOK  = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
BACKEND_API_URL      = os.environ.get("BACKEND_API_URL", "http://localhost:3001/api/v1")
BACKEND_JWT_TOKEN    = os.environ.get("BACKEND_JWT_TOKEN", "")  # Used for authenticated POSTs
SDEX_HORIZON_URL     = os.environ.get("SDEX_HORIZON_URL", "https://horizon.stellar.org")
PRICE_DEVIATION_ALERT = 0.15   # 15%
ZSCORE_THRESHOLD      = 2.5    # |z| beyond which a price is flagged as outlier
USDC_STROOPS          = 10_000_000  # 1 USDC = 10^7 stroops

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
# Circuit breaker for Soroban RPC calls (Feature #586)
_rpc_circuit = get_circuit_breaker("price_oracle_rpc")

# ── Price feed fetchers ───────────────────────────────────────────────────────

def fetch_xpansiv_prices() -> list[dict]:
    """Fetch benchmark prices from Xpansiv CBL API.

    Returns a list of dicts with at minimum:
        methodology (str), vintage_year (int), price_usd (float), volume (float)
    """
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
    """Fetch benchmark prices from Toucan Protocol price feed.

    Returns a list of dicts with at minimum:
        methodology (str), vintage_year (int), price_usd (float), volume (float)
    """
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


def fetch_sdex_prices() -> list[dict]:
    """Fetch carbon credit prices from the Stellar DEX (SDEX) via Horizon API.

    Queries the order-book / trade aggregations for known carbon credit asset
    codes against USDC and derives a mid-market price per methodology/vintage.

    The Horizon ``/trade_aggregations`` endpoint is used with a 24-hour window
    so the returned price reflects recent market activity.

    Known carbon credit asset codes on Stellar (testnet + mainnet):
        VCS  — Verra Voluntary Carbon Standard credits
        GS   — Gold Standard credits
        ACM  — American Carbon Registry Methodology
        CAR  — Climate Action Reserve
        REDD — REDD+ forestry credits

    Asset issuers are read from environment variables
    (e.g. SDEX_VCS_ISSUER, SDEX_GS_ISSUER …).  If an issuer is not
    configured the asset is skipped.

    Returns a list of dicts compatible with the price aggregation pipeline:
        methodology (str), vintage_year (int), price_usd (float), volume (float)
    """
    # Map of methodology code → environment variable that holds the Stellar
    # asset issuer account ID.  Operators configure these in .env.
    ASSET_ISSUERS: dict[str, str] = {
        "VCS":  os.environ.get("SDEX_VCS_ISSUER",  ""),
        "GS":   os.environ.get("SDEX_GS_ISSUER",   ""),
        "ACM":  os.environ.get("SDEX_ACM_ISSUER",  ""),
        "CAR":  os.environ.get("SDEX_CAR_ISSUER",  ""),
        "REDD": os.environ.get("SDEX_REDD_ISSUER", ""),
    }
    # USDC on Stellar (mainnet / testnet)
    USDC_ISSUER = os.environ.get(
        "USDC_ISSUER",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    )

    results: list[dict] = []

    for methodology, issuer in ASSET_ISSUERS.items():
        if not issuer:
            log.debug("SDEX issuer for %s not configured — skipping", methodology)
            continue

        # We treat all SDEX prices as vintage 0 = "spot / undifferentiated"
        # because SDEX assets are not currently labelled by vintage on-chain.
        # Operators can override this by adding a SDEX_<CODE>_VINTAGE variable.
        vintage_year = int(os.environ.get(f"SDEX_{methodology}_VINTAGE", "0"))

        # Query trade aggregations for the last 24 hours (resolution = 3600000 ms = 1 h)
        now_ms    = int(time.time() * 1000)
        start_ms  = now_ms - 86_400_000  # 24 h ago

        url = (
            f"{SDEX_HORIZON_URL}/trade_aggregations"
            f"?base_asset_type=credit_alphanum4"
            f"&base_asset_code={methodology}"
            f"&base_asset_issuer={issuer}"
            f"&counter_asset_type=credit_alphanum4"
            f"&counter_asset_code=USDC"
            f"&counter_asset_issuer={USDC_ISSUER}"
            f"&resolution=3600000"
            f"&start_time={start_ms}"
            f"&end_time={now_ms}"
            f"&order=desc"
            f"&limit=24"
        )

        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            records = resp.json().get("_embedded", {}).get("records", [])

            if not records:
                log.debug("No SDEX trade data for %s", methodology)
                continue

            # Compute volume-weighted average price across all returned buckets.
            total_volume = 0.0
            total_vwap   = 0.0
            for rec in records:
                try:
                    avg_price = float(rec.get("avg", 0))
                    base_vol  = float(rec.get("base_volume", 0))
                    if avg_price > 0 and base_vol > 0:
                        total_vwap   += avg_price * base_vol
                        total_volume += base_vol
                except (TypeError, ValueError):
                    continue

            if total_volume == 0:
                continue

            vwap = total_vwap / total_volume
            results.append(
                {
                    "methodology":  methodology,
                    "vintage_year": vintage_year,
                    "price_usd":    vwap,
                    "volume":       total_volume,
                    "source":       "sdex",
                }
            )
            log.info(
                "SDEX price for %s/%d: $%.4f (vol=%.2f)",
                methodology, vintage_year, vwap, total_volume,
            )

        except Exception as e:
            log.error("SDEX fetch failed for %s: %s", methodology, e)

    return results


# ── Price aggregation (legacy — used as fallback) ─────────────────────────────

def aggregate_prices(xpansiv: list[dict], toucan: list[dict]) -> dict[tuple[str, int], float]:
    """
    Calculate volume-weighted average price per (methodology, vintage_year).
    Returns prices in USD (float).

    This function is retained as a fallback when cross-validation cannot
    obtain prices from at least 2 independent sources for a given key.
    """
    buckets: dict[tuple[str, int], list[tuple[float, float]]] = {}

    for item in xpansiv:
        key    = (item.get("methodology", "VCS"), int(item.get("vintage_year", 2023)))
        price  = float(item.get("price_usd", 0))
        volume = float(item.get("volume", 1))
        if price > 0:
            buckets.setdefault(key, []).append((price, volume))

    for item in toucan:
        key    = (item.get("methodology", "VCS"), int(item.get("vintage_year", 2023)))
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


# ── Cross-validation ──────────────────────────────────────────────────────────

def cross_validate_prices(
    sources: dict[str, list[dict]],
) -> dict[tuple[str, int], float]:
    """Cross-validate prices from multiple independent feeds.

    Algorithm
    ---------
    For each ``(methodology, vintage_year)`` group:

    1. Collect every price from every source that reported it.
    2. **Skip** the key if fewer than 2 *distinct sources* contributed a price
       (prevents single-source noise from reaching the oracle contract).
    3. Compute the population mean and standard deviation of all collected
       prices.
    4. Compute a Z-score for every price:  ``z = (x - mean) / std``
       If ``std == 0`` (all prices identical) no outlier can exist → return mean.
    5. Flag a price as an **outlier** if either:
       - ``|z| > ZSCORE_THRESHOLD``  (default 2.5 σ)
       - ``|price - median| / median > 0.15``  (>15% deviation from median)
    6. If **any** outlier is found:
       - Log a structured warning containing all source prices and the
         detection rationale.
       - Return the **median** of all prices for that key (robust to outliers).
    7. If **no** outlier is found: return the simple arithmetic mean.

    Edge cases handled
    ------------------
    - Empty source list or all-NaN prices → key is skipped.
    - Single price value (std == 0, or only one reading after NaN removal)
      → no z-score outlier possible; 15%-deviation check still applies but
      requires a median, which equals the value itself → no outlier detected
      → returns that value (but key must still satisfy the 2-source minimum).
    - NaN or non-finite prices → silently dropped before any computation.

    Parameters
    ----------
    sources:
        Mapping of ``source_name`` → list of price dicts.  Each dict must
        contain ``methodology`` (str), ``vintage_year`` (int/str), and
        ``price_usd`` (float).

    Returns
    -------
    dict mapping ``(methodology, vintage_year)`` → validated USD price (float).
    """
    # Step 1 — collect prices per key, tracking which source each came from.
    # Structure: {key: [(source_name, price), ...]}
    raw: dict[tuple[str, int], list[tuple[str, float]]] = {}

    for source_name, price_list in sources.items():
        if not price_list:
            continue
        for item in price_list:
            try:
                methodology  = str(item.get("methodology", "VCS"))
                vintage_year = int(item.get("vintage_year", 2023))
                price_usd    = float(item.get("price_usd", 0))
            except (TypeError, ValueError):
                continue

            # Drop zero, negative, NaN, and infinite prices
            if not math.isfinite(price_usd) or price_usd <= 0:
                continue

            key = (methodology, vintage_year)
            raw.setdefault(key, []).append((source_name, price_usd))

    result: dict[tuple[str, int], float] = {}

    for key, entries in raw.items():
        methodology, vintage_year = key

        # Step 2 — require at least 2 distinct sources
        distinct_sources = {src for src, _ in entries}
        if len(distinct_sources) < 2:
            log.debug(
                "cross_validate: skipping %s/%d — only 1 source (%s)",
                methodology, vintage_year, next(iter(distinct_sources)),
            )
            continue

        prices = [p for _, p in entries]

        # Step 3 — basic statistics
        n    = len(prices)
        mean = statistics.mean(prices)
        med  = statistics.median(prices)

        # Step 4 — standard deviation (population)
        if n == 1:
            # Cannot compute std with a single value; no z-score outlier possible.
            std = 0.0
        else:
            try:
                std = statistics.pstdev(prices)
            except statistics.StatisticsError:
                std = 0.0

        # Step 5 — flag outliers
        outlier_details: list[dict] = []

        for src, price in entries:
            reasons: list[str] = []

            # Z-score check (only meaningful when std > 0)
            if std > 0:
                z = (price - mean) / std
                if abs(z) > ZSCORE_THRESHOLD:
                    reasons.append(f"z={z:.3f} exceeds threshold {ZSCORE_THRESHOLD}")

            # Median-deviation check
            if med > 0:
                dev = abs(price - med) / med
                if dev > PRICE_DEVIATION_ALERT:
                    reasons.append(f"median_dev={dev:.1%} exceeds 15%")

            if reasons:
                outlier_details.append(
                    {"source": src, "price_usd": price, "reasons": reasons}
                )

        # Step 6/7 — choose final price
        if outlier_details:
            log.warning(
                "cross_validate: OUTLIER DETECTED for %s/%d — "
                "falling back to median $%.4f. "
                "All source prices: %s. "
                "Flagged: %s",
                methodology,
                vintage_year,
                med,
                {src: price for src, price in entries},
                outlier_details,
            )
            result[key] = med
        else:
            result[key] = mean
            log.debug(
                "cross_validate: %s/%d consensus mean=$%.4f "
                "(sources=%s, n=%d)",
                methodology, vintage_year, mean, list(distinct_sources), n,
            )

    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

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
                "methodology":  methodology,
                "vintageYear":  vintage_year,
                "priceStroops": str(stroops),
                "deviation":    deviation,
            },
            headers={"Authorization": f"Bearer {BACKEND_JWT_TOKEN}"} if BACKEND_JWT_TOKEN else {},
            timeout=10,
        )
        if resp.status_code == 201:
            log.info(
                "Price update held in backend for approval: %s/%d",
                methodology, vintage_year,
            )
            alert_admin(
                f"🚨 Price update HELD for {methodology}/{vintage_year} "
                f"due to {deviation:.1%} deviation."
            )
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

        server   = SorobanServer(STELLAR_RPC_URL)
        keypair  = Keypair.from_secret(ORACLE_SECRET_KEY)
        approvals = resp.json()

        for app in approvals:
            if app["status"] == "Approved":
                methodology  = app["methodology"]
                vintage_year = int(app["vintageYear"])
                stroops      = int(app["priceStroops"])

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
                    log.info(
                        "Successfully pushed approved price: %s/%d (tx %s)",
                        methodology, vintage_year, tx_hash,
                    )
                except Exception as e:
                    log.error(
                        "Failed to push approved price %s/%d: %s",
                        methodology, vintage_year, e,
                    )
    except Exception as e:
        log.error("Failed to process approved prices: %s", e)


# ── Core update logic ─────────────────────────────────────────────────────────

def update_prices():
    """Main price oracle update cycle.

    1. Fetch prices from all three sources (Xpansiv, Toucan, SDEX).
    2. Run cross-validation with outlier detection.
    3. Fall back to the legacy volume-weighted aggregate for any
       (methodology, vintage_year) pair that had fewer than 2 sources.
    4. Apply the per-key deviation guard against the last pushed price.
    5. Submit validated prices to the Soroban oracle contract.
    """
    log.info("Starting price oracle update cycle")
    server  = SorobanServer(STELLAR_RPC_URL)
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)

    # ── Fetch from all sources in parallel (sequential is fine at 12-h cadence)
    xpansiv_data = fetch_xpansiv_prices()
    toucan_data  = fetch_toucan_prices()
    sdex_data    = fetch_sdex_prices()

    # ── Build the sources dict for cross-validation
    sources: dict[str, list[dict]] = {
        "xpansiv": xpansiv_data,
        "toucan":  toucan_data,
        "sdex":    sdex_data,
    }

    # ── Primary path: cross-validation (requires ≥2 sources per key)
    prices = cross_validate_prices(sources)

    # ── Fallback: aggregate prices for keys that cross-validation skipped
    #    (i.e. only 1 source available for that methodology/vintage).
    all_raw_keys: set[tuple[str, int]] = set()
    for price_list in sources.values():
        for item in price_list:
            try:
                key = (
                    str(item.get("methodology", "VCS")),
                    int(item.get("vintage_year", 2023)),
                )
                price = float(item.get("price_usd", 0))
                if price > 0:
                    all_raw_keys.add(key)
            except (TypeError, ValueError):
                continue

    fallback_keys = all_raw_keys - set(prices.keys())
    if fallback_keys:
        log.info(
            "Running aggregate_prices fallback for %d key(s) not covered "
            "by cross-validation: %s",
            len(fallback_keys), fallback_keys,
        )
        fallback_prices = aggregate_prices(xpansiv_data, toucan_data)
        for key in fallback_keys:
            if key in fallback_prices:
                prices[key] = fallback_prices[key]
                log.info(
                    "Fallback aggregate price for %s/%d: $%.4f",
                    key[0], key[1], fallback_prices[key],
                )

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

    # ── Submit validated prices on-chain
    pushed = 0
    for (methodology, vintage_year), price_usd in prices.items():
        stroops = to_stroops(price_usd)
        key     = (methodology, vintage_year)

        if key in _last_prices:
            last      = _last_prices[key]
            deviation = abs(stroops - last) / last if last > 0 else 0
            if deviation > PRICE_DEVIATION_ALERT:
                log.warning(
                    "⚠️ High price deviation detected for %s/%d: %s",
                    methodology, vintage_year, f"{deviation:.1%}",
                )
                hold_price_update(methodology, vintage_year, stroops, deviation)
                continue  # HOLD: do not submit on-chain

        is_fallback = both_feeds_failed

        try:
            tx_hash = _rpc_circuit.call(
                build_and_submit,
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
            log.info(
                "Updated price %s/%d → $%.2f USD (tx %s)",
                methodology, vintage_year, price_usd, tx_hash,
            )
            pushed += 1

        except CircuitOpenError as e:
            log.warning(
                "RPC circuit OPEN for %s/%d — skipping price update: %s",
                methodology, vintage_year, e,
            )
        except Exception as e:
            log.error(
                "Failed to push price for %s/%d: %s",
                methodology, vintage_year, e,
            )

    log.info("Price oracle update cycle complete — %d prices pushed", pushed)


# ── Health endpoint (Flask, daemon thread) ────────────────────────────────────

from flask import Flask as _Flask, jsonify as _jsonify
import threading as _threading

_health_app = _Flask("price_oracle_health")


@_health_app.route("/health", methods=["GET"])
def _price_health():
    """Liveness probe exposing circuit-breaker state for all registered circuits."""
    return _jsonify({"status": "ok", "circuits": get_all_health()}), 200


def _start_health_server() -> None:
    port = int(os.environ.get("PRICE_ORACLE_HEALTH_PORT", "5002"))
    log.info("Price oracle health endpoint starting on port %d", port)
    _health_app.run(host="0.0.0.0", port=port, use_reloader=False)


# ── Scheduler ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Start health endpoint in a daemon thread so it doesn't block the scheduler.
    _health_thread = _threading.Thread(target=_start_health_server, daemon=True)
    _health_thread.start()

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
