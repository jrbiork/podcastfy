import { useState, useCallback } from 'react';
import { Folder } from '../types';
import { loadFolders, saveFolder, updateFolder, deleteFolder } from '../services/storage';

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFolders(await loadFolders());
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(async (folder: Folder) => {
    await saveFolder(folder);
    setFolders((prev) => [...prev, folder]);
  }, []);

  const update = useCallback(async (folder: Folder) => {
    await updateFolder(folder);
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { folders, loading, load, add, update, remove };
}
