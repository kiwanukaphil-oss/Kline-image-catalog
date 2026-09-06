'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Boxes, LogOut, Moon, Sun, Tag, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPos, postPos, type Session } from '@/lib/catalog-api';
import { Receiving } from '@/components/receiving';
import { Pricing } from '@/components/pricing';
import { Stock } from '@/components/stock';
import { CategoryMappings } from '@/components/category-mappings';
import { InstallApp } from '@/components/install-app';
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
  async function restoreSession() {
    /* Reload POS identity before choosing an authorized remembered or default branch. */

    try {
      let activeBranch = sessionStorage.getItem('kline.branch');
      if (!activeBranch) {
        const { user } = await requestPos<{ user: { default_branch_id: string } }>('/auth/me');
        activeBranch = user.default_branch_id;
        sessionStorage.setItem('kline.branch', activeBranch);
      }
      const { data } = await requestPos<{ data: Session }>('/catalog/session', activeBranch);
      setSession(data);
      setBranch(activeBranch);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setChecking(false);
    }
  }
  function signOut() {
    sessionStorage.removeItem('kline.session');
    sessionStorage.removeItem('kline.branch');
    setSession(null);
    setBranch('');
    setPriceScope([]);
  }
  useEffect(() => {
    if (sessionStorage.getItem('kline.session')) void restoreSession();
    else setChecking(false);
    window.addEventListener('kline-session-expired', signOut);
    return () => window.removeEventListener('kline-session-expired', signOut);
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
          ).map(({ name, icon: Icon }) => (
            /* Expose the three daily workspaces as labelled, keyboard-accessible navigation. */ <Button
              key={name}
              variant="ghost"
              className={`nav-link ${destination === name ? 'active' : ''}`}
              aria-current={destination === name ? 'page' : undefined}
              onClick={() => {
                setDestination(name);
                if (name === 'Pricing') setPriceScope([]);
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
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <InstallApp />
          {session.can_manage_categories && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Category mappings"
              onClick={() => setMappingsOpen(true)}
            >
              <Settings size={17} />
            </Button>
          )}
          {mappingsOpen && (
            <CategoryMappings
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
            <select
              aria-label="Active branch"
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                sessionStorage.setItem('kline.branch', e.target.value);
                setPriceScope([]);
              }}
            >
              {session.branches
                .filter((b) => b.can_switch_to)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDark(!dark)}
            aria-label={dark ? 'Use light appearance' : 'Use dark appearance'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
          <Button className="mobile-only" variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </header>
        <main key={`${session.id}:${branch}`} className="content">
          <div hidden={destination !== 'Receiving'}>
            <Receiving
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
              onDone={() => setDestination('Receiving')}
            />
          )}
          {destination === 'Stock' && <Stock branch={branch} canOpenPos={!!session.can_open_pos_product} />}
        </main>
      </div>
    </div>
  );
}

/** Authenticate through POS without persisting the submitted password. */
function SignIn({ onSignIn, connectionError }: { onSignIn: () => Promise<void>; connectionError: string }) {
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
      const result = await postPos<{ token: string; user: { default_branch_id: string } }>(
        '/auth/login',
        '',
        {
          username: form.get('username'),
          password: form.get('password'),
        },
      );
      sessionStorage.setItem('kline.session', result.token);
      sessionStorage.setItem('kline.branch', result.user.default_branch_id);
      await onSignIn();
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
          FROM ARRIVAL
          <br />
          TO THE SHOP FLOOR.
        </p>
        <span>A considered workspace for your merchandise.</span>
      </div>
      <form className="login-form" onSubmit={submitCredentials}>
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p className="muted">Sign in with your POS account.</p>
        <label>
          Username
          <Input name="username" autoComplete="username" required />
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
