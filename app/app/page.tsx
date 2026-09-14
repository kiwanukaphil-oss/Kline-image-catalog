'use client';
import { WorkspaceSelect } from '@/components/workspace-select';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Boxes, LogOut, Moon, Sun, Tag, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPos, postPos, type Session } from '@/lib/catalog-api';
import { Receiving } from '@/components/receiving';
import { Pricing } from '@/components/pricing';
import { Stock } from '@/components/stock';
import { WorkspaceSettings } from '@/components/workspace-settings';
import { InstallApp } from '@/components/install-app';
import { Modal } from '@/components/workspace-ui';
import { BranchWorkspaceGate } from '@/components/branch-workspace-gate';
type Destination = 'Receiving' | 'Pricing' | 'Stock';

/** Restore the tab's POS session, then obtain authoritative capabilities. */
export default function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [branch, setBranch] = useState('');
  const [destination, setDestination] = useState<Destination>('Receiving');
  const [priceScope, setPriceScope] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const [mappingsOpen, setMappingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [navigation, setNavigation] = useState<{ action?: () => void; busy: boolean } | null>(null);
  function navigateSafely(action: () => void) {
    const event = new CustomEvent('kline-before-navigation', { cancelable: true, detail: { busy: false } });
    if (window.dispatchEvent(event)) action();
    else setNavigation({ action: event.detail.busy ? undefined : action, busy: event.detail.busy });
  }
  async function restoreSession() {
    /* Restore only an explicit choice belonging to this account; legacy defaults must pass the gate. */

    try {
      // The session endpoint requires branch context even when fetching only account capabilities.
      // Use the POS default for this metadata read without selecting or opening that workspace.
      const { user } = await requestPos<{ user: { default_branch_id: string } }>('/auth/me');
      const { data } = await requestPos<{ data: Session }>('/catalog/session', user.default_branch_id);
      const rememberedBranch = sessionStorage.getItem('kline.branch');
      const activeBranch =
        sessionStorage.getItem('kline.branch-owner') === data.id &&
        data.branches.some((candidate) => candidate.id === rememberedBranch && candidate.can_switch_to)
          ? rememberedBranch!
          : '';
      if (!activeBranch) {
        sessionStorage.removeItem('kline.branch');
        sessionStorage.removeItem('kline.branch-owner');
      }
      setSession(data);
      setBranch(activeBranch);
      setError('');
      setExpired(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setChecking(false);
    }
  }
  function signOut() {
    sessionStorage.removeItem('kline.session');
    sessionStorage.removeItem('kline.branch');
    sessionStorage.removeItem('kline.branch-owner');
    setSession(null);
    setBranch('');
    setPriceScope([]);
    setExpired(false);
    setNavigation(null);
  }
  useEffect(() => {
    if (sessionStorage.getItem('kline.session')) void restoreSession();
    else setChecking(false);
    const expireSession = () => setExpired(true);
    window.addEventListener('kline-session-expired', expireSession);
    return () => window.removeEventListener('kline-session-expired', expireSession);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  if (checking)
    return (
      <main className="login">
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (!session) return <SignIn onSignIn={restoreSession} connectionError={error} />;
  if (!branch)
    return expired ? (
      <SignIn onSignIn={restoreSession} connectionError={error} />
    ) : (
      <BranchWorkspaceGate
        session={session}
        onSignOut={signOut}
        onEnter={(selectedSession, selectedBranch) => {
          sessionStorage.setItem('kline.branch', selectedBranch);
          sessionStorage.setItem('kline.branch-owner', selectedSession.id);
          setSession(selectedSession);
          setBranch(selectedBranch);
          setDestination('Receiving');
          setPriceScope([]);
        }}
      />
    );
  return (
    <div className="workspace">
      <aside className="navigation">
        <Link className="wordmark" href="/" aria-label="K-Line workspace">
          K<span>—</span>LINE<span className="wordmark-dot">.</span>
        </Link>
        <p className="nav-caption">MERCHANDISE WORKSPACE</p>
        <nav aria-label="Workspace">
          {(
            [
              { name: 'Receiving', icon: ArrowDownToLine },
              { name: 'Pricing', icon: Tag },
              { name: 'Stock', icon: Boxes },
            ] as const
          )

            .map(({ name, icon: Icon }) => (
              /* Keep Receiving, Pricing and Stock available as the three daily workspaces. */ <Button
                key={name}
                variant="ghost"
                className={`nav-link ${destination === name ? 'active' : ''}`}
                aria-current={destination === name ? 'page' : undefined}
                onClick={() => {
                  if (name !== destination)
                    navigateSafely(() => {
                      setDestination(name);
                      if (name === 'Pricing') setPriceScope([]);
                    });
                }}
              >
                <Icon size={19} />
                {name}
              </Button>
            ))}
        </nav>
        <div className="nav-bottom">
          <span className="avatar">{(session.full_name || session.username).slice(0, 1)}</span>
          <div>
            <strong>{session.full_name || session.username}</strong>
            <small>POS account</small>
          </div>
          <Button variant="ghost" size="icon" onClick={() => navigateSafely(signOut)} aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <InstallApp />
          {(session.can_manage_categories || session.can_manage_users || session.can_view_diagnostics) && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Workspace settings"
              onClick={() => setMappingsOpen(true)}
            >
              <Settings size={17} />
            </Button>
          )}
          {mappingsOpen && (
            <WorkspaceSettings
              session={session}
              key={`${session.id}:${branch}`}
              branch={branch}
              onClose={() => setMappingsOpen(false)}
            />
          )}
          <span className="muted desktop-only">
            K-Line / <b>{destination}</b>
          </span>
          <label className="branch-control">
            <span className="status-dot" /> <span className="sr-only">Active branch</span>
            <WorkspaceSelect
              aria-label="Active branch"
              value={branch}
              onValueChange={(e) => {
                const nextBranch = e;
                navigateSafely(() => {
                  setBranch(nextBranch);
                  sessionStorage.setItem('kline.branch', nextBranch);
                  sessionStorage.setItem('kline.branch-owner', session.id);
                  setPriceScope([]);
                });
              }}
            >
              {session.branches
                .filter((b) => b.can_switch_to)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </WorkspaceSelect>
          </label>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDark(!dark)}
            aria-label={dark ? 'Use light appearance' : 'Use dark appearance'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
          <Button
            className="mobile-only"
            variant="ghost"
            size="icon"
            onClick={() => navigateSafely(signOut)}
            aria-label="Sign out"
          >
            <LogOut size={17} />
          </Button>
        </header>
        <main key={`${session.id}:${branch}`} className="content">
          <div hidden={destination !== 'Receiving'}>
            <Receiving
              onNavigate={navigateSafely}
              onStock={() => setDestination('Stock')}
              active={destination === 'Receiving'}
              branch={branch}
              session={session}
              onPrice={(ids) => {
                setPriceScope(ids);
                setDestination('Pricing');
              }}
            />
          </div>
          {destination === 'Pricing' && (
            <Pricing
              branch={branch}
              session={session}
              scope={priceScope}
              onDone={() => navigateSafely(() => setDestination('Receiving'))}
            />
          )}
          {destination === 'Stock' && <Stock branch={branch} canOpenPos={!!session.can_open_pos_product} />}
        </main>
      </div>
      {navigation && (
        <Modal
          title={navigation.busy ? 'Work is still saving' : 'Leave unsaved work?'}
          onClose={() => setNavigation(null)}
        >
          <p>
            {navigation.busy
              ? 'Wait for the current operation to finish, then try again.'
              : 'Changes you have not saved will be discarded.'}
          </p>
          <Button variant="outline" onClick={() => setNavigation(null)}>
            Keep working
          </Button>
          {navigation.action && (
            <Button
              onClick={() => {
                const action = navigation.action;
                setNavigation(null);
                action?.();
              }}
            >
              Discard and leave
            </Button>
          )}
        </Modal>
      )}
      {expired && (
        <Modal title="Sign in to continue" description="Your unsaved work is still here." onClose={() => {}}>
          <SignIn
            onSignIn={restoreSession}
            connectionError={error}
            resume={{ id: session.id, username: session.username }}
          />
          <Button variant="ghost" onClick={() => navigateSafely(signOut)}>
            Sign out
          </Button>
        </Modal>
      )}
    </div>
  );
}

/** Authenticate through POS without persisting the submitted password. */
function SignIn({
  onSignIn,
  connectionError,
  resume,
}: {
  onSignIn: () => Promise<void>;
  connectionError: string;
  resume?: { id: string; username: string };
}) {
  const [error, setError] = useState(connectionError),
    [busy, setBusy] = useState(false);
  useEffect(() => setError(connectionError), [connectionError]);
  async function submitCredentials(event: React.SyntheticEvent<HTMLFormElement>) {
    /* Exchange credentials for a tab-scoped token and then resolve POS capabilities. */

    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await postPos<{ token: string; user: { id: string; default_branch_id: string } }>(
        '/auth/login',
        '',
        {
          username: form.get('username'),
          password: form.get('password'),
        },
      );
      if (resume && result.user.id !== resume.id)
        throw new Error('Sign in with the account that owns this work.');
      sessionStorage.setItem('kline.session', result.token);
      if (!resume) {
        sessionStorage.removeItem('kline.branch');
        sessionStorage.removeItem('kline.branch-owner');
      }
      await onSignIn();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={resume ? 'space-y-4' : 'login'}>
      {!resume && (
        <div className="login-intro">
          <div className="wordmark">K—LINE.</div>
          <p>
            FROM ARRIVAL
            <br />
            TO THE SHOP FLOOR.
          </p>
          <span>A considered workspace for your merchandise.</span>
        </div>
      )}
      <form className="login-form" onSubmit={submitCredentials}>
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p className="muted">Sign in with your POS account.</p>
        <label>
          Username
          <Input
            name="username"
            autoComplete="username"
            defaultValue={resume?.username}
            readOnly={!!resume}
            required
          />
        </label>
        <label>
          Password
          <Input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button className="h-12" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
