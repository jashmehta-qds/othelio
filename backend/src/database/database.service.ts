import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: pg.Pool;

  constructor() {
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://othelio:othelio@localhost:5433/othelio';
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
