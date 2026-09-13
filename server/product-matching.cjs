const { randomUUID } = require("node:crypto");
const { identityOf, fingerprint } = require("./match-candidates.cjs");
const { canonicalCatalogSize } = require("./host-integration/catalogExtractionPolicy.cjs");
const MATCH_BLOCKER = "Receive this lot through its matched product group.";
const normalized = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Canonicalize size aliases and key casing without guessing different colours or styles are equivalent. */
function variantIdentity(attributes) {
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(attributes || {})) {
    const key = normalized(rawKey) === "colour" ? "color" : normalized(rawKey);
    let value = normalized(rawValue);
    if (!value) continue;
    if (key === "size") value = canonicalCatalogSize(value).toLowerCase();
    if (key === "sleeve") {
      value = value.replace(/[- ]sleeves?d?$/, "");
      value =
        {
          full: "long",
          "3/4": "three-quarter",
          "three quarter": "three-quarter",
          no: "sleeveless",
          "sleeve-less": "sleeveless",
        }[value] || value;
    }
    result[key] = value;
  }
  return JSON.stringify(
    Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))),
  );
}

/** Saved, branch-scoped plans retain original lots and receive one product atomically through POS stock services. */
function createProductMatchingService({ source }) {
  const { pool } = source("config/database");
  const repository = source("repositories/CatalogPublicationRepository");
  const stock = source("repositories/StockRepository");
  const DomainError = source("errors/DomainError");
  const {
    catalogPublicationBlockers,
    createPublicationRevision,
    buildMasterSku,
    buildPosVariantAttributes,
  } = source("services/catalogPublicationService");
  const { mintUniqueEan13 } = source("utils/barcode");
  const { roundMoney } = source("utils/moneyUtils");
  const { transferCatalogPhoto } = source("services/catalogPhotoHandoffService");
  let validateSuggestedTarget;
  const revision = (plan, branchId, userId) =>
    createPublicationRevision(plan, { branchId, userId });

  /** Lock members deterministically and reject cross-branch, cancelled, unready or already-received evidence. */
  async function readContexts(client, plan, requireReady = true, allowProposedCounts = false) {
    const contexts = [];
    for (const itemId of [...plan.item_ids].sort()) {
      const context = await repository.loadLockedContext(client, {
        itemId,
        branchId: plan.branch_id,
      });
      if (!context) throw DomainError.notFound("A matching lot is unavailable in this branch.");
      if (context.item.publication_id || context.item.pos_product_id)
        throw DomainError.conflict("A lot has already been received. Rebuild this product match.");
      if (context.item.intake_cancelled_at)
        throw DomainError.conflict("A matching lot was cancelled. Rebuild this product match.");
      if (
        !(
          await client.query("SELECT id FROM inventory.categories WHERE id=$1 AND active=true", [
            context.item.category_id,
          ])
        ).rowCount
      )
        throw DomainError.conflict("A matching category is inactive. Review the lot category.");
      const blockers = catalogPublicationBlockers(context).filter(
        (message) => message !== MATCH_BLOCKER && !(allowProposedCounts && message === 'Confirm the photographed stock breakdown before import.'),
      );
      if (requireReady && blockers.length)
        throw DomainError.validationFailed(`${context.item.name}: ${blockers.join(" ")}`);
      contexts.push(context);
    }
    if (new Set(contexts.map((context) => context.item.category_id)).size !== 1)
      throw DomainError.validationFailed("Match lots within the same catalog category.");
    return contexts.sort(
      (a, b) => plan.item_ids.indexOf(a.item.id) - plan.item_ids.indexOf(b.item.id),
    );
  }

  /** Group identical sellable attributes; existing variants retain their prices while new ones require consistent prices/costs. */
  async function prepareProduct(client, plan, allowProposedCounts = false) {
    const contexts = await readContexts(client, plan, true, allowProposedCounts);
    if (plan.identity_review) {
      const identities = [...contexts]
        .sort((a, b) => a.item.id.localeCompare(b.item.id))
        .map((context) =>
          identityOf({
            ...context.item,
            staff_model_confirmed:
              plan.identity_review.member_identity.find((row) => row.id === context.item.id)
                ?.evidence?.source === "Staff-confirmed code",
          }),
        );
      if (fingerprint(identities) !== plan.identity_review.fingerprint)
        throw DomainError.conflict(
          "Confirmed model evidence changed. Unmatch and review these lots again.",
        );
    }
    let target = null;
    if (plan.target_product_id) {
      target = await repository.loadRestockTarget(client, plan.target_product_id);
      if (
        !target ||
        !target.product.is_active ||
        target.product.status !== "published" ||
        target.product.category_id !== contexts[0].item.pos_category_id
      )
        throw DomainError.validationFailed("Choose an active POS product in the mapped category.");
      if (plan.identity_review?.target_identity) {
        if (!validateSuggestedTarget)
          throw DomainError.conflict(
            "Suggested target validation is unavailable. Reopen Receiving.",
          );
        await validateSuggestedTarget(client, plan);
      }
    }
    const variants = new Map();
    for (const variant of target?.variants || []) {
      const key = variantIdentity(variant.variant_attributes);
      if (variants.has(key))
        throw DomainError.conflict(
          "The POS product has duplicate variant attributes. Resolve these before matching.",
        );
      variants.set(key, variant);
    }
    const grouped = new Map();
    for (const context of contexts)
      for (const line of context.lines) {
        const attributes = {
          ...buildPosVariantAttributes(context.item, line),
          ...plan.variant_defaults,
        };
        const key = variantIdentity(attributes);
        const incoming = JSON.parse(key);
        const missingDimensions = [
          ...new Set([...variants.keys()].flatMap((identity) => Object.keys(JSON.parse(identity)))),
        ].filter((dimension) => !incoming[dimension]);
        if (missingDimensions.length)
          throw DomainError.validationFailed(
            `The POS product also uses ${missingDimensions.join(", ")}. Complete these lot variant attributes before matching to avoid duplicate variants.`,
          );
        const existing = variants.get(key);
        if (
          existing &&
          (!existing.is_active || !(Number(existing.price) > 0) || existing.cost_price === null)
        )
          throw DomainError.validationFailed(
            "Activate and price the matching POS variant before receiving.",
          );
        const price = roundMoney(line.price_override ?? context.item.price);
        const cost = roundMoney(line.cost_override ?? context.item.base_cost_price);
        if (!grouped.has(key))
          grouped.set(key, {
            key,
            attributes: {
              ...incoming,
              ...(incoming.size ? { size: incoming.size.toUpperCase() } : {}),
            },
            existing,
            price,
            cost,
            quantity: 0,
            sources: [],
          });
        const row = grouped.get(key);
        if (!existing && (row.price !== price || row.cost !== cost))
          throw DomainError.conflict(
            "The same new size/colour has different prices or costs. Resolve pricing before combining it.",
          );
        row.quantity += Number(line.quantity);
        row.sources.push({ context, line });
      }
    const rows = [...grouped.values()];
    const warnings = [];
    if (new Set(contexts.map((context) => normalized(context.item.brand))).size > 1)
      warnings.push("Source brand names differ. Confirm these labels identify the same brand.");
    if (
      !plan.identity_review &&
      new Set(contexts.map((context) => normalized(context.item.attributes?.material))).size > 1
    )
      warnings.push(
        "Material descriptions differ. The first source supplies material for a new product.",
      );
    if (rows.some((row) => row.existing && row.price !== Number(row.existing.price)))
      warnings.push(
        "Existing POS variant selling prices are retained; some incoming prices differ.",
      );
    return { contexts, target, rows, warnings };
  }

  /** Return complete member evidence and commercial effects without exposing protected costs. */
  function presentReview(plan, prepared, branchId, userId) {
    return {
      id: plan.id,
      product_name: prepared.target?.product.name || plan.product_name,
      target_product_id: plan.target_product_id,
      total_units: prepared.rows.reduce((sum, row) => sum + row.quantity, 0),
      lot_count: prepared.contexts.length,
      variant_count: prepared.rows.length,
      new_variants: prepared.rows.filter((row) => !row.existing).length,
      existing_variants: prepared.rows.filter((row) => row.existing).length,
      warnings: prepared.warnings,
      revision: revision(
        { plan, contexts: prepared.contexts, target: prepared.target },
        branchId,
        userId,
      ),
      rows: prepared.rows.map((row) => ({
        attributes: row.attributes,
        quantity: row.quantity,
        price: Number(row.existing?.price ?? row.price),
        action: row.existing ? "Add stock" : "New variant",
      })),
    };
  }

  return {
    setSuggestionTargetValidator(validator) {
      validateSuggestedTarget = validator;
    },
    async list(branchId, userId) {
      const rows = (
        await pool.query(
          "SELECT * FROM catalog_workspace.product_matches WHERE branch_id=$1 AND retired_at IS NULL AND result_product_id IS NULL ORDER BY updated_at,id",
          [branchId],
        )
      ).rows;
      return rows.map((plan) => ({ ...plan, revision: revision(plan, branchId, userId) }));
    },
    async save({ branchId, userId, plan, expectedRevision, validateIdentity, allowSingleNew = false }) {
      // Serialize plan membership changes so two staff members cannot assign a lot twice.
      return repository.withTransaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('catalog-matching:' || $1,0))",
          [branchId],
        );
        const existing = plan.id
          ? (
              await client.query(
                "SELECT * FROM catalog_workspace.product_matches WHERE id=$1 AND branch_id=$2 FOR UPDATE",
                [plan.id, branchId],
              )
            ).rows[0]
          : null;
        if (
          plan.id &&
          (!existing ||
            existing.result_product_id ||
            existing.retired_at ||
            revision(existing, branchId, userId) !== expectedRevision)
        )
          throw DomainError.conflict("This product match changed. Reload it.");
        const next = {
          ...plan,
          identity_review: existing?.identity_review || null,
          id: existing?.id || randomUUID(),
          branch_id: branchId,
        };
        const overlap = await client.query(
          "SELECT id FROM catalog_workspace.product_matches WHERE branch_id=$1 AND retired_at IS NULL AND result_product_id IS NULL AND item_ids && $2::uuid[] AND id<>$3",
          [branchId, next.item_ids, next.id],
        );
        if (overlap.rowCount)
          throw DomainError.conflict(
            "Some lots already belong to a product match. Unmatch them first.",
          );
        const contexts = await readContexts(client, next, false);
        if (!next.target_product_id && next.item_ids.length < 2 && !allowSingleNew)
          throw DomainError.validationFailed("A new product group needs at least two lots.");
        if (next.target_product_id) {
          const target = await repository.loadRestockTarget(client, next.target_product_id);
          if (
            !target?.product.is_active ||
            target.product.status !== "published" ||
            target.product.category_id !== contexts[0].item.pos_category_id
          )
            throw DomainError.validationFailed(
              "Choose an active POS product in the mapped category.",
            );
        }
        if (validateIdentity) await validateIdentity(client, next, contexts);
        if (
          existing?.identity_review &&
          (JSON.stringify(existing.item_ids) !== JSON.stringify(next.item_ids) ||
            existing.target_product_id !== next.target_product_id ||
            Object.keys(next.variant_defaults).length)
        )
          throw DomainError.validationFailed(
            "Unmatch and review suggestions again to change confirmed membership or shared attributes.",
          );
        const saved = (
          await client.query(
            `INSERT INTO catalog_workspace.product_matches(id,branch_id,item_ids,target_product_id,product_name,brand_name,variant_defaults,review_note,created_by,identity_review)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET item_ids=$3,target_product_id=$4,product_name=$5,brand_name=$6,variant_defaults=$7,review_note=$8,identity_review=$10,updated_at=now() RETURNING *`,
            [
              next.id,
              branchId,
              next.item_ids,
              next.target_product_id,
              next.product_name,
              next.brand_name,
              next.variant_defaults,
              next.review_note,
              userId,
              next.identity_review,
            ],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.match.save','catalog',$2)",
          [userId, JSON.stringify({ before: existing, after: saved })],
        );
        return { ...saved, revision: revision(saved, branchId, userId) };
      });
    },
    async retire({ branchId, userId, id, expectedRevision }) {
      // Retain matching history when staff deliberately return unreceived lots to separate products.
      return repository.withTransaction(async (client) => {
        const plan = (
          await client.query(
            "SELECT * FROM catalog_workspace.product_matches WHERE id=$1 AND branch_id=$2 FOR UPDATE",
            [id, branchId],
          )
        ).rows[0];
        if (
          !plan ||
          plan.result_product_id ||
          revision(plan, branchId, userId) !== expectedRevision
        )
          throw DomainError.conflict("This product match changed. Reload it.");
        await client.query(
          "UPDATE catalog_workspace.product_matches SET retired_at=now(),updated_at=now() WHERE id=$1",
          [id],
        );
        await client.query(
          "INSERT INTO user_audit_logs(user_id,action,module,description) VALUES($1,'catalog.match.retire','catalog',$2)",
          [userId, JSON.stringify({ id, branch_id: branchId })],
        );
        return { retired: true };
      });
    },
    async receive({ branchId, userId, id, expectedRevision, apply = false, transactionClient, allowProposedCounts = false }) {
      // All source receipts and stock movements commit together, with the plan ID making retry idempotent.
      const result = await (transactionClient ? work => work(transactionClient) : work => repository.withTransaction(work))(async (client) => {
        const plan = (
          await client.query(
            "SELECT * FROM catalog_workspace.product_matches WHERE id=$1 AND branch_id=$2 FOR UPDATE",
            [id, branchId],
          )
        ).rows[0];
        if (!plan || plan.retired_at) throw DomainError.notFound("Product match unavailable.");
        if (plan.result_product_id)
          return {
            already_received: true,
            product_id: plan.result_product_id,
            item_ids: plan.item_ids,
          };
        const prepared = await prepareProduct(client, plan, !apply && allowProposedCounts);
        const review = presentReview(plan, prepared, branchId, userId);
        if (!apply) return review;
        if (review.revision !== expectedRevision)
          throw DomainError.conflict(
            "The product match, lots or POS variants changed. Review again.",
          );
        let product = prepared.target?.product;
        const first = prepared.contexts[0].item;
        if (!product) {
          const brand = await repository.findOrCreateBrand(client, plan.brand_name);
          if (brand && !brand.is_active)
            throw DomainError.conflict("Reactivate the matching POS brand first.");
          const masterSku = buildMasterSku(first);
          if (await repository.findProductByMasterSku(client, masterSku))
            throw DomainError.conflict(
              "The product SKU already exists. Match the existing product.",
            );
          product = await repository.createProduct(client, {
            name: plan.product_name,
            brandId: brand?.id || null,
            categoryId: first.pos_category_id,
            description: Object.entries(first.attributes || {})
              .filter(
                ([key]) =>
                  ![
                    "size",
                    "color",
                    "colour",
                    "fit",
                    ...(plan.identity_review ? ["material"] : []),
                  ].includes(key),
              )
              .map(([key, value]) => `${key}: ${value}`)
              .join("; "),
            basePrice: Math.min(...prepared.rows.map((row) => row.price)),
            material: plan.identity_review
              ? plan.identity_review.material
              : first.attributes?.material || null,
            gender: ["men", "women", "unisex", "kids"].includes(first.attributes?.gender)
              ? first.attributes.gender
              : null,
            masterSku,
            userId,
          });
        }
        const published = new Map();
        for (const row of prepared.rows) {
          const variant =
            row.existing ||
            (await repository.createVariant(client, {
              productId: product.id,
              sku: `CAT-${randomUUID().replace(/-/g, "").toUpperCase()}`,
              attributes: row.attributes,
              price: row.price,
              costPrice: row.cost,
              reorderLevel: Number(first.reorder_level ?? 5),
              barcode: await mintUniqueEan13(client),
            }));
          for (const { context, line } of row.sources) {
            await stock.updateStock(
              variant.id,
              Number(line.quantity),
              "purchase",
              line.id,
              userId,
              client,
              `Catalog matched receipt ${context.item.id}`,
              { branchId },
            );
            await repository.markLinePublished(client, {
              lineId: line.id,
              sku: variant.sku,
              variantId: variant.id,
              quantity: Number(line.quantity),
              userId,
            });
            published.set(line.id, variant);
          }
        }
        for (const context of prepared.contexts)
          await repository.completePublication(client, {
            itemId: context.item.id,
            branchId,
            productId: product.id,
            variantCount: context.lines.length,
            totalQuantity: context.lines.reduce((sum, line) => sum + Number(line.quantity), 0),
            userId,
            singleVariantId:
              context.lines.length === 1 ? published.get(context.lines[0].id).id : null,
            masterSku: product.master_sku,
            previousStatus: context.item.status,
          });
        await client.query(
          "UPDATE catalog_workspace.product_matches SET result_product_id=$2,updated_at=now() WHERE id=$1",
          [id, product.id],
        );
        return {
          ...review,
          product_id: product.id,
          item_ids: plan.item_ids,
          already_received: false,
        };
      });
      if (apply && !transactionClient)
        for (const itemId of result.item_ids) {
          try {
            await transferCatalogPhoto({ branchId, itemId, userId, appendGallery: true });
          } catch (error) {
            console.error("Matched receipt saved; photo retry needed:", error.message);
          }
        }
      return result;
    },
  };
}
module.exports = { createProductMatchingService, variantIdentity, MATCH_BLOCKER };
