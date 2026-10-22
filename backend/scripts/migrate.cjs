const fs = require('node:fs/promises');
const path = require('node:path');
const pg = require('pg');

async function connectWithRetry(connectionString, maxRetries = 15, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (err) {
      try {
        await client.end();
      } catch {}
      console.warn(
        `[migrate] Database connection attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delayMs}ms...`,
      );
      if (attempt === maxRetries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const migrationsDir = path.resolve(__dirname, '../../database/migrations');
  const client = await connectWithRetry(process.env.DATABASE_URL);
  try {
    // One migrator at a time, including across concurrent API deployments.
    await client.query('SELECT pg_advisory_lock($1)', [8453]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const names = (await fs.readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    for (const name of names) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rowCount) continue;
      console.log(`Applying ${name}`);
      await client.query(await fs.readFile(path.join(migrationsDir, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    }
    console.log(`Database migrations current (${names.length} files)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
