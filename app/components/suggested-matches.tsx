'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { postPos } from '@/lib/catalog-api';
import { Modal, Photo, usePosRead } from './workspace-ui';
import { WorkspaceSelect } from './workspace-select';

type Member = {
  id: string;
  name: string;
  brand: string;
  category_path: string;
  image_url: string | null;
  attributes: Record<string, string>;
  evidence: { source: string; text: string };
  stock_distribution_source: string;
  stock_quantity: number;
  variant_lines: { id: string; variant_attributes: Record<string, string>; quantity: number }[];
};
type Issue = { field: string; kind: string; message: string };
type Suggestion = {
  id: string;
  revision: string;
  brand: string;
  model: string;
  category_path: string;
  state: string;
  dismissed: boolean;
  members: Member[];
  issues: Issue[];
  targets: (Member & { issues: Issue[] })[];
  counts: {
    confirmed: boolean;
    total_units: number | null;
    rows: { attributes: Record<string, string>; quantity: number }[];
  };
};
type Discovery = {
  suggestions: Suggestion[];
  coverage: { eligible_lots: number; with_model_evidence: number };
  discovery_ms: number;
};

/** Refresh saved-data suggestions alongside receiving changes; failures never affect AI fill or receipt. */
export function SuggestedMatches({
  branch,
  batchId,
  refreshKey,
  onSaved,
}: {
  branch: string;
  batchId?: string;
  refreshKey: string;
  onSaved: () => void;
}) {
  const [includeOtherDeliveries, setIncludeOtherDeliveries] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState<Suggestion | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = batchId && !includeOtherDeliveries ? batchId : undefined;
  const discovery = usePosRead<Discovery>(
    `/catalog-workspace/match-suggestions${scope ? `?batch_id=${scope}` : ''}`,
    branch,
  );
  const refresh = discovery.refresh;
  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);
  const visible = discovery.data?.suggestions.filter((row) => row.dismissed === showDismissed) || [];
  const changed = () => {
    setReviewing(null);
    refresh();
    onSaved();
  };
  async function restoreSuggestion(id: string) {
    setBusy(true);
    setError('');
    try {
      await postPos('/catalog-workspace/match-suggestions/restore', branch, { id });
      refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="suggested-matches" aria-label="Suggested product matches">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          Suggested matches ({discovery.data?.suggestions.filter((row) => !row.dismissed).length ?? '…'})
        </Button>
        {discovery.error && (
          <span role="alert">
            Suggestions unavailable.{' '}
            <Button variant="outline" onClick={refresh}>
              Retry suggestions
            </Button>
          </span>
        )}
      </div>
      {expanded && (
        <div className="space-y-4 mt-4">
          <p className="muted">
            {scope ? 'Current delivery' : 'All unreceived deliveries in this branch'} · Review matching labels
            before grouping. Receiving stock is a separate step.
          </p>
          {batchId && (
            <label className="flex items-center gap-3">
              <Checkbox
                checked={includeOtherDeliveries}
                onCheckedChange={(value) => setIncludeOtherDeliveries(!!value)}
              />
              Include other unreceived deliveries
            </label>
          )}
          <label className="flex items-center gap-3">
            <Checkbox checked={showDismissed} onCheckedChange={(value) => setShowDismissed(!!value)} />
            Show kept-separate suggestions
          </label>
          {discovery.loading ? (
            <p role="status">Finding saved model evidence…</p>
          ) : (
            <>
              <p className="muted">
                {discovery.data?.coverage.with_model_evidence ?? 0} of{' '}
                {discovery.data?.coverage.eligible_lots ?? 0} eligible lots have model-code evidence.
              </p>
              {!visible.length && (
                <p>
                  No {showDismissed ? 'kept-separate' : 'new'} suggestions in this scope. Lots without
                  complete model evidence remain available for manual matching.
                </p>
              )}
              {visible.map((suggestion) => (
                <article className="suggestion-card" key={suggestion.id}>
                  <strong>
                    {suggestion.state} · {suggestion.members.length} photos
                  </strong>
                  <h3>
                    {suggestion.brand} · {suggestion.model}
                  </h3>
                  <p>{suggestion.category_path}</p>
                  <div className="suggestion-thumbnails">
                    {suggestion.members.slice(0, 4).map((member) => (
                      <Photo key={member.id} url={member.image_url} name={member.name} />
                    ))}
                  </div>
                  <p>
                    {suggestion.counts.confirmed
                      ? `${suggestion.counts.total_units} units from confirmed source counts`
                      : 'Counts need confirmation'}
                  </p>
                  {!!suggestion.issues.length && (
                    <p>{suggestion.issues.map((issue) => issue.message).join(' ')}</p>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      suggestion.dismissed ? void restoreSuggestion(suggestion.id) : setReviewing(suggestion)
                    }
                  >
                    {suggestion.dismissed ? 'Reconsider group' : 'Review group'}
                  </Button>
                </article>
              ))}
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      )}
      {reviewing && (
        <SuggestionReview
          key={reviewing.id}
          initial={reviewing}
          branch={branch}
          batchId={scope}
          onClose={() => setReviewing(null)}
          onSaved={changed}
        />
      )}
    </section>
  );
}

/** Compare all original evidence, recalculate exclusions on the server and require a fresh signed confirmation. */
function SuggestionReview({
  initial,
  branch,
  batchId,
  onClose,
  onSaved,
}: {
  initial: Suggestion;
  branch: string;
  batchId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [suggestion, setSuggestion] = useState(initial);
  const [target, setTarget] = useState(initial.targets.length ? '' : 'new');
  const [name, setName] = useState(`${initial.brand} ${initial.model}`);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [materialMode, setMaterialMode] = useState('');
  const [material, setMaterial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedTarget = suggestion.targets.find((row) => row.id === target);
  const issues = selectedTarget?.issues || suggestion.issues;
  const materialIssue = !selectedTarget && issues.some((issue) => issue.field === 'material');
  const originalIds = initial.members.map((row) => row.id);
  const includedIds = suggestion.members.map((row) => row.id);
  async function refreshComparison(itemIds = includedIds) {
    // Never retain a checkbox confirmation across source changes or excluded membership.
    setBusy(true);
    setError('');
    setConfirmed(false);
    setResolved(false);
    try {
      const next = await postPos<Suggestion>('/catalog-workspace/match-suggestions/review', branch, {
        item_ids: itemIds,
        batch_id: batchId,
      });
      setSuggestion(next);
      if (target !== 'new' && !next.targets.some((row) => row.id === target)) setTarget('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDecision(action: 'confirm' | 'dismiss') {
    // Confirmation saves a plan only; no stock or price endpoint is called from this screen.
    setBusy(true);
    setError('');
    try {
      await postPos(`/catalog-workspace/match-suggestions/${action}`, branch, {
        item_ids: action === 'dismiss' ? originalIds : includedIds,
        batch_id: batchId,
        expected_revision: action === 'dismiss' ? initial.revision : suggestion.revision,
        target_product_id: target === 'new' ? null : target,
        product_name: name,
        brand_name: suggestion.brand,
        review_note: note || `Reviewed matching printed model ${suggestion.model} and original photos.`,
        confirm_identity: confirmed,
        resolve_differences: resolved,
        ...(materialIssue && materialMode
          ? { material: materialMode === 'unset' ? null : material.trim() }
          : {}),
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Review ${suggestion.brand} · ${suggestion.model}`}
      description={suggestion.category_path}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {suggestion.counts.confirmed
          ? `${suggestion.counts.total_units} units from confirmed source counts`
          : 'Counts need confirmation — recorded quantities below are unconfirmed.'}
      </p>
      <p>
        {suggestion.counts.rows
          .map((row) => `${Object.values(row.attributes).join('/')} × ${row.quantity}`)
          .join(' · ')}
      </p>
      <div className="matching-evidence">
        {suggestion.members.map((member) => (
          <article key={member.id}>
            <a
              href={member.image_url || undefined}
              target="_blank"
              rel="noreferrer"
              aria-label={`View original photo of ${member.name}`}
            >
              <Photo url={member.image_url} name={member.name} />
            </a>
            <strong>{member.name}</strong>
            <small>
              {member.brand} · {member.category_path}
            </small>
            <p>
              {Object.entries(member.attributes)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' / ')}
            </p>
            <p>
              <strong>{member.evidence.source}</strong>: {member.evidence.text}
            </p>
            <p>
              {member.variant_lines
                .map((line) => `${Object.values(line.variant_attributes).join('/')} × ${line.quantity}`)
                .join(' · ')}
              {member.stock_distribution_source !== 'human_confirmed' && ' (unconfirmed)'}
            </p>
            <Button
              variant="outline"
              disabled={busy || includedIds.length === 1}
              onClick={() => void refreshComparison(includedIds.filter((id) => id !== member.id))}
            >
              Exclude {member.attributes.size || member.name}
            </Button>
          </article>
        ))}
      </div>
      {includedIds.length < originalIds.length && (
        <Button variant="outline" disabled={busy} onClick={() => void refreshComparison(originalIds)}>
          Restore excluded lots
        </Button>
      )}
      <label htmlFor="suggestion-destination">
        Destination
        <WorkspaceSelect
          id="suggestion-destination"
          value={target}
          onValueChange={(value) => {
            setTarget(value);
            setConfirmed(false);
            setResolved(false);
          }}
        >
          <option value="">Choose a destination</option>
          <option value="new">One new product</option>
          {suggestion.targets.map((row) => (
            <option key={row.id} value={row.id}>
              Existing POS: {row.name}
            </option>
          ))}
        </WorkspaceSelect>
      </label>
      {selectedTarget && (
        <article className="suggestion-card">
          <strong>Existing POS evidence: {selectedTarget.name}</strong>
          <Photo url={selectedTarget.image_url} name={selectedTarget.name} />
          <p>{selectedTarget.evidence.text}</p>
          <p>
            {Object.entries(selectedTarget.attributes)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' / ')}
          </p>
          <p>Existing variant prices and costs are retained when receiving.</p>
        </article>
      )}
      <label>
        Product name
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!!issues.length && (
        <div className="suggestion-issues">
          <strong>Check differences</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
          <p>
            Correct the lot details and refresh, exclude a lot, or document why these differences still
            describe the same product.
          </p>
          <label>
            Resolution notes
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you verify on the original labels?"
            />
          </label>
          {materialIssue && (
            <>
              <label htmlFor="suggestion-material">
                Shared material
                <WorkspaceSelect
                  id="suggestion-material"
                  value={materialMode}
                  onValueChange={setMaterialMode}
                >
                  <option value="">Resolve material</option>
                  <option value="unset">Leave optional material unset</option>
                  <option value="value">Use a verified material</option>
                </WorkspaceSelect>
              </label>
              {materialMode === 'value' && (
                <label>
                  Verified material
                  <Input value={material} onChange={(event) => setMaterial(event.target.value)} />
                </label>
              )}
            </>
          )}
          <label className="flex items-center gap-3">
            <Checkbox checked={resolved} onCheckedChange={(value) => setResolved(!!value)} />I resolved the
            listed differences and recorded the reason.
          </label>
        </div>
      )}
      <label className="flex items-center gap-3">
        <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(!!value)} />I checked the
        original photos and confirm these lots are the same model and design.
      </label>
      <p className="muted">This saves a group. Prices, counts and stock receipt are reviewed separately.</p>
      {error && (
        <p role="alert" className="error">
          {error}{' '}
          <Button variant="outline" disabled={busy} onClick={() => void refreshComparison()}>
            Refresh comparison
          </Button>
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Back
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void saveDecision('dismiss')}>
          {includedIds.length < originalIds.length ? 'Keep original group separate' : 'Keep separate'}
        </Button>
        <Button
          disabled={
            busy ||
            !confirmed ||
            !name.trim() ||
            !target ||
            (target === 'new' && includedIds.length < 2) ||
            (!!issues.length && (!resolved || !note.trim())) ||
            (materialIssue && (!materialMode || (materialMode === 'value' && !material.trim())))
          }
          onClick={() => void saveDecision('confirm')}
        >
          {busy ? 'Saving…' : 'Confirm group'}
        </Button>
      </div>
    </Modal>
  );
}
