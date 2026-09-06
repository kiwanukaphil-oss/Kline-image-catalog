/** All new SQL is branch-scoped. Pricing, authentication and receipt writes stay in POS. */
function createWorkspaceRepository({ pool, publicationRepository }) {
  return {
    transaction: (work) => publicationRepository.withTransaction(work),
    async listBatches(branchId, options = {}) {
      /* Count each photographed lot and completed publication once within its delivery branch. */

      const { rows } = await pool.query(
        `SELECT b.id,b.title,b.created_at,count(*) OVER()::int AS total_count,
        count(bi.item_id)::int AS item_count,
        count(p.id)::int AS received_count
        FROM catalog_workspace.batches b
        LEFT JOIN catalog_workspace.batch_items bi ON bi.batch_id=b.id
        LEFT JOIN inventory.catalog_publications p ON p.item_id=bi.item_id AND p.branch_id=b.branch_id
        WHERE b.branch_id=$1 AND (strpos(lower(b.title),lower($2))>0 OR $2='')
        GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT $3 OFFSET $4`,
        [branchId, options.search || '', options.limit || null, options.offset || 0],
      );
      return rows;
    },
    async createBatch({ id, branchId, userId, title }) {
      /* Make delivery creation idempotent while refusing identifiers owned by another account or branch. */

      await pool.query(
        `INSERT INTO catalog_workspace.batches(id,branch_id,created_by,title)
        VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
        [id, branchId, userId, title],
      );
      const { rows } = await pool.query(
        `SELECT id,title,created_at FROM catalog_workspace.batches
        WHERE id=$1 AND branch_id=$2 AND created_by=$3`,
        [id, branchId, userId],
      );
      return rows[0];
    },
    async itemMemberships(branchId, itemIds) {
      const { rows } = await pool.query(
        `SELECT bi.item_id,b.id AS batch_id,b.title AS batch_title
        FROM catalog_workspace.batch_items bi JOIN catalog_workspace.batches b ON b.id=bi.batch_id
        WHERE b.branch_id=$1 AND bi.item_id=ANY($2::uuid[])`,
        [branchId, itemIds],
      );
      return rows;
    },
    async batchItemIds(branchId, batchId) {
      const { rows } = await pool.query(
        `SELECT bi.item_id FROM catalog_workspace.batch_items bi
        JOIN catalog_workspace.batches b ON b.id=bi.batch_id WHERE b.id=$1 AND b.branch_id=$2`,
        [batchId, branchId],
      );
      return rows.map((row) => row.item_id);
    },
    /** Lock both identities before linking so retry cannot move an item across deliveries. */
    async addBatchItem(client, { itemId, batchId, branchId, userId }) {
      const { rows } = await client.query(
        `SELECT id FROM catalog_workspace.batches WHERE id=$1 AND branch_id=$2 FOR UPDATE`,
        [batchId, branchId],
      );
      if (!rows.length) return null;
      await client.query(
        `INSERT INTO catalog_workspace.batch_items(item_id,batch_id,added_by)
        VALUES($1,$2,$3) ON CONFLICT(item_id) DO NOTHING`,
        [itemId, batchId, userId],
      );
      const existing = await client.query(
        'SELECT batch_id FROM catalog_workspace.batch_items WHERE item_id=$1',
        [itemId],
      );
      return existing.rows[0].batch_id;
    },
    async updateDetails(
      client,
      { itemId, branchId, userId, name, brand, categoryId, attributes, resolveFlag, clearConfidence = [] },
    ) {
      /* Update branch-owned draft identity and clear a problem flag only on explicit confirmation. */

      const { rows } = await client.query(
        `UPDATE inventory.items SET name=$1,brand=$2,category_id=$3,
        attributes=$4,updated_by=$5,status=CASE WHEN $8 THEN 'draft' ELSE status END,
        confidence=COALESCE(confidence,'{}'::jsonb)-$9::text[]
        WHERE id=$6 AND branch_id=$7 RETURNING id,updated_at`,
        [name, brand, categoryId, attributes, userId, itemId, branchId, resolveFlag, clearConfidence],
      );
      return rows[0];
    },
    async categoryFields(client, categoryId) {
      /* Resolve category fields from the nearest definition while respecting inheritance. */

      const { rows } = await client.query(
        `WITH RECURSIVE chain AS (
        SELECT id,parent_id,0 AS depth FROM inventory.categories WHERE id=$1 AND active=true
        UNION ALL SELECT c.id,c.parent_id,chain.depth+1 FROM inventory.categories c JOIN chain ON chain.parent_id=c.id WHERE chain.depth<20)
        SELECT DISTINCT ON (f.key) f.*,chain.depth FROM chain JOIN inventory.category_fields f ON f.category_id=chain.id
        WHERE chain.depth=0 OR f.inherit=true ORDER BY f.key,chain.depth`,
        [categoryId],
      );
      return rows;
    },
    async latestAiRun(client, itemId) {
      const { rows } = await client.query(
        "SELECT status,updated_at FROM inventory.item_jobs WHERE item_id=$1 AND job_type='ai_fill' ORDER BY created_at DESC,id DESC LIMIT 1",
        [itemId],
      );
      return rows[0] || null;
    },
    async activeCategory(client, categoryId) {
      return (
        (await client.query('SELECT id FROM inventory.categories WHERE id=$1 AND active=true', [categoryId]))
          .rowCount > 0
      );
    },
    async recordEdit(client, { itemId, userId, before, after }) {
      await client.query(
        `INSERT INTO inventory.item_events(item_id,event_type,source,field_path,before_value,after_value,summary,actor,created_at)
        VALUES($1,'manual_edit','manual','details',$2,$3,'Updated receiving details',$4,now())`,
        [itemId, before, after, userId],
      );
    },
    async saveCount(client, { itemId, branchId, userId, entries, totalQuantity }) {
      await client.query(
        `UPDATE inventory.items SET stock_distribution=$3::jsonb,stock_quantity=$4,
        stock_distribution_source='human_confirmed',stock_distribution_confidence=NULL,updated_by=$5
        WHERE id=$1 AND branch_id=$2`,
        [itemId, branchId, JSON.stringify(entries), totalQuantity, userId],
      );
    },
    /** Start at POS variants and join one image per product; repeated evidence never multiplies stock. */
    async readStock(
      branchId,
      { search = '', size = '', state = 'all', page = 1, categoryId = null, brandId = null },
    ) {
      const result = await pool.query(
        `WITH scoped AS (
        SELECT p.id AS product_id,p.name,p.master_sku,b.name AS brand,c.name AS category_name,
          pv.id,pv.sku,pv.variant_attributes,pv.price,
          COALESCE(bi.stock_quantity,0) AS quantity,COALESCE(bi.reorder_level,pv.reorder_level) AS reorder_level,
          CASE WHEN COALESCE(bi.stock_quantity,0)<0 THEN 'negative'
            WHEN COALESCE(bi.stock_quantity,0)=0 THEN 'out'
            WHEN COALESCE(bi.stock_quantity,0)<=COALESCE(bi.reorder_level,pv.reorder_level) THEN 'low'
            ELSE 'in' END AS stock_state
        FROM products p JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=true
        LEFT JOIN branch_inventory bi ON bi.variant_id=pv.id AND bi.branch_id=$1
        LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.is_active=true
          AND ($2='' OR concat_ws(' ',p.name,p.master_sku,b.name,pv.sku,pv.barcode,pv.variant_attributes::text) ILIKE '%'||$2||'%')
          AND ($3='' OR pv.variant_attributes->>'size'=$3)
          AND ($6::uuid IS NULL OR p.category_id=$6)
          AND ($7::uuid IS NULL OR p.brand_id=$7)
      ), grouped AS (
        SELECT product_id,name,master_sku,brand,category_name,sum(quantity)::int AS quantity,
          jsonb_agg(jsonb_build_object('id',id,'sku',sku,'variant_attributes',variant_attributes,'quantity',quantity,
            'effective_price',price,'reorder_level',reorder_level,'stock_state',stock_state) ORDER BY sku) AS variants
        FROM scoped GROUP BY product_id,name,master_sku,brand,category_name
        HAVING $4='all' OR bool_or(stock_state=$4)
      ) SELECT *,count(*) OVER()::int AS total FROM grouped ORDER BY name,product_id LIMIT 48 OFFSET $5`,
        [branchId, search, size, state, (page - 1) * 48, categoryId, brandId],
      );
      return result.rows;
    },
    async stockSizes() {
      return (
        await pool.query(`SELECT DISTINCT variant_attributes->>'size' AS size FROM product_variants pv
        JOIN products p ON p.id=pv.product_id WHERE p.is_active=true AND pv.is_active=true
        AND nullif(variant_attributes->>'size','') IS NOT NULL ORDER BY size`)
      ).rows.map((row) => row.size);
    },
    /** Keep exact POS identities and full category paths available even when the current filters match nothing. */
    async stockFilterChoices() {
      const [categories, brands] = await Promise.all([
        pool.query(`WITH RECURSIVE category_paths AS (
          SELECT id,name,name::text AS label,0 AS depth FROM categories WHERE parent_id IS NULL
          UNION ALL SELECT c.id,c.name,cp.label || ' / ' || c.name,cp.depth+1
          FROM categories c JOIN category_paths cp ON c.parent_id=cp.id WHERE cp.depth<20
        ) SELECT cp.id,cp.label FROM category_paths cp WHERE EXISTS (
          SELECT 1 FROM products p JOIN product_variants pv ON pv.product_id=p.id
          WHERE p.category_id=cp.id AND p.is_active=true AND pv.is_active=true
        ) ORDER BY cp.label,cp.id`),
        pool.query(`SELECT b.id,b.name AS label FROM brands b WHERE EXISTS (
          SELECT 1 FROM products p JOIN product_variants pv ON pv.product_id=p.id
          WHERE p.brand_id=b.id AND p.is_active=true AND pv.is_active=true
        ) ORDER BY b.name,b.id`),
      ]);
      return { categories: categories.rows, brands: brands.rows };
    },
    async stockImages(branchId, productIds) {
      /* Choose at most one authorized evidence photo per POS product so joins cannot multiply stock. */

      return (
        await pool.query(
          `SELECT p.id,p.image_path AS pos_image_path,photo.image_path AS catalog_image_path
        FROM products p LEFT JOIN LATERAL (SELECT i.image_path FROM inventory.items i
          WHERE i.branch_id=$1 AND i.image_path IS NOT NULL AND (i.pos_product_id=p.id OR EXISTS (
            SELECT 1 FROM inventory.item_variant_lines l JOIN product_variants pv ON pv.id=l.pos_variant_id
            WHERE l.item_id=i.id AND pv.product_id=p.id)) ORDER BY i.created_at DESC,i.id LIMIT 1) photo ON true
        WHERE p.id=ANY($2::uuid[])`,
          [branchId, productIds],
        )
      ).rows;
    },
    async stockMovements(branchId, productId) {
      return (
        await pool.query(
          `SELECT sm.id,sm.created_at,sm.movement_type,sm.quantity_change,sm.new_quantity,
        pv.sku,pv.variant_attributes FROM stock_movements sm JOIN product_variants pv ON pv.id=sm.variant_id
        WHERE sm.branch_id=$1 AND pv.product_id=$2 ORDER BY sm.created_at DESC,sm.id DESC LIMIT 50`,
          [branchId, productId],
        )
      ).rows;
    },
    /** Historical counts and catalog prices are read independently of changing POS balances. */
    async receipts(branchId, batchId, options = {}) {
      return (
        await pool.query(
          `SELECT p.id,p.item_id,p.product_id,p.published_at,p.total_quantity AS total_units,count(*) OVER()::int AS total_count,
        p.variant_count,i.name,b.title AS batch_title,
        (SELECT jsonb_agg(jsonb_build_object('variant_attributes',l.variant_attributes,'quantity',l.published_quantity,
          'price',COALESCE(l.price_override,i.price),'sku',l.sku) ORDER BY l.position)
          FROM inventory.item_variant_lines l WHERE l.item_id=i.id) AS variants
        FROM inventory.catalog_publications p JOIN inventory.items i ON i.id=p.item_id
        LEFT JOIN catalog_workspace.batch_items bi ON bi.item_id=i.id
        LEFT JOIN catalog_workspace.batches b ON b.id=bi.batch_id AND b.branch_id=p.branch_id
        WHERE p.branch_id=$1 AND ($2::uuid IS NULL OR b.id=$2)
          AND ($3='' OR strpos(lower(concat_ws(' ',i.name,b.title,p.id::text)),lower($3))>0)
        ORDER BY p.published_at DESC,p.id DESC LIMIT $4 OFFSET $5`,
          [branchId, batchId || null, options.search || '', options.limit || 200, options.offset || 0],
        )
      ).rows;
    },
  };
}
module.exports = { createWorkspaceRepository };
