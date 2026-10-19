import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface CompactionResult {
  tier2Deleted: number; // 1d to 7d (> 10m)
  tier3Deleted: number; // 7d to 30d (> 1h)
  tier4Deleted: number; // > 30d (> 1d)
  totalDeleted: number;
}

@Injectable()
export class NavCompactionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NavCompactionService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    // Run an initial compaction shortly after boot so local/dev environments never fall behind
    const initialDelay = 5_000;
    setTimeout(() => {
      this.compactNavObservations().catch((err) => {
        this.logger.warn(`Startup NAV compaction failed: ${err.message}`);
      });
    }, initialDelay);

    this.timer = setInterval(() => {
      this.compactNavObservations().catch((err) => {
        this.logger.warn(`Scheduled NAV compaction failed: ${err.message}`);
      });
    }, this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async compactNavObservations(): Promise<CompactionResult> {
    // Tier 2: 1 to 7 days old -> keep 1 per 10 minutes
    const tier2Query = `
      WITH ranked AS (
        SELECT chain_id, basket_address, block_number, kind,
               ROW_NUMBER() OVER (
                 PARTITION BY chain_id, basket_address, 
                              date_bin('10 minutes'::interval, block_timestamp, '2000-01-01Z'::timestamptz)
                 ORDER BY block_timestamp DESC, block_number DESC
               ) AS rank
        FROM basket_nav_observations
        WHERE kind = 'HOURLY'
          AND block_timestamp < NOW() - INTERVAL '1 day'
          AND block_timestamp >= NOW() - INTERVAL '7 days'
      )
      DELETE FROM basket_nav_observations bno
      USING ranked r
      WHERE bno.chain_id = r.chain_id
        AND bno.basket_address = r.basket_address
        AND bno.block_number = r.block_number
        AND bno.kind = r.kind
        AND r.rank > 1;
    `;

    // Tier 3: 7 to 30 days old -> keep 1 per 1 hour
    const tier3Query = `
      WITH ranked AS (
        SELECT chain_id, basket_address, block_number, kind,
               ROW_NUMBER() OVER (
                 PARTITION BY chain_id, basket_address, 
                              date_bin('1 hour'::interval, block_timestamp, '2000-01-01Z'::timestamptz)
                 ORDER BY block_timestamp DESC, block_number DESC
               ) AS rank
        FROM basket_nav_observations
        WHERE kind = 'HOURLY'
          AND block_timestamp < NOW() - INTERVAL '7 days'
          AND block_timestamp >= NOW() - INTERVAL '30 days'
      )
      DELETE FROM basket_nav_observations bno
      USING ranked r
      WHERE bno.chain_id = r.chain_id
        AND bno.basket_address = r.basket_address
        AND bno.block_number = r.block_number
        AND bno.kind = r.kind
        AND r.rank > 1;
    `;

    // Tier 4: > 30 days old -> keep 1 per 1 day
    const tier4Query = `
      WITH ranked AS (
        SELECT chain_id, basket_address, block_number, kind,
               ROW_NUMBER() OVER (
                 PARTITION BY chain_id, basket_address, 
                              date_bin('1 day'::interval, block_timestamp, '2000-01-01Z'::timestamptz)
                 ORDER BY block_timestamp DESC, block_number DESC
               ) AS rank
        FROM basket_nav_observations
        WHERE kind = 'HOURLY'
          AND block_timestamp < NOW() - INTERVAL '30 days'
      )
      DELETE FROM basket_nav_observations bno
      USING ranked r
      WHERE bno.chain_id = r.chain_id
        AND bno.basket_address = r.basket_address
        AND bno.block_number = r.block_number
        AND bno.kind = r.kind
        AND r.rank > 1;
    `;

    const res2 = await this.db.query(tier2Query);
    const res3 = await this.db.query(tier3Query);
    const res4 = await this.db.query(tier4Query);

    const tier2Deleted = res2.rowCount ?? 0;
    const tier3Deleted = res3.rowCount ?? 0;
    const tier4Deleted = res4.rowCount ?? 0;
    const totalDeleted = tier2Deleted + tier3Deleted + tier4Deleted;

    if (totalDeleted > 0) {
      this.logger.log(
        `[Compaction] Pruned ${totalDeleted} redundant NAV observations (Tier 2: ${tier2Deleted}, Tier 3: ${tier3Deleted}, Tier 4: ${tier4Deleted})`,
      );
    }

    return { tier2Deleted, tier3Deleted, tier4Deleted, totalDeleted };
  }
}
