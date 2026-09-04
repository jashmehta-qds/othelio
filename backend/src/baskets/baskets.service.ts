import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BasketsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  async getBaskets(chainIdInput: string, controllerInput?: string) {
    try {
      const chainId = chainIdSchema.parse(chainIdInput);
      const controller = controllerInput
        ? addressSchema.parse(controllerInput).toLowerCase()
        : null;

      let sql = 'SELECT * FROM baskets WHERE chain_id=$1';
      const params: any[] = [chainId];
      if (controller) {
        sql += ' AND controller=$2';
        params.push(controller);
      }
      sql += ' ORDER BY created_block DESC LIMIT 100';

      const result = await this.db.query(sql, params);

      return { data: result.rows };
    } catch (err) {
      console.error('ERROR IN GET_BASKETS:', err);
      throw err;
    }
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
