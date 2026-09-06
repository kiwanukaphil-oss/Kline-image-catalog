'use client';
// Keyboard focus is intentional on the overflow region so arrow keys can inspect enlarged labels.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal, usePosRead } from './workspace-ui';

/** Read a fresh signed photo independently so inspecting or retrying never resets the draft form. */
export function PhotoInspector({
  itemId,
  branch,
  onClose,
}: {
  itemId: string;
  branch: string;
  onClose: () => void;
}) {
  const detail = usePosRead<{ item: { image_url: string | null; name: string } }>(
    `/catalog-workspace/items/${itemId}`,
    branch,
  );
  const [zoom, setZoom] = useState(1),
    [failed, setFailed] = useState(false);
  const url = detail.data?.item.image_url;
  return (
    <Modal title="Inspect photo" wide onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={zoom === 1 || !url || failed} onClick={() => setZoom(zoom - 1)}>
          Zoom out
        </Button>
        <Button variant="outline" disabled={zoom === 4 || !url || failed} onClick={() => setZoom(zoom + 1)}>
          Zoom in
        </Button>
        <Button variant="outline" onClick={() => setZoom(1)}>
          Fit photo
        </Button>
        <span className="self-center text-sm" role="status">
          {zoom}×
        </span>
      </div>
      <div className="photo-inspector" tabIndex={0} aria-label="Photo inspection area">
        {detail.loading ? (
          <p role="status">Loading photo…</p>
        ) : detail.error || failed || !url ? (
          <div className="p-6 text-center">
            <p role="status">{detail.error || (url ? 'Photo unavailable' : 'No photo attached')}</p>
            <Button
              variant="outline"
              onClick={() => {
                setFailed(false);
                detail.refresh();
              }}
            >
              Reload photo
            </Button>
          </div>
        ) : (
          <img
            src={url}
            alt={detail.data?.item.name || 'Original merchandise photo'}
            onError={() => setFailed(true)}
            style={{
              width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
              maxWidth: zoom === 1 ? '100%' : 'none',
              maxHeight: zoom === 1 ? '60vh' : 'none',
            }}
          />
        )}
      </div>
    </Modal>
  );
}
