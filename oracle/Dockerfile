# ── Stage 1: Install dependencies ─────────────────────────────────────────────
# renovate: datasource=docker depName=python versioning=docker
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS deps
WORKDIR /app

# Install build deps needed for some packages (cryptography, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install into a prefix we can copy wholesale into the runner
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
# renovate: datasource=docker depName=python versioning=docker
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS runner
WORKDIR /app

# Security: run as non-root user
RUN groupadd -r oracle && useradd -r -g oracle oracle

# Copy installed packages from deps stage (no gcc needed at runtime)
COPY --from=deps /install /usr/local

# Copy application source
COPY --chown=oracle:oracle . .

# Remove test files and docs to shrink image
RUN find . -name "test_*.py" -delete \
    && find . -name "*.md" -delete \
    && find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

RUN chown -R oracle:oracle /app
USER oracle
EXPOSE 5001

CMD ["python3", "verification_listener.py"]
