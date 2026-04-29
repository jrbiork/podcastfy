export type PendingGeneration = {
  id: string;
  mode: 'podcast' | 'tts';
  startedAt: number;
};

type StoreListener = (pending: PendingGeneration[]) => void;

let active: PendingGeneration[] = [];
const listeners = new Set<StoreListener>();

function notify() {
  const snapshot = [...active];
  listeners.forEach((fn) => fn(snapshot));
}

export const generationStore = {
  add(record: PendingGeneration): void {
    active = [...active, record];
    notify();
  },
  remove(id: string): void {
    active = active.filter((g) => g.id !== id);
    notify();
  },
  get(): PendingGeneration[] {
    return [...active];
  },
  subscribe(fn: StoreListener): () => void {
    listeners.add(fn);
    fn([...active]); // emit current state immediately on subscribe
    return () => listeners.delete(fn);
  },
};
