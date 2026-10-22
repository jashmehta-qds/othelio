# Stage 1: Build Next.js standalone
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Build arguments for Next.js NEXT_PUBLIC_* variables
ARG NEXT_PUBLIC_CHAIN_ID=8453
ARG NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
ARG NEXT_PUBLIC_BACKEND_URL=https://othelio-api.opsh.io
ARG NEXT_PUBLIC_FACTORY_ADDRESS=0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D
ARG NEXT_PUBLIC_MODULE_ADDRESS=0x245836a679b69e16617e2055d8d809EA5858c81C
ARG NEXT_PUBLIC_ORACLE_ADDRESS=0xF80bfa9608dD9BCBC7ed270Fa341C7C423CA2DF7
ARG NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS=0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC
ARG NEXT_PUBLIC_ENABLE_MOCK_SWAPS=false

ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_BASE_RPC_URL=$NEXT_PUBLIC_BASE_RPC_URL \
    NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_FACTORY_ADDRESS=$NEXT_PUBLIC_FACTORY_ADDRESS \
    NEXT_PUBLIC_MODULE_ADDRESS=$NEXT_PUBLIC_MODULE_ADDRESS \
    NEXT_PUBLIC_ORACLE_ADDRESS=$NEXT_PUBLIC_ORACLE_ADDRESS \
    NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS=$NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS \
    NEXT_PUBLIC_ENABLE_MOCK_SWAPS=$NEXT_PUBLIC_ENABLE_MOCK_SWAPS

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY fe/package.json fe/package.json
COPY backend/package.json backend/package.json

RUN npm ci

COPY packages/shared packages/shared
COPY fe fe

RUN npm run build -w @othelio/shared && npm run build -w @othelio/fe

# Stage 2: Minimal Node runner
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Copy standalone output and static assets
COPY --from=build /app/fe/.next/standalone ./
COPY --from=build /app/fe/.next/static ./fe/.next/static
COPY --from=build /app/fe/public ./fe/public

EXPOSE 3000

CMD ["node", "fe/server.js"]
