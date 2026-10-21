# Base mainnet deployment

Use one Railway project for the API and indexer, Vercel for the frontend, and Aiven for PostgreSQL. The API needs a public domain; the indexer does not. Keep one replica of each Railway application service initially.

## 1. Database

Create or select an Aiven PostgreSQL service. Copy its Service URI from Aiven's connection panel; it contains `sslmode=require` for encrypted connections. Set this URI as the secret `DATABASE_URL` in both Railway backend services. Place Aiven and Railway in nearby regions to reduce latency and cross-cloud traffic. The API's pre-deploy command applies SQL migrations on every deployment and skips already applied files.

Aiven Free has 1 GB storage and a 20-connection limit. The two application pools are capped at five connections each. Check disk use and upgrade before it fills; the always-on indexer can produce significant history even with few users.

## 2. API

Create a service from this repository, with repository root as its source directory. Set its Dockerfile path to `Dockerfile.backend`. Set pre-deploy command to `node backend/scripts/migrate.cjs` and health check path to `/health`. Give it a public domain.

Set these service variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Aiven PostgreSQL Service URI with `sslmode=require` |
| `NODE_ENV` | `production` |
| `CHAIN_ID` | `8453` |
| `BASE_RPC_URL` | Dedicated Base mainnet server RPC URL |
| `AUTH_SECRET` | Unique random value of at least 32 characters |
| `CORS_ORIGINS` | Exact frontend HTTPS origin, no trailing slash |
| `ENABLE_MOCK_DEX_SWAPS` | `false` |

Railway supplies `PORT`; the API now listens on it. `CORS_ORIGINS` can be set after the Vercel production domain is known, then redeploy the API. Include any Vercel preview origins explicitly if preview deployments should call this API. A custom domain can replace the temporary Railway domain later.

## 3. Indexer

Create a second service from this repository, with **`indexer` as its source directory**. Its existing `Dockerfile` is detected there. Give it no public domain. Set one replica and an always-on restart policy.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Same Aiven PostgreSQL Service URI |
| `CHAIN_ID` | `8453` |
| `RPC_URL` | Dedicated Base mainnet server RPC URL |
| `RPC_URL_SECONDARY` | Independent, capacity-backed Base RPC URL |
| `FACTORY_ADDRESS` | `0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D` |
| `MODULE_ADDRESS` | `0x245836a679b69e16617e2055d8d809EA5858c81C` |
| `ASSET_REGISTRY_ADDRESS` | `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` |
| `START_BLOCK` | `52046045` (factory creation block from the checked-in Base broadcast receipt) |
| `BATCH_SIZE` | `9` |
| `INDEXER_CATCHUP_CONCURRENCY` | `3` |
| `INDEXER_CATCHUP_MIN_INTERVAL_MS` | `1000` |
| `INDEXER_HEAD_POLL_INTERVAL_SECS` | `5` |
| `INDEXER_PRICE_INTERVAL_BLOCKS` | `10` |

Do not use `START_BLOCK=latest` on Railway. The local launcher converts that text to a block number; the Rust process itself does not. Omitting it starts about 1,000 blocks behind the current head on an empty Base database, which can miss older baskets. The indexer needs a separate secondary RPC; Base's public endpoint is rate limited. If the contracts are redeployed, update the addresses and deployment block together.

## 4. Vercel frontend

Import this Git repository as a Vercel project. Set the project Root Directory to `fe`, framework to Next.js, and enable **Include source files outside of the Root Directory** so the `packages/shared` workspace is available. `fe/vercel.json` builds that shared package before Next.js. Use Node.js 22. Set these Production environment variables **before the first build** because Next.js embeds `NEXT_PUBLIC_*` values into the browser bundle:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` |
| `NEXT_PUBLIC_BASE_RPC_URL` | Browser-restricted Base RPC URL |
| `NEXT_PUBLIC_BACKEND_URL` | API public HTTPS origin, no trailing slash |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D` |
| `NEXT_PUBLIC_MODULE_ADDRESS` | `0x245836a679b69e16617e2055d8d809EA5858c81C` |
| `NEXT_PUBLIC_ORACLE_ADDRESS` | `0xF80bfa9608dD9BCBC7ed270Fa341C7C423CA2DF7` |
| `NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS` | `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` |
| `NEXT_PUBLIC_ENABLE_MOCK_SWAPS` | `false` |

After its domain is assigned, put that exact origin in the API's `CORS_ORIGINS` and redeploy the API. Changing a `NEXT_PUBLIC_*` value requires a frontend rebuild. Browser RPC URLs are public by design; restrict their key by allowed web origin with the RPC provider.

## Release checks and cost

Open the API `/health` URL; it checks the database connection. Open the Vercel frontend and verify wallet connection, basket list, quotes, and a read against Base. In Railway logs, confirm the indexer advances its event cursor and price worker without RPC rate-limit errors. Check database disk use and indexer lag the next day.

Railway's Pro fee includes a shared usage allowance across the workspace; these two services and your other apps consume it together. Vercel and Aiven are billed separately under their plans. The always-on indexer and frequent RPC reads run even with only one user. Set a Railway workspace usage alert, review per-service usage and Aiven disk use after 24–48 hours, and tune the indexer or RPC plan based on measured usage. Do not set a low workspace hard cap if it would stop your other apps.
