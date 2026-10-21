# Base mainnet deployment

Othelio runs its Node API and Rust indexer in the OpenShip `othelio` project. The separate OpenShip `PostgreSQL + pgAdmin` app owns the persistent database. The frontend runs on Vercel. Production uses chain ID `8453` and the checked-in Base contract addresses; it never starts Anvil or a second PostgreSQL container.

## Compose profiles

| File | Purpose | Chain | Database |
| --- | --- | --- | --- |
| `docker-compose.yml` | OpenShip production API and indexer | Live Base (`8453`) | Private OpenShip PostgreSQL app |
| `docker-compose.staging.yml` | `npm run dev:base` on a developer machine | Live Base (`8453`) | Local PostgreSQL on port `5434` |
| `docker-compose.dev.yml` | Optional `npm run dev:fork` workflow | Local Anvil fork (`31337`) | Separate local PostgreSQL on port `5433` |

The local staging launcher resolves `START_BLOCK=latest` before starting the Rust process. Production pins `START_BLOCK=52046045`, the factory creation block from the checked-in Base broadcast receipt. When contracts are redeployed, update the production addresses and start block together.

## OpenShip production

1. Link the `othelio` OpenShip project to `jashmehta-qds/othelio` on `main`, with the repository root as source and `docker-compose.yml` as the Compose path. The root file defines only `api` and `indexer`. Keep one replica of each; only `api` needs a public HTTPS route on port `3001`.
2. Keep `PostgreSQL + pgAdmin` as a separate app with its persistent volume. Connect its recommended `url` output to the `othelio` project's `DATABASE_URL` using OpenShip's **internal** app connection. Do not publish PostgreSQL's port or put its password in git.
3. Set a unique random `AUTH_SECRET` of at least 32 characters and a dedicated server-side Base mainnet `BASE_RPC_URL` as production secrets. An independent capacity-backed `RPC_URL_SECONDARY` is recommended for the indexer. Set `CORS_ORIGINS` to the frontend's exact HTTPS origin once its domain is known.
4. Deploy the production Compose stack. The API applies SQL migrations before listening; the indexer waits for the API health check. The indexer has no public route. Confirm that OpenShip lists exactly `api` and `indexer` in this project; the separate database app has `postgres` and `pgadmin`.

The production file fixes `CHAIN_ID=8453`, `ENABLE_MOCK_DEX_SWAPS=false`, and the Base factory, module, and registry addresses. Keep RPC credentials in OpenShip variables. Base's public RPC is useful for a short smoke test but is rate limited and not a reliable indexer endpoint.

## Vercel frontend

Import this repository with Root Directory `fe`, enable **Include source files outside of the Root Directory** for `packages/shared`, and use Node.js 22. Set these production variables before the build, because `NEXT_PUBLIC_*` values are embedded in the browser bundle:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` |
| `NEXT_PUBLIC_BASE_RPC_URL` | Browser-restricted Base RPC URL |
| `NEXT_PUBLIC_BACKEND_URL` | OpenShip API HTTPS origin, no trailing slash |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D` |
| `NEXT_PUBLIC_MODULE_ADDRESS` | `0x245836a679b69e16617e2055d8d809EA5858c81C` |
| `NEXT_PUBLIC_ORACLE_ADDRESS` | `0xF80bfa9608dD9BCBC7ed270Fa341C7C423CA2DF7` |
| `NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS` | `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` |
| `NEXT_PUBLIC_ENABLE_MOCK_SWAPS` | `false` |

Use a separate browser RPC key restricted to the Vercel origin. After Vercel assigns a domain, set that exact origin as `CORS_ORIGINS` in OpenShip and redeploy the API. Changing a `NEXT_PUBLIC_*` value requires a new frontend build.

## Release checks and rollback

Open the API `/health` URL and verify its database check. Confirm migrations ran and the indexer advances its event cursor without persistent RPC errors. Check the Vercel frontend, basket reads, and wallet connection; exercise a transaction only when the user is available to sign it. Review PostgreSQL storage and OpenShip service usage after launch.

Before a rollback that follows a schema migration, review the migration's compatibility with the older application version and take a database backup. OpenShip can roll back the application deployment, but that does not reverse database migrations.
