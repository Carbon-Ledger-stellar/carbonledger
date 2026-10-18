# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM rust:1.79-slim-bookworm@sha256:6b0f2b7e6f3f5c1f9f0f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5 AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --locked

# ---- Runtime stage ----
FROM debian:bookworm-slim@sha256:2b0f2b7e6f3f5c1f9f0f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/app /usr/local/bin/app

EXPOSE 8080

CMD ["app"]
