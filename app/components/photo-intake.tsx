'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from './workspace-ui';
import { prepareIntakePhoto, similarPhoto, type IntakePhoto } from '@/lib/intake-photo';
import { sharedPhotos } from '@/lib/shared-photos';

/** Keep capture and selection review together; every retained image remains one deliberate photographed lot. */
export function PhotoIntake({
  onChange,
  disabled,
  onWorkingChange,
}: {
  onChange: (files: File[]) => void;
  disabled: boolean;
  onWorkingChange: (value: boolean) => void;
}) {
  const [photos, setPhotos] = useState<IntakePhoto[]>([]),
    [camera, setCamera] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const current = useRef<IntakePhoto[]>([]),
    alive = useRef(true);
  const importSharedPhotos = useEffectEvent((files: File[]) => {
    void addPhotos(files);
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      current.current.forEach((photo) => URL.revokeObjectURL(photo.preview));
    };
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('share');
    let cancelled = false;
    if (id)
      void sharedPhotos(id)
        .then((files) => {
          if (!cancelled && files.length) importSharedPhotos(files);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause.message);
        });
    return () => {
      cancelled = true;
    };
  }, []);
  async function addPhotos(files: File[]) {
    // Process sequentially to bound decoded image memory; keep earlier successful choices if a later file fails.
    if (current.current.length + files.length > 100) {
      setError('Choose up to 100 photos per delivery.');
      return;
    }
    setWorking(true);
    onWorkingChange(true);
    setError('');
    try {
      for (const file of files) {
        const photo = await prepareIntakePhoto(file);
        if (!alive.current) {
          URL.revokeObjectURL(photo.preview);
          return;
        }
        photo.duplicate = current.current.some((previous) =>
          similarPhoto(previous.fingerprint, photo.fingerprint),
        );
        current.current = [...current.current, photo];
        setPhotos(current.current);
        onChange(current.current.map((row) => row.file));
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (alive.current) {
        setWorking(false);
        onWorkingChange(false);
      }
    }
  }
  function removePhoto(id: string) {
    const photo = current.current.find((row) => row.id === id);
    if (photo) URL.revokeObjectURL(photo.preview);
    current.current = current.current.filter((row) => row.id !== id);
    setPhotos(current.current);
    onChange(current.current.map((row) => row.file));
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11 flex-1"
          variant="outline"
          disabled={disabled || working}
          onClick={() => setCamera(true)}
        >
          Open camera
        </Button>
        <label className="relative flex h-11 flex-1 items-center justify-center rounded-lg border cursor-pointer focus-within:ring-2">
          Choose photos
          <input
            aria-label="Delivery photos"
            className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || working}
            onChange={(event) => {
              void addPhotos(Array.from(event.target.files || []));
              event.target.value = '';
            }}
          />
        </label>
      </div>
      {working && <p role="status">Preparing photos…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="border rounded-lg p-2 space-y-2">
              <img src={photo.preview} alt={photo.file.name} className="w-full h-28 object-contain rounded" />
              {photo.optimized && <small>Resized for upload</small>}
              {photo.duplicate && <p className="text-sm">Similar to another photo</p>}
              <Button
                variant="outline"
                disabled={disabled || working}
                onClick={() => removePhoto(photo.id)}
                aria-label={`Remove ${photo.file.name}`}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      {camera && (
        <CaptureCamera
          disabled={working || disabled}
          onCapture={(file) => addPhotos([file])}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  );
}
/** Hold one rear-camera stream for consecutive shots and release every track when the camera closes. */
function CaptureCamera({
  onCapture,
  onClose,
  disabled,
}: {
  onCapture: (file: File) => Promise<void>;
  onClose: () => void;
  disabled: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 } },
        audio: false,
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) video.current.srcObject = media;
      })
      .catch(() => setError('Camera unavailable. Choose photos or use the phone camera below.'));
    if (!navigator.mediaDevices) setError('Camera unavailable. Use the phone camera below.');
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  async function capturePhoto() {
    // Capture the current frame; selecting Done never creates an extra photographed unit.
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (blob) {
      await onCapture(new File([blob], `Capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setCount((value) => value + 1);
    }
  }
  return (
    <Modal
      title="Capture merchandise"
      onClose={() => {
        if (!disabled) onClose();
      }}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          onLoadedData={() => setReady(true)}
          className="w-full max-h-80 rounded-lg"
          aria-label="Live camera"
        />
      )}
      <label>
        Phone camera
        <input
          aria-label="Phone camera"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onCapture(file);
            event.target.value = '';
          }}
        />
      </label>
      <p role="status">{count} photos captured</p>
      <div className="dialog-actions">
        <Button variant="outline" disabled={disabled} onClick={onClose}>
          Done
        </Button>
        <Button disabled={disabled || !ready} onClick={capturePhoto}>
          Take photo
        </Button>
      </div>
    </Modal>
  );
}
