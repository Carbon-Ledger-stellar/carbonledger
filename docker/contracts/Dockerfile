FROM rust:1.70-slim as builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy source
COPY contracts/ ./contracts/
COPY Cargo.toml Cargo.lock ./

# Build contracts
RUN cargo build --release --target wasm32-unknown-unknown

# Final stage
FROM scratch
COPY --from=builder /app/target/wasm32-unknown-unknown/release/*.wasm /contracts/
