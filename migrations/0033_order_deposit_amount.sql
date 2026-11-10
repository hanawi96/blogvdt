ALTER TABLE orders ADD COLUMN deposit_amount integer NOT NULL DEFAULT 0
  CHECK (deposit_amount >= 0);
