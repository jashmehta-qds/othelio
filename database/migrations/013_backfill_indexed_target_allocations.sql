BEGIN;

-- Reconstruct historical targets from the event-block balance and oracle facts.
-- An unfunded creation has no measurable target. The first funded event and
-- each rebalance establish the allocation shown in history and on the left.
CREATE TEMP TABLE indexed_target_backfill ON COMMIT DROP AS
WITH target_events AS (
  SELECT e.chain_id, e.basket_address, e.tx_hash, e.log_index, e.block_number
  FROM basket_events e
  JOIN basket_nav_observations nav
    ON nav.chain_id = e.chain_id
   AND nav.basket_address = e.basket_address
   AND nav.block_number = e.block_number
   AND nav.kind = 'EVENT'
   AND nav.valuation_status = 'COMPLETE'
  WHERE e.event_type = 'WEIGHTS_UPDATED'
     OR (e.event_type = 'FUNDED' AND NOT EXISTS (
       SELECT 1 FROM basket_events earlier
       WHERE earlier.chain_id = e.chain_id
         AND earlier.basket_address = e.basket_address
         AND earlier.event_type = 'FUNDED'
         AND (earlier.block_number, earlier.log_index) < (e.block_number, e.log_index)
     ))
), valued AS (
  SELECT e.*, p.asset_address,
         p.quantity_base_units * price.price_usd_e8 / power(10::numeric, p.decimals) AS value_usd_e8
  FROM target_events e
  JOIN basket_positions p
    ON p.chain_id = e.chain_id
   AND p.basket_address = e.basket_address
   AND p.block_number = e.block_number
   AND p.source = 'EVENT'
  JOIN asset_price_observations price
    ON price.chain_id = p.chain_id
   AND price.asset_address = p.asset_address
   AND price.block_number = p.block_number
  WHERE p.quantity_base_units > 0
), shares AS (
  SELECT valued.*,
         SUM(value_usd_e8) OVER (PARTITION BY chain_id, tx_hash, log_index) AS total_usd_e8,
         ROW_NUMBER() OVER (PARTITION BY chain_id, tx_hash, log_index ORDER BY value_usd_e8 DESC, asset_address) AS value_rank
  FROM valued
  WHERE value_usd_e8 > 0
), rounded AS (
  SELECT shares.*,
         FLOOR(value_usd_e8 * 10000 / total_usd_e8)::integer AS base_bps
  FROM shares
), final_weights AS (
  SELECT rounded.*,
         base_bps + CASE WHEN value_rank = 1 THEN
           10000 - SUM(base_bps) OVER (PARTITION BY chain_id, tx_hash, log_index)
         ELSE 0 END AS weight_bps
  FROM rounded
)
SELECT chain_id, basket_address, tx_hash, log_index, block_number,
       asset_address, weight_bps
FROM final_weights;

UPDATE basket_events e
SET payload = jsonb_set(e.payload, '{targetWeights}', grouped.weights, true)
FROM (
  SELECT chain_id, tx_hash, log_index,
         jsonb_agg(jsonb_build_object(
           'assetAddress', trim(asset_address), 'weightBps', weight_bps
         ) ORDER BY asset_address) AS weights
  FROM indexed_target_backfill
  GROUP BY chain_id, tx_hash, log_index
) grouped
WHERE e.chain_id = grouped.chain_id
  AND e.tx_hash = grouped.tx_hash
  AND e.log_index = grouped.log_index;

CREATE TEMP TABLE latest_indexed_target ON COMMIT DROP AS
SELECT DISTINCT ON (chain_id, basket_address)
       chain_id, basket_address, tx_hash, log_index, block_number
FROM indexed_target_backfill
ORDER BY chain_id, basket_address, block_number DESC, log_index DESC;

-- Remove weights previously supplied by create/rebalance UI or equal-split
-- fallback, including unfunded baskets with no measured target.
DELETE FROM basket_assets;

INSERT INTO basket_assets (
  chain_id, basket_address, asset_address, target_weight_bps, updated_block
)
SELECT weights.chain_id, weights.basket_address, weights.asset_address,
       weights.weight_bps, weights.block_number
FROM indexed_target_backfill weights
JOIN latest_indexed_target latest
  ON latest.chain_id = weights.chain_id
 AND latest.basket_address = weights.basket_address
 AND latest.tx_hash = weights.tx_hash
 AND latest.log_index = weights.log_index;

INSERT INTO schema_migrations (name)
VALUES ('013_backfill_indexed_target_allocations.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
