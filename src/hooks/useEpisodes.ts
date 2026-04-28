import { useState, useCallback } from 'react';
import { Episode } from '../types';
import { loadEpisodes, saveEpisode, deleteEpisode, updateEpisode } from '../services/storage';

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadEpisodes();
      setEpisodes(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(async (episode: Episode) => {
    await saveEpisode(episode);
    setEpisodes((prev) => [episode, ...prev.filter((e) => e.id !== episode.id)]);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteEpisode(id);
    setEpisodes((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const update = useCallback(async (episode: Episode) => {
    await updateEpisode(episode);
    setEpisodes((prev) => prev.map((e) => (e.id === episode.id ? episode : e)));
  }, []);

  return { episodes, loading, load, add, remove, update };
}
