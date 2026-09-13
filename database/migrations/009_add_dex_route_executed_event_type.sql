BEGIN;

ALTER TABLE basket_events DROP CONSTRAINT IF EXISTS basket_events_event_type_check;

ALTER TABLE basket_events ADD CONSTRAINT basket_events_event_type_check
  CHECK (event_type IN ('CREATED', 'FUNDED', 'WITHDRAWN', 'WEIGHTS_UPDATED', 'CONTROLLER_TRANSFERRED', 'DEX_ROUTE_EXECUTED'));

COMMIT;
