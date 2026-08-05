const KEY = 'novel2screenplay_history';

export interface HistoryEntry {
  jobId: string;
  title: string;
  sourceNovel: string;
  totalScenes: number;
  totalCharacters: number;
  totalLocations: number;
  createdAt: number; // timestamp ms
  author: string;
}

export const historyStore = {
  list(): HistoryEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  },

  add(entry: Omit<HistoryEntry, 'createdAt'>): void {
    if (typeof window === 'undefined') return;
    const existing = this.list();
    const next: HistoryEntry = { ...entry, createdAt: Date.now() };
    // Deduplicate by jobId
    const filtered = existing.filter(e => e.jobId !== entry.jobId);
    filtered.unshift(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, 50)));
    } catch {
      // Storage full — drop oldest
      try {
        localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, 20)));
      } catch {
        // silently ignore
      }
    }
  },

  remove(jobId: string): void {
    if (typeof window === 'undefined') return;
    const filtered = this.list().filter(e => e.jobId !== jobId);
    try {
      localStorage.setItem(KEY, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(KEY);
  },
};
