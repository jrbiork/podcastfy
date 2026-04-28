import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Episode, Folder } from '../types';

const EPISODES_KEY = 'podcastify_episodes';

export async function loadEpisodes(): Promise<Episode[]> {
  try {
    const raw = await AsyncStorage.getItem(EPISODES_KEY);
    if (!raw) return [];
    const list: Episode[] = JSON.parse(raw);

    // Migrate URIs when sandbox UUID changes on reinstall
    const docDir = FileSystem.documentDirectory ?? '';
    let changed = false;
    const migrated = list.map((e) => {
      if (!e.uri || e.uri.startsWith('http') || e.uri.startsWith(docDir)) return e;
      const filename = e.uri.split('/').pop();
      if (!filename) return e;
      changed = true;
      return { ...e, uri: `${docDir}${filename}` };
    });

    if (changed) {
      await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(migrated));
    }

    return migrated;
  } catch {
    return [];
  }
}

export async function saveEpisode(episode: Episode): Promise<void> {
  const list = await loadEpisodes();
  const updated = [episode, ...list.filter((e) => e.id !== episode.id)];
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

export async function updateEpisode(episode: Episode): Promise<void> {
  await saveEpisode(episode);
}

export async function deleteEpisode(id: string): Promise<void> {
  const list = await loadEpisodes();
  const episode = list.find((e) => e.id === id);
  const updated = list.filter((e) => e.id !== id);
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));

  // Delete the local MP3 file
  if (episode?.uri) {
    try {
      await FileSystem.deleteAsync(episode.uri, { idempotent: true });
    } catch {
      /* best-effort */
    }
  }
}

// ── Folders ─────────────────────────────────────────────────────────────────

const FOLDERS_KEY = 'podcastify_folders';

export async function loadFolders(): Promise<Folder[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as Folder[]) : [];
  } catch {
    return [];
  }
}

export async function saveFolder(folder: Folder): Promise<void> {
  const list = await loadFolders();
  const updated = [...list.filter((f) => f.id !== folder.id), folder];
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(updated));
}

export async function updateFolder(folder: Folder): Promise<void> {
  await saveFolder(folder);
}

export async function deleteFolder(id: string): Promise<void> {
  const list = await loadFolders();
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(list.filter((f) => f.id !== id)));
  // Detach episodes that were in this folder
  const episodes = await loadEpisodes();
  const updated = episodes.map((e) => (e.folderId === id ? { ...e, folderId: undefined } : e));
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

// ── Clear all ────────────────────────────────────────────────────────────────

export async function clearAllEpisodes(): Promise<void> {
  const list = await loadEpisodes();
  for (const e of list) {
    if (e.uri) {
      try {
        await FileSystem.deleteAsync(e.uri, { idempotent: true });
      } catch {
        /* best-effort */
      }
    }
  }
  await AsyncStorage.removeItem(EPISODES_KEY);
}
