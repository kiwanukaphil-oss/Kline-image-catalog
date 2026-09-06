# ADR-075: Review AI-filled catalog details in the preparation workflow

Status: Implemented locally; review and real-provider staging acceptance pending.
Date: 2026-09-06

The K-Line workspace exposes existing ADR-065/068 fill-empty inference as a selected-lot workflow and a single-photo action. Provider, schema, vocabulary, usage limits and protected-write behavior remain POS-owned. No new automatic or continuous AI processing is introduced.

The safe workspace detail projection includes AI confidence, original field observations, visible text and only the latest job's status/time. No usage billing, provider errors or protected costs are added. Branch authorization precedes these reads.

Explicit human review uses the existing revision-checked detail write. Allowed reviewed keys are name, brand and configured non-size detail fields. Reviewed and manually changed fields lose their AI confidence marker; original observations and AI events remain historical evidence. The manual edit audit records reviewed field names. Physical counts remain a separate human confirmation. No schema migration is needed.

The client processes selected photos sequentially, supports stopping after the active photo, and checks saved job state before retrying uncertain outcomes. Reopening completed jobs offers review without automatic repeat inference. A running job is not treated as failed; orphan recovery and real-provider accuracy are staging checks.

Validation uses real PostgreSQL/Jest and a real browser/HTTP workspace with only the external inference boundary replaced by deterministic responses. Existing POS AI source changes already pending in the checkout are preserved independently; this workflow does not change the provider prompt or classifier. Applied precedents: ADR-002, 006, 009, 016, 059, 065, 068, 073 and 074.
