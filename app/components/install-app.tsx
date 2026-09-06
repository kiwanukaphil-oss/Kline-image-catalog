'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
/** Offer installation only when supported; updates never reload an open editing/capture dialog. */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    const install = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', install);
    let alive = true;
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          if (alive) setWaiting(registration.waiting);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (alive && worker.state === 'installed' && navigator.serviceWorker.controller)
                setWaiting(worker);
            });
          });
        })
        .catch(() => {
          /* Standard browser use and upload persistence remain available if installation is unsupported. */
        });
    return () => {
      alive = false;
      window.removeEventListener('beforeinstallprompt', install);
    };
  }, []);
  async function installApp() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }
  function updateApp() {
    if (document.querySelector('[role="dialog"]')) {
      setMessage('Close the open task before updating.');
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
  return (
    <>
      {prompt && (
        <Button variant="ghost" onClick={installApp}>
          Install app
        </Button>
      )}
      {waiting && (
        <Button variant="ghost" onClick={updateApp}>
          Update app
        </Button>
      )}
      {message && <span role="status">{message}</span>}
    </>
  );
}
