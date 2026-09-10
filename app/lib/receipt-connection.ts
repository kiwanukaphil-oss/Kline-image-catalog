/** Treat a lost acknowledgement as uncertain; never repeat stock writes until receipt status is re-read. */
export function isUncertainReceiptError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error && 'status' in error && [502, 503, 504].includes(Number(error.status)))
  );
}
export const RECEIPT_CONNECTION_MESSAGE =
  'Connection interrupted. Some stock may already have been received. Reload the review to check saved receipts before retrying.';
