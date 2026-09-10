export type AiBatch = {
  id: string;
  status: 'active' | 'paused' | 'stopped' | 'done';
  message: string;
  created_at: string;
  updated_at: string;
  items: {
    id: string;
    item_id: string;
    name: string;
    state: 'queued' | 'running' | 'done' | 'attention' | 'skipped';
    message: string;
    updated_at: string;
  }[];
};
export type AiBatchSummary = Omit<AiBatch, 'items'> & { total: number; completed: number };
