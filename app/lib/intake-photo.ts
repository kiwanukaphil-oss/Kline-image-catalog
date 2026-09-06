export type IntakePhoto = {
  id: string;
  file: File;
  preview: string;
  fingerprint: string;
  optimized: boolean;
  duplicate: boolean;
};
/** Compare small luminance fingerprints to flag similar shots without deciding whether units are duplicates. */
export function similarPhoto(left: string, right: string) {
  return (
    left.length === 64 &&
    right.length === 64 &&
    left.split('').filter((bit, index) => bit !== right[index]).length <= 3
  );
}
/** Decode one source at a time, retain ordinary bytes and resize only files exceeding the POS upload limit. */
export async function prepareIntakePhoto(file: File): Promise<IntakePhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 30 * 1024 * 1024)
    throw new Error('Choose JPEG, PNG or WebP photos up to 30 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 100000000)
      throw new Error('This photo is too large to process.');
    const sample = document.createElement('canvas');
    sample.width = 9;
    sample.height = 8;
    const pixels = sample.getContext('2d');
    if (!pixels) throw new Error('Photo preview is unavailable in this browser.');
    pixels.drawImage(bitmap, 0, 0, 9, 8);
    const values = pixels.getImageData(0, 0, 9, 8).data;
    let fingerprint = '';
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const index = (y * 9 + x) * 4;
        fingerprint +=
          values[index] + values[index + 1] + values[index + 2] >
          values[index + 4] + values[index + 5] + values[index + 6]
            ? '1'
            : '0';
      }
    let prepared = file;
    if (file.size > 5 * 1024 * 1024) {
      const canvas = document.createElement('canvas'),
        ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Photo preparation is unavailable.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('This photo could not be prepared.'))),
          'image/jpeg',
          0.92,
        ),
      );
      if (blob.size > 5 * 1024 * 1024)
        throw new Error('This photo is still too large. Choose a smaller copy.');
      prepared = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    }
    return {
      id: crypto.randomUUID(),
      file: prepared,
      preview: URL.createObjectURL(prepared),
      fingerprint,
      optimized: prepared !== file,
      duplicate: false,
    };
  } finally {
    bitmap.close();
  }
}
