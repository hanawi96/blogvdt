ALTER TABLE orders ADD COLUMN fulfill_status text CHECK (fulfill_status IS NULL OR fulfill_status IN ('unshipped', 'shipped', 'reship'));
