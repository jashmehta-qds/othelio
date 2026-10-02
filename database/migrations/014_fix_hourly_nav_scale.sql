-- Hourly NAV aggregation previously persisted micro-USD values directly in
-- nav_usdc. Event checkpoints already store normal USD values. Correct the
-- existing hourly rows so history and last-known snapshots use one scale.
UPDATE basket_nav_observations
SET nav_usdc = nav_usdc / 1000000.0
WHERE kind = 'HOURLY'
  AND nav_usdc IS NOT NULL;
