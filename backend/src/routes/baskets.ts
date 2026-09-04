import type { FastifyInstance } from "fastify";
import { addressSchema, chainIdSchema } from "@othelio/shared";
import type { Database } from "../db.js";

export async function basketRoutes(app: FastifyInstance, db: Database) {
  app.get("/v1/baskets", async (request) => {
    const query = request.query as Record<string,string|undefined>; const chainId = chainIdSchema.parse(query.chainId); const controller = query.controller ? addressSchema.parse(query.controller).toLowerCase() : null;
    const result = await db.query("SELECT * FROM baskets WHERE chain_id=$1 AND ($2::text IS NULL OR controller=$2) ORDER BY created_block DESC LIMIT 100", [chainId, controller]); return { data: result.rows };
  });
  app.get("/v1/baskets/:address", async (request, reply) => {
    const params=request.params as {address:string}; const query=request.query as {chainId?:string}; const address=addressSchema.parse(params.address).toLowerCase(); const chainId=chainIdSchema.parse(query.chainId);
    const [basket,assets,snapshot]=await Promise.all([db.query("SELECT * FROM baskets WHERE chain_id=$1 AND address=$2",[chainId,address]),db.query("SELECT * FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address",[chainId,address]),db.query("SELECT * FROM basket_snapshots WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC LIMIT 1",[chainId,address])]);
    if(!basket.rowCount) return reply.code(404).send({error:"BASKET_NOT_FOUND"}); return {data:{...basket.rows[0],assets:assets.rows,snapshot:snapshot.rows[0]??null}};
  });
  app.get("/v1/baskets/:address/activity", async (request) => {
    const params=request.params as {address:string}; const query=request.query as {chainId?:string}; const address=addressSchema.parse(params.address).toLowerCase(); const chainId=chainIdSchema.parse(query.chainId);
    const result=await db.query("SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC,log_index DESC LIMIT 100",[chainId,address]); return {data:result.rows};
  });
}
