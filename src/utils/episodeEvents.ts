type Listener = () => void;
const listeners = new Set<Listener>();

export const episodeEvents = {
  emit(): void {
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
