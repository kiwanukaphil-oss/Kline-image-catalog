'use client';
import { WorkspaceSelect } from '@/components/workspace-select';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPos, type Session } from '@/lib/catalog-api';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import { Modal, usePosRead } from './workspace-ui';
import { CategoryMappings } from './category-mappings';
type Field = {
  id?: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  inherit: boolean;
  category_id?: string;
};
type Category = { id: string; name: string; parent_id: string | null; active: boolean };
type Schema = { categories: Category[]; fields: Field[]; revision: string };
/** Keep occasional administration apart from daily merchandise work and reuse POS identity management. */
export function WorkspaceSettings({
  branch,
  session,
  onClose,
}: {
  branch: string;
  session: Session;
  onClose: () => void;
}) {
  const [page, setPage] = useState('home');
  const configured =
    process.env.NEXT_PUBLIC_POS_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : '');
  let usersUrl: string | null = null;
  try {
    const url = new URL(configured);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      usersUrl = new URL('/users', url.origin).toString();
  } catch {
    /* No link until a valid POS origin is configured. */
  }
  if (page === 'mappings') return <CategoryMappings branch={branch} onClose={() => setPage('home')} />;
  if (page === 'schema') return <CatalogSchemaEditor branch={branch} onClose={() => setPage('home')} />;
  if (page === 'diagnostics') return <Diagnostics branch={branch} onClose={() => setPage('home')} />;
  return (
    <Modal title="Workspace settings" onClose={onClose}>
      {session.can_manage_categories && (
        <>
          <Button variant="outline" onClick={() => setPage('schema')}>
            Categories and fields
          </Button>
          <Button variant="outline" onClick={() => setPage('mappings')}>
            Category mappings
          </Button>
        </>
      )}
      {session.can_manage_users &&
        (usersUrl ? (
          <a
            className="inline-flex min-h-11 items-center underline"
            href={usersUrl}
            target="_blank"
            rel="noreferrer"
          >
            Users and permissions in POS ↗
          </a>
        ) : (
          <p>POS administration link is not configured.</p>
        ))}
      {session.can_view_diagnostics && (
        <Button variant="outline" onClick={() => setPage('diagnostics')}>
          Diagnostics
        </Button>
      )}
    </Modal>
  );
}
/** Display operational counts without exposing credentials, provider responses or other branches. */
function Diagnostics({ branch, onClose }: { branch: string; onClose: () => void }) {
  const read = usePosRead<{
    workspace_version: string;
    ai_enabled: boolean;
    interrupted_ai: number;
    pos_links_to_check: number;
  }>('/catalog-workspace/diagnostics', branch);
  return (
    <Modal title="Diagnostics" onClose={onClose}>
      {read.loading ? (
        <p role="status">Checking services…</p>
      ) : read.error ? (
        <p role="alert" className="error">
          {read.error}
        </p>
      ) : (
        read.data && (
          <dl className="space-y-3">
            <div>
              <dt>Workspace package</dt>
              <dd>{read.data.workspace_version}</dd>
            </div>
            <div>
              <dt>AI fill</dt>
              <dd>{read.data.ai_enabled ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div>
              <dt>Interrupted AI attempts</dt>
              <dd>{read.data.interrupted_ai}</dd>
            </div>
            <div>
              <dt>POS links to check</dt>
              <dd>{read.data.pos_links_to_check}</dd>
            </div>
          </dl>
        )
      )}
      <Button variant="outline" onClick={read.refresh}>
        Refresh
      </Button>
    </Modal>
  );
}
/** Edit a single category against the full reviewed schema; existing keys, types and ancestry stay stable. */
function CatalogSchemaEditor({ branch, onClose }: { branch: string; onClose: () => void }) {
  const read = usePosRead<Schema>('/catalog-workspace/schema', branch);
  const [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [parent, setParent] = useState(''),
    [fields, setFields] = useState<Field[]>([]);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false),
    [saved, setSaved] = useState('');
  useWorkspaceProtection(dirty, busy);
  const existing = read.data?.categories.find((category) => category.id === selected);
  useEffect(() => {
    setSelected('');
    setDirty(false);
  }, [read.data]);
  function chooseCategory(id: string) {
    const category = read.data?.categories.find((row) => row.id === id);
    setSelected(id);
    setName(category?.name || '');
    setParent(category?.parent_id || '');
    setFields(
      (read.data?.fields.filter((field) => field.category_id === id) || []).map((field) => ({
        ...field,
        options: field.options || [],
      })),
    );
    setDirty(false);
    setError('');
    setSaved('');
  }
  function changeField(index: number, patch: Partial<Field>) {
    setFields((previous) =>
      previous.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    );
    setDirty(true);
  }
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function saveCategory() {
    // Validation failures leave the definition visible; a competing schema edit requires a deliberate reload.
    if (!read.data) return;
    setBusy(true);
    setError('');
    try {
      await requestPos(`/catalog-workspace/schema/${selected}`, branch, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          parent_id: parent || null,
          fields: fields.map((field) => ({
            ...field,
            options: field.options.map((value) => value.trim()).filter(Boolean),
          })),
          expected_revision: read.data.revision,
        }),
      });
      setDirty(false);
      setSaved('Category saved');
      window.dispatchEvent(new Event('kline-reference-data-changed'));
      read.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const inherited: Field[] = [];
  let ancestor = parent;
  const seen = new Set(fields.map((field) => field.key));
  for (let depth = 0; ancestor && depth < 20; depth++) {
    for (const field of read.data?.fields.filter(
      (field) => field.category_id === ancestor && field.inherit,
    ) || [])
      if (!seen.has(field.key)) {
        inherited.push(field);
        seen.add(field.key);
      }
    ancestor = read.data?.categories.find((category) => category.id === ancestor)?.parent_id || '';
  }
  return (
    <Modal
      title="Categories and fields"
      description="Definitions apply across branches."
      wide
      onClose={close}
    >
      {read.loading ? (
        <p role="status">Loading definitions…</p>
      ) : read.error ? (
        <p role="alert" className="error">
          {read.error}
        </p>
      ) : (
        <>
          <label>
            Category
            <WorkspaceSelect
              aria-label="Category"
              disabled={dirty || busy}
              value={selected}
              onValueChange={(event) => chooseCategory(event)}
            >
              <option value="">Choose category</option>
              {read.data?.categories
                .filter((category) => category.active)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.parent_id
                      ? ` · ${read.data?.categories.find((row) => row.id === category.parent_id)?.name || ''}`
                      : ''}
                  </option>
                ))}
            </WorkspaceSelect>
          </label>
          <Button
            variant="outline"
            disabled={dirty || busy}
            onClick={() => {
              chooseCategory(crypto.randomUUID());
              setDirty(true);
            }}
          >
            New category
          </Button>
          {selected && (
            <>
              <label>
                Category name
                <Input
                  value={name}
                  maxLength={160}
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Parent category
                <WorkspaceSelect
                  aria-label="Parent category"
                  value={parent}
                  disabled={!!existing || busy}
                  onValueChange={(event) => {
                    setParent(event);
                    setDirty(true);
                  }}
                >
                  <option value="">No parent</option>
                  {read.data?.categories
                    .filter((category) => category.active && category.id !== selected)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </WorkspaceSelect>
              </label>
              {inherited.length > 0 && (
                <div>
                  <h3>Inherited fields</h3>
                  <p className="text-sm text-muted-foreground">
                    {inherited
                      .map((field) => `${field.label}${field.required ? ' (required)' : ''}`)
                      .join(' · ')}
                  </p>
                </div>
              )}
              <div className="space-y-4">
                {fields.map((field, index) => {
                  const original = !!field.id;
                  return (
                    <fieldset key={index} className="rounded-lg border p-3 space-y-3">
                      <legend>Field {index + 1}</legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          Label
                          <Input
                            value={field.label}
                            disabled={busy}
                            onChange={(event) => changeField(index, { label: event.target.value })}
                          />
                        </label>
                        <label>
                          Field key
                          <Input
                            value={field.key}
                            disabled={busy || original}
                            onChange={(event) => changeField(index, { key: event.target.value })}
                          />
                        </label>
                      </div>
                      <label>
                        Type
                        <WorkspaceSelect
                          aria-label="Type"
                          disabled={busy || original}
                          value={field.type}
                          onValueChange={(event) => changeField(index, { type: event })}
                        >
                          {['text', 'number', 'select', 'boolean', 'size'].map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </WorkspaceSelect>
                      </label>
                      {['select', 'size'].includes(field.type) && (
                        <label>
                          Choices (one per line)
                          <textarea
                            className="w-full rounded border p-2"
                            value={field.options.join('\n')}
                            disabled={busy}
                            onChange={(event) =>
                              changeField(index, { options: event.target.value.split('\n') })
                            }
                          />
                        </label>
                      )}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.required}
                          disabled={busy}
                          onChange={(event) => changeField(index, { required: event.target.checked })}
                        />
                        Required before receiving
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.inherit}
                          disabled={busy}
                          onChange={(event) => changeField(index, { inherit: event.target.checked })}
                        />
                        Include in child categories
                      </label>
                      {!original && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            // Only an unsaved field can be removed; persisted definitions retain their identity.
                            setFields((previous) => previous.filter((_, position) => position !== index));
                            setDirty(true);
                          }}
                        >
                          Remove unsaved field
                        </Button>
                      )}
                    </fieldset>
                  );
                })}
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setFields((previous) => [
                    ...previous,
                    { key: '', label: '', type: 'text', options: [], required: false, inherit: true },
                  ]);
                  setDirty(true);
                }}
              >
                Add field
              </Button>
              <div className="flex gap-2">
                <Button disabled={busy || !dirty || !name.trim()} onClick={saveCategory}>
                  {busy ? 'Saving…' : 'Save category'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDirty(false);
                    read.refresh();
                  }}
                >
                  {dirty ? 'Discard and reload' : 'Reload definitions'}
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {saved && <p role="status">{saved}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {discard && (
        <Modal title="Leave unsaved definitions?" onClose={() => setDiscard(false)}>
          <Button variant="outline" onClick={() => setDiscard(false)}>
            Keep editing
          </Button>
          <Button onClick={onClose}>Discard changes</Button>
        </Modal>
      )}
    </Modal>
  );
}
