import { DatabaseService } from '../database/database.service';
import { NavCompactionService } from '../baskets/nav-compaction.service';

// Auto-load environment file if DATABASE_URL is not set in shell
if (!process.env.DATABASE_URL) {
  for (const envPath of ['.env.base', '.env', '../.env.base', '../.env']) {
    try {
      process.loadEnvFile?.(envPath);
      if (process.env.DATABASE_URL) break;
    } catch {}
  }
}

async function main() {
  console.log('🧹 [NAV Compaction] Starting historical NAV compaction...');
  const db = new DatabaseService();
  const service = new NavCompactionService(db);

  try {
    const result = await service.compactNavObservations();
    console.log(`✅ [NAV Compaction] Finished.`);
    console.log(`   - Tier 2 (1d–7d @ 10m): ${result.tier2Deleted} pruned`);
    console.log(`   - Tier 3 (7d–30d @ 1h):  ${result.tier3Deleted} pruned`);
    console.log(`   - Tier 4 (>30d @ 1d):    ${result.tier4Deleted} pruned`);
    console.log(`   - Total pruned:          ${result.totalDeleted}`);

    const stats = await db.query(`
      SELECT 
        count(*) as total_rows,
        count(*) FILTER (WHERE kind = 'EVENT') as event_rows,
        count(*) FILTER (WHERE kind = 'HOURLY') as hourly_rows
      FROM basket_nav_observations;
    `);
    const row = stats.rows[0];
    console.log(`📊 [Current DB State] Total observations: ${row.total_rows} (${row.event_rows} user events, ${row.hourly_rows} periodic ticks)`);
  } catch (err) {
    console.error('❌ [NAV Compaction] Error during compaction:', err);
    process.exit(1);
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
