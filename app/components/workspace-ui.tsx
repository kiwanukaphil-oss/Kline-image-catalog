'use client';
import { useCallback, useEffect, useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { requestPos } from '@/lib/catalog-api';

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  /* Use the shared accessible dialog primitive for focus trapping, escape and dismissal. */

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className={`workspace-dialog ${wide ? 'wide' : ''}`}>
        <DialogTitle className="dialog-title">{title}</DialogTitle>
        <DialogDescription className={description ? 'muted' : 'sr-only'}>
          {description || title}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Photo({
  url,
  name,
  className = '',
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  /* Display the original evidence image with an honest unavailable or missing-photo state. */

  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className={`photo ${className}`}>
      {url && !failed ? (
        <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>
          <ImageOff size={24} />
          <small>{failed ? 'Photo unavailable' : 'No photo'}</small>
        </span>
      )}
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  /* Associate the search label with its input while keeping the icon decorative. */

  return (
    <label className="search">
      <Search size={17} />
      <Input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}) {
  /* Expose previous and next pages without implying that a partial page is the full inventory. */

  return total > limit ? (
    <div className="pagination">
      <span>
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
      <Button variant="outline" disabled={page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <Button variant="outline" disabled={page * limit >= total} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  ) : null;
}
/** Cancel obsolete requests and clear snapshots whenever their account/branch/filter scope changes. */
export function usePosRead<T>(path: string, branch: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    /* Abort obsolete branch or filter reads before they can replace the current workspace state. */

    const controller = new AbortController();
    setData(null);
    setError('');
    setLoading(true);
    requestPos<T>(path, branch, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, branch, version]);
  return { data, error, loading, refresh };
}
