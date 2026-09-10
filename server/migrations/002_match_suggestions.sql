BEGIN;
CREATE TABLE IF NOT EXISTS catalog_workspace.match_dismissals (
  branch_id uuid NOT NULL REFERENCES branches(id),
  fingerprint text NOT NULL,
  member_ids uuid[] NOT NULL,
  dismissed_by uuid NOT NULL REFERENCES users(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  PRIMARY KEY(branch_id, fingerprint)
);
ALTER TABLE catalog_workspace.match_dismissals ADD COLUMN IF NOT EXISTS restored_by uuid REFERENCES users(id);
ALTER TABLE catalog_workspace.product_matches ADD COLUMN IF NOT EXISTS identity_review jsonb;

-- Expose optional evidence to extraction only within apparel/footwear trees. Existing definitions stay intact.
WITH RECURSIVE apparel AS (
  SELECT id FROM inventory.categories WHERE lower(trim(name)) IN ('clothing','footware','footwear','shirts','trousers')
  UNION
  SELECT c.id FROM inventory.categories c JOIN apparel p ON p.id=c.parent_id
)
INSERT INTO inventory.category_fields(category_id,key,label,type,required,inherit,sort)
SELECT id,'style','Model code (as captioned)','text',false,true,90 FROM apparel
ON CONFLICT(category_id,key) DO NOTHING;
COMMIT;
