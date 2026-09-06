BEGIN;
CREATE SCHEMA IF NOT EXISTS catalog_workspace;
CREATE TABLE IF NOT EXISTS catalog_workspace.batches (
  id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receiving_batches_branch ON catalog_workspace.batches(branch_id, created_at DESC);
CREATE TABLE IF NOT EXISTS catalog_workspace.batch_items (
  item_id uuid PRIMARY KEY REFERENCES inventory.items(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES catalog_workspace.batches(id) ON DELETE RESTRICT,
  added_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receiving_batch_items ON catalog_workspace.batch_items(batch_id);
COMMENT ON SCHEMA catalog_workspace IS 'Receiving organization only. POS remains authoritative for stock and commercial transactions.';
COMMIT;
