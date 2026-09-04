import { Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class BasketsService {
  constructor(private readonly db: DatabaseService) {}

  async getBaskets(chainIdInput: string, controllerInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput);
    const controller = controllerInput
      ? addressSchema.parse(controllerInput).toLowerCase()
      : null;

    const result = await this.db.query(
      'SELECT * FROM baskets WHERE chain_id=$1 AND ($2::text IS NULL OR controller=$2) ORDER BY created_block DESC LIMIT 100',
      [chainId, controller],
    );

    return { data: result.rows };
  }

  async getBasketByAddress(addressInput: string, chainIdInput?: string) {
    const address = addressSchema.parse(addressInput).toLowerCase();
    const chainId = chainIdSchema.parse(chainIdInput);

    const [basket, assets, snapshot] = await Promise.all([
      this.db.query('SELECT * FROM baskets WHERE chain_id=$1 AND address=$2', [
        chainId,
        address,
      ]),
      this.db.query(
        'SELECT * FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address',
        [chainId, address],
      ),
      this.db.query(
        'SELECT * FROM basket_snapshots WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC LIMIT 1',
        [chainId, address],
      ),
    ]);

    if (!basket.rowCount) {
      throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
    }

    return {
      data: {
        ...basket.rows[0],
        assets: assets.rows,
        snapshot: snapshot.rows[0] ?? null,
      },
    };
  }

  async getBasketActivity(addressInput: string, chainIdInput?: string) {
    const address = addressSchema.parse(addressInput).toLowerCase();
    const chainId = chainIdSchema.parse(chainIdInput);

    const result = await this.db.query(
      'SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC, log_index DESC LIMIT 100',
      [chainId, address],
    );

    return { data: result.rows };
  }
}
