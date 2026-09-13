'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestPos, type Session } from '@/lib/catalog-api';

/** Require a deliberate, server-authorized branch choice before mounting any merchandise workspace. */
export function BranchWorkspaceGate({
  session,
  onEnter,
  onSignOut,
}: {
  session: Session;
  onEnter: (session: Session, branchId: string) => void;
  onSignOut: () => void;
}) {
  const [selectedBranch, setSelectedBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const branches = session.branches.filter((branch) => branch.can_switch_to);

  /** Recheck access at entry so a stale branch list cannot open a workspace after access changes. */
  async function enterSelectedWorkspace(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !branches.some((branch) => branch.id === selectedBranch)) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await requestPos<{ data: Session }>('/catalog/session', selectedBranch);
      if (
        data.id !== session.id ||
        !data.branches.some((branch) => branch.id === selectedBranch && branch.can_switch_to)
      ) {
        throw new Error(
          'This branch is no longer available to your account. Choose another branch or sign in again.',
        );
      }
      onEnter(data, selectedBranch);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-intro">
        <div className="wordmark">K—LINE.</div>
        <p>
          YOUR BRANCH.
          <br />
          YOUR WORKSPACE.
        </p>
        <span>Choose where you are working today.</span>
      </div>
      <form className="login-form" onSubmit={enterSelectedWorkspace}>
        <span className="eyebrow">SIGNED IN AS {session.full_name || session.username}</span>
        <h1>Choose your branch workspace</h1>
        <p className="muted">
          Receiving, pricing and stock will open for your selected branch. You can switch branches inside the
          workspace.
        </p>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-3 font-medium">Branch workspace</legend>
          {branches.map((branch) => (
            <label key={branch.id} className="branch-workspace-option">
              <input
                type="radio"
                name="branch-workspace"
                value={branch.id}
                required
                checked={selectedBranch === branch.id}
                onChange={() => setSelectedBranch(branch.id)}
              />
              <span>{branch.name}</span>
            </label>
          ))}
        </fieldset>
        {!branches.length && (
          <p role="alert">No branch workspace is available to your account. Contact your administrator.</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button className="h-12" type="submit" disabled={!selectedBranch || busy}>
          {busy ? 'Opening workspace…' : 'Enter workspace'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onSignOut}>
          Sign out
        </Button>
      </form>
    </main>
  );
}
