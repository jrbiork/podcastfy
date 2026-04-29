import { useState, useCallback } from 'react';
import { Episode } from '../types';
import {
  loadEpisodes,
  saveEpisode,
  deleteEpisode,
  updateEpisode,
  restoreEpisode,
  permanentDeleteEpisode,
  emptyTrash,
  TRASH_FOLDER_ID,
} from '../services/storage';
import { episodeEvents } from '../utils/episodeEvents';

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
    episodeEvents.emit();
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteEpisode(id);
    setEpisodes((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              folderId: TRASH_FOLDER_ID,
              deletedAt: Date.now(),
              deletedFromFolderId: e.folderId,
            }
          : e,
      ),
    );
  }, []);

  const restore = useCallback(async (id: string) => {
    await restoreEpisode(id);
    setEpisodes((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.folderId !== TRASH_FOLDER_ID) return e;
        return {
          ...e,
          folderId: e.deletedFromFolderId,
          deletedAt: undefined,
          deletedFromFolderId: undefined,
        };
      }),
    );
  }, []);

  const update = useCallback(async (episode: Episode) => {
    await updateEpisode(episode);
    setEpisodes((prev) => prev.map((e) => (e.id === episode.id ? episode : e)));
  }, []);

  const permanentRemove = useCallback(async (id: string) => {
    await permanentDeleteEpisode(id);
    setEpisodes((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearTrash = useCallback(async () => {
    await emptyTrash();
    setEpisodes((prev) => prev.filter((e) => e.folderId !== TRASH_FOLDER_ID));
  }, []);

  return { episodes, loading, load, add, remove, restore, update, permanentRemove, clearTrash };
}
