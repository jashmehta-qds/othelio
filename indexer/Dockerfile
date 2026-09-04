# Stage 1: Build stage
FROM rust:1.80-alpine as builder

RUN apk add --no-libc-dev build-base openssl-dev pkgconfig

WORKDIR /app
COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

# Stage 2: Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates libgcc openssl

WORKDIR /app
COPY --from=builder /app/target/release/othelio-indexer /app/othelio-indexer

ENV RUST_LOG=info

CMD ["/app/othelio-indexer"]
