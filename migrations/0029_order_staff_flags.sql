ALTER TABLE orders ADD COLUMN source text CHECK (source IS NULL OR source IN ('zalo', 'facebook', 'tiktok', 'web'));
ALTER TABLE orders ADD COLUMN pay_state text CHECK (pay_state IS NULL OR pay_state IN ('cod', 'paid', 'deposit'));
ALTER TABLE orders ADD COLUMN priority integer NOT NULL DEFAULT 0 CHECK (priority IN (0, 1));
ALTER TABLE orders ADD COLUMN compensation integer NOT NULL DEFAULT 0 CHECK (compensation IN (0, 1));
ALTER TABLE orders ADD COLUMN ship_on integer;
ALTER TABLE orders ADD COLUMN shipping_fee integer NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0);
ALTER TABLE orders ADD COLUMN shipping_cost integer NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0);
CREATE INDEX orders_priority_idx ON orders (priority, created_at);
