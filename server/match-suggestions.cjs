const {
  discoverCandidates,
  identityOf,
  fingerprint,
  modelEvidence,
  compareMembers,
} = require("./match-candidates.cjs");

/** Keep discovery independent of extraction and receipt, while confirming against locked source records. */
function createMatchSuggestionService({ source }, matching) {
  const { pool } = source("config/database");
  const repository = source("repositories/CatalogPublicationRepository");
  const DomainError = source("errors/DomainError");
  const { createCatalogImageUrl } = source("services/catalogImageStorageService");
  const { createPublicationRevision } = source("services/catalogPublicationService");

  /** Load safe evidence with private revision inputs; received evidence may establish a POS target only in this branch. */
  async function loadEvidence(client, branchId, batchId = null) {
    const categories = (
      await client.query("SELECT id,name,parent_id FROM inventory.categories WHERE active=true")
    ).rows;
    const categoryMap = new Map(categories.map((row) => [row.id, row]));
    const categoryFields = (
      await client.query(
        "SELECT category_id,key,inherit FROM inventory.category_fields WHERE key IN ('color','pattern','fit','sleeve','material')",
      )
    ).rows;
    const applicableFields = (categoryId) => {
      const keys = new Set(["color", "material"]),
        seen = new Set();
      let id = categoryId;
      while (categoryMap.has(id) && !seen.has(id)) {
        seen.add(id);
        for (const field of categoryFields.filter(
          (row) => row.category_id === id && (id === categoryId || row.inherit),
        ))
          keys.add(field.key);
        id = categoryMap.get(id).parent_id;
      }
      return [...keys].sort();
    };
    const categoryPath = (id) => {
      const names = [],
        seen = new Set();
      while (categoryMap.has(id) && !seen.has(id)) {
        seen.add(id);
        const row = categoryMap.get(id);
        names.unshift(row.name);
        id = row.parent_id;
      }
      return names.join(" → ");
    };
    const rows = (
      await client.query(
        `SELECT i.id,i.name,i.brand,i.category_id,i.attributes,i.ai_visible_text,i.ai_field_evidence,
      i.image_path,i.stock_quantity,i.stock_distribution_source,i.updated_at,i.xmin::text AS item_version,
      co.xmin::text AS cost_version,m.pos_category_id,p.product_id AS received_product_id,
      (SELECT jsonb_agg(jsonb_build_object('id',l.id,'variant_attributes',l.variant_attributes,'quantity',l.quantity,'version',l.xmin::text) ORDER BY l.position,l.id)
       FROM inventory.item_variant_lines l WHERE l.item_id=i.id) AS variant_lines,
      EXISTS(SELECT 1 FROM inventory.item_events e WHERE e.item_id=i.id AND e.source='manual' AND e.actor IS NOT NULL
        AND ((e.field_path='attributes.style' AND e.after_value=to_jsonb(i.attributes->>'style'))
          OR (e.field_path='details' AND e.after_value->'attributes'->>'style'=i.attributes->>'style'
              AND e.before_value->'attributes'->>'style' IS DISTINCT FROM e.after_value->'attributes'->>'style'))) AS staff_model_confirmed,
      EXISTS(SELECT 1 FROM catalog_workspace.product_matches g WHERE g.branch_id=$1 AND g.retired_at IS NULL
        AND g.result_product_id IS NULL AND i.id=ANY(g.item_ids)) AS grouped
      FROM inventory.items i JOIN inventory.categories c ON c.id=i.category_id AND c.active=true
      LEFT JOIN inventory.item_costs co ON co.item_id=i.id
      LEFT JOIN inventory.pos_category_map m ON m.image_category_id=i.category_id
      LEFT JOIN inventory.catalog_publications p ON p.item_id=i.id
      WHERE i.branch_id=$1 AND NOT EXISTS(SELECT 1 FROM inventory.intake_cancellations x WHERE x.item_id=i.id AND x.restored_at IS NULL)
        AND (i.pos_product_id IS NULL OR p.product_id IS NOT NULL)
        AND ($2::uuid IS NULL OR p.product_id IS NOT NULL OR EXISTS(SELECT 1 FROM catalog_workspace.batch_items bi
          JOIN catalog_workspace.batches b ON b.id=bi.batch_id WHERE bi.item_id=i.id AND b.id=$2 AND b.branch_id=$1))
      ORDER BY i.id`,
        [branchId, batchId],
      )
    ).rows;
    for (const row of rows) {
      row.category_path = categoryPath(row.category_id);
      row.comparison_fields = applicableFields(row.category_id);
      row.variant_lines ||= [];
    }
    const products = (
      await client.query(
        `SELECT p.id,p.name,p.category_id,p.xmin::text AS version,b.name AS brand
      FROM products p JOIN brands b ON b.id=p.brand_id AND b.is_active=true
      WHERE p.is_active=true AND p.status='published' AND p.id=ANY($1::uuid[])`,
        [[...new Set(rows.map((row) => row.received_product_id).filter(Boolean))]],
      )
    ).rows;
    const targets = [];
    for (const product of products) {
      const evidence = rows.filter(
        (row) => row.received_product_id === product.id && modelEvidence(row),
      );
      // Contradictory linked identities cannot establish a trustworthy automatic target.
      if (
        !evidence.length ||
        new Set(
          evidence.map((row) => JSON.stringify([identityOf(row).model, identityOf(row).brand])),
        ).size !== 1
      )
        continue;
      const representative = evidence[0];
      targets.push({
        ...representative,
        id: product.id,
        name: product.name,
        brand: product.brand,
        pos_category_id: product.category_id,
        target_version: product.version,
        evidence_versions: evidence.map((row) => [row.id, row.item_version]),
        linked_issues: compareMembers(evidence),
        source_item_id: representative.id,
      });
    }
    return { items: rows.filter((row) => !row.received_product_id && !row.grouped), targets };
  }

  /** Attach a signed source snapshot; public output deliberately omits revision internals and storage paths. */
  async function present(candidate, branchId, userId, dismissed = false) {
    const publicMember = async (item) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      category_id: item.category_id,
      category_path: item.category_path,
      attributes: item.attributes,
      image_url: await createCatalogImageUrl(item.image_path),
      evidence: modelEvidence(item),
      stock_quantity: item.stock_quantity,
      stock_distribution_source: item.stock_distribution_source,
      variant_lines: item.variant_lines.map(({ version, ...line }) => line),
    });
    return {
      ...candidate,
      dismissed,
      revision: createPublicationRevision(candidate, { branchId, userId }),
      members: await Promise.all(candidate.members.map(publicMember)),
      targets: await Promise.all(
        candidate.targets.map(async (target) => ({
          ...(await publicMember(target)),
          issues: [...compareMembers([...candidate.members, target]), ...target.linked_issues],
        })),
      ),
    };
  }

  /** Rebuild an explicitly selected subset so exclusions change every count, issue and revision together. */
  async function selectedCandidate(client, { branchId, itemIds, batchId }) {
    const evidence = await loadEvidence(client, branchId, batchId);
    const selected = evidence.items.filter((item) => itemIds.includes(item.id));
    const candidates = discoverCandidates(selected, evidence.targets, true);
    if (
      selected.length !== itemIds.length ||
      candidates.length !== 1 ||
      candidates[0].members.length !== itemIds.length
    )
      throw DomainError.conflict(
        "These lots changed or are no longer eligible. Refresh suggestions.",
      );
    return candidates[0];
  }

  matching.setSuggestionTargetValidator(async (client, plan) => {
    // Receipt must still target the reviewed model, even when POS brand or linked evidence changes after grouping.
    await client.query(
      "SELECT b.id FROM brands b JOIN products p ON p.brand_id=b.id WHERE p.id=$1 FOR SHARE OF b",
      [plan.target_product_id],
    );
    const evidence = await loadEvidence(client, plan.branch_id);
    const target = evidence.targets.find((row) => row.id === plan.target_product_id);
    if (
      !target ||
      fingerprint({ identity: identityOf(target), issues: target.linked_issues }) !==
        plan.identity_review.target_identity
    )
      throw DomainError.conflict(
        "The existing POS model evidence changed. Unmatch and review the target again.",
      );
  });

  return {
    async list({ branchId, userId, batchId }) {
      const started = performance.now();
      const evidence = await loadEvidence(pool, branchId, batchId);
      const dismissed = new Set(
        (
          await pool.query(
            "SELECT fingerprint FROM catalog_workspace.match_dismissals WHERE branch_id=$1 AND restored_at IS NULL",
            [branchId],
          )
        ).rows.map((row) => row.fingerprint),
      );
      const candidates = discoverCandidates(evidence.items, evidence.targets);
      return {
        suggestions: await Promise.all(
          candidates.map((candidate) =>
            present(candidate, branchId, userId, dismissed.has(candidate.id)),
          ),
        ),
        coverage: {
          eligible_lots: evidence.items.length,
          with_model_evidence: evidence.items.filter(modelEvidence).length,
        },
        discovery_ms: Math.round(performance.now() - started),
        model_calls: 0,
      };
    },
    async review(input) {
      return present(await selectedCandidate(pool, input), input.branchId, input.userId);
    },
    async dismiss(input) {
      // Dismissal is an identity decision only: stock, source lots and receipt plans remain unchanged.
      return repository.withTransaction(async (client) => {
        const candidate = await selectedCandidate(client, input);
        if (createPublicationRevision(candidate, input) !== input.expectedRevision)
          throw DomainError.conflict("Source evidence changed. Review the refreshed suggestion.");
        await client.query(
          `INSERT INTO catalog_workspace.match_dismissals(branch_id,fingerprint,member_ids,dismissed_by)
          VALUES($1,$2,$3,$4) ON CONFLICT(branch_id,fingerprint) DO UPDATE SET dismissed_by=$4,dismissed_at=now(),restored_at=NULL,restored_by=NULL`,
          [input.branchId, candidate.id, input.itemIds, input.userId],
        );
        return { dismissed: true };
      });
    },
    async restore({ branchId, userId, id }) {
      await pool.query(
        "UPDATE catalog_workspace.match_dismissals SET restored_at=now(),restored_by=$3 WHERE branch_id=$1 AND fingerprint=$2",
        [branchId, id, userId],
      );
      return { restored: true };
    },
    async confirm(input) {
      // The matching transaction owns the branch lock and member locks before this callback revalidates evidence.
      return matching.save({
        branchId: input.branchId,
        userId: input.userId,
        plan: {
          item_ids: input.itemIds,
          target_product_id: input.targetId,
          product_name: input.name,
          brand_name: input.brand,
          variant_defaults: {},
          review_note: input.note,
          confirm_differences: true,
        },
        validateIdentity: async (client, next, contexts) => {
          const candidate = await selectedCandidate(client, input);
          if (createPublicationRevision(candidate, input) !== input.expectedRevision)
            throw DomainError.conflict("Source evidence changed. Review the refreshed suggestion.");
          const target = input.targetId
            ? candidate.targets.find((row) => row.id === input.targetId)
            : null;
          if (input.targetId && !target)
            throw DomainError.conflict("The POS target is no longer eligible. Review again.");
          if (!input.targetId && input.itemIds.length < 2)
            throw DomainError.validationFailed("A new product group needs at least two lots.");
          const issues = target
            ? [...compareMembers([...candidate.members, target]), ...target.linked_issues]
            : candidate.issues;
          if (issues.length && (!input.resolveDifferences || !input.note.trim()))
            throw DomainError.validationFailed(
              "Document how you resolved the differences, or exclude/correct the affected lots.",
            );
          const materialIssue = issues.some((issue) => issue.field === "material");
          if (!target && materialIssue && input.material === undefined)
            throw DomainError.validationFailed(
              "Resolve the shared material or explicitly leave it unset.",
            );
          const material = materialIssue
            ? input.material
            : candidate.members[0].attributes?.material || null;
          if (
            !target &&
            !material &&
            contexts.some((context) =>
              context.fields.some((field) => field.key === "material" && field.required),
            )
          )
            throw DomainError.validationFailed(
              "This category requires material. Enter a verified shared material.",
            );
          next.brand_name = candidate.brand;
          next.identity_review = {
            fingerprint: fingerprint(candidate.members.map(identityOf)),
            member_identity: candidate.members.map(identityOf),
            material: material || null,
            target_identity: target
              ? fingerprint({ identity: identityOf(target), issues: target.linked_issues })
              : null,
            issues,
            resolution: input.note,
            confirmed_by: input.userId,
          };
        },
      });
    },
  };
}
module.exports = { createMatchSuggestionService };
