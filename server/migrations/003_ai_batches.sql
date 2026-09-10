BEGIN;
CREATE TABLE IF NOT EXISTS catalog_workspace.ai_batches (
  id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  submission_key uuid NOT NULL,
  item_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','stopped','done')),
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,branch_id,submission_key)
);
CREATE TABLE IF NOT EXISTS catalog_workspace.ai_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES catalog_workspace.ai_batches(id),
  item_id uuid NOT NULL REFERENCES inventory.items(id),
  ordinal integer NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','attention','skipped')),
  message text NOT NULL DEFAULT 'Queued',
  claim_token uuid,
  lease_until timestamptz,
  job_id bigint REFERENCES inventory.item_jobs(id),
  usage_id bigint REFERENCES inventory.ai_usage(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_batch_active_item ON catalog_workspace.ai_batch_items(item_id)
  WHERE state IN ('queued','running','attention');
CREATE INDEX IF NOT EXISTS ai_batch_work ON catalog_workspace.ai_batch_items(state,lease_until);
CREATE INDEX IF NOT EXISTS ai_batch_branch ON catalog_workspace.ai_batches(branch_id,created_at DESC);
COMMIT;
