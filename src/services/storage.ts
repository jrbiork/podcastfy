import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Episode, Folder } from '../types';

const EPISODES_KEY = 'podcastify_episodes';
export const TRASH_FOLDER_ID = 'trash';
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TRASH_FOLDER: Folder = {
  id: TRASH_FOLDER_ID,
  name: 'Trash',
  color: '#EF4444',
  createdAt: 0,
};

function shouldPurgeEpisode(episode: Episode, now: number): boolean {
  return (
    episode.folderId === TRASH_FOLDER_ID &&
    typeof episode.deletedAt === 'number' &&
    now - episode.deletedAt > TRASH_RETENTION_MS
  );
}

export async function loadEpisodes(): Promise<Episode[]> {
  try {
    const raw = await AsyncStorage.getItem(EPISODES_KEY);
    if (!raw) return [];
    const list: Episode[] = JSON.parse(raw);
    const now = Date.now();

    // Migrate URIs when sandbox UUID changes on reinstall
    const docDir = FileSystem.documentDirectory ?? '';
    let changed = false;
    const migratedAndPurged: Episode[] = [];
    for (const e of list) {
      if (shouldPurgeEpisode(e, now)) {
        if (e.uri) {
          try {
            await FileSystem.deleteAsync(e.uri, { idempotent: true });
          } catch {
            /* best-effort */
          }
        }
        changed = true;
        continue;
      }
      if (!e.uri || e.uri.startsWith('http') || e.uri.startsWith(docDir)) {
        migratedAndPurged.push(e);
        continue;
      }
      const filename = e.uri.split('/').pop();
      if (!filename) {
        migratedAndPurged.push(e);
        continue;
      }
      changed = true;
      migratedAndPurged.push({ ...e, uri: `${docDir}${filename}` });
    }

    if (changed) {
      await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(migratedAndPurged));
    }

    return migratedAndPurged;
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
  const now = Date.now();
  const updated = list.map((episode) => {
    if (episode.id !== id) return episode;
    return {
      ...episode,
      folderId: TRASH_FOLDER_ID,
      deletedAt: now,
      deletedFromFolderId: episode.folderId,
    };
  });
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

export async function restoreEpisode(id: string): Promise<void> {
  const list = await loadEpisodes();
  const updated = list.map((episode) => {
    if (episode.id !== id || episode.folderId !== TRASH_FOLDER_ID) return episode;
    const restoredFolderId =
      episode.deletedFromFolderId && episode.deletedFromFolderId !== TRASH_FOLDER_ID
        ? episode.deletedFromFolderId
        : undefined;
    return {
      ...episode,
      folderId: restoredFolderId,
      deletedAt: undefined,
      deletedFromFolderId: undefined,
    };
  });
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

export async function permanentDeleteEpisode(id: string): Promise<void> {
  const list = await loadEpisodes();
  const episode = list.find((e) => e.id === id);
  if (episode?.uri) {
    try { await FileSystem.deleteAsync(episode.uri, { idempotent: true }); } catch { /* best-effort */ }
  }
  const updated = list.filter((e) => e.id !== id);
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

export async function emptyTrash(): Promise<void> {
  const list = await loadEpisodes();
  const trashItems = list.filter((e) => e.folderId === TRASH_FOLDER_ID);
  await Promise.all(
    trashItems.map(async (e) => {
      if (e.uri) {
        try { await FileSystem.deleteAsync(e.uri, { idempotent: true }); } catch { /* best-effort */ }
      }
    }),
  );
  const updated = list.filter((e) => e.folderId !== TRASH_FOLDER_ID);
  await AsyncStorage.setItem(EPISODES_KEY, JSON.stringify(updated));
}

// ── Folders ─────────────────────────────────────────────────────────────────

const FOLDERS_KEY = 'podcastify_folders';

export async function loadFolders(): Promise<Folder[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Folder[]) : [];
    const withoutTrash = parsed.filter((f) => f.id !== TRASH_FOLDER_ID);
    const withTrash = [...withoutTrash, TRASH_FOLDER];
    const hadTrash = parsed.some((f) => f.id === TRASH_FOLDER_ID);
    const hasCorrectTrash = parsed.some((f) => f.id === TRASH_FOLDER_ID && f.name === TRASH_FOLDER.name);
    if (!hadTrash || !hasCorrectTrash || withTrash.length !== parsed.length) {
      await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(withTrash));
    }
    return withTrash;
  } catch {
    return [TRASH_FOLDER];
  }
}

export async function saveFolder(folder: Folder): Promise<void> {
  if (folder.id === TRASH_FOLDER_ID) return;
  const list = await loadFolders();
  const updated = [...list.filter((f) => f.id !== folder.id && f.id !== TRASH_FOLDER_ID), folder, TRASH_FOLDER];
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(updated));
}

export async function updateFolder(folder: Folder): Promise<void> {
  if (folder.id === TRASH_FOLDER_ID) return;
  await saveFolder(folder);
}

export async function deleteFolder(id: string): Promise<void> {
  if (id === TRASH_FOLDER_ID) return;
  const list = await loadFolders();
  const updatedFolders = list.filter((f) => f.id !== id && f.id !== TRASH_FOLDER_ID);
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify([...updatedFolders, TRASH_FOLDER]));
  // Detach episodes that were in this folder
  const episodes = await loadEpisodes();
  const updated = episodes.map((e) => {
    if (e.folderId === id) return { ...e, folderId: undefined };
    if (e.deletedFromFolderId === id) return { ...e, deletedFromFolderId: undefined };
    return e;
  });
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
