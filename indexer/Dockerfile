# Stage 1: Build stage
FROM rust:alpine as builder

RUN apk add --no-cache build-base openssl-dev pkgconfig musl-dev

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
