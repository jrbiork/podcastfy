import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useEpisodes } from '../hooks/useEpisodes';
import { useFolders } from '../hooks/useFolders';
import { formatDuration, formatDateCompact, generateId } from '../utils/format';
import { episodeEvents } from '../utils/episodeEvents';
import { generationStore, PendingGeneration } from '../utils/generationStore';
import { Episode, Folder } from '../types';
import { TRASH_FOLDER_ID } from '../services/storage';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Nav = StackNavigationProp<RootStackParamList>;

const FOLDER_COLORS = [
  '#60A5FA', '#34D399', '#F472B6', '#FBBF24',
  '#A78BFA', '#F87171', '#38BDF8', '#FB923C',
];

// ── Move-to-folder modal ──────────────────────────────────────────────────────

function MoveModal({
  episode,
  folders,
  visible,
  onMove,
  onDismiss,
}: {
  episode: Episode | null;
  folders: Folder[];
  visible: boolean;
  onMove: (folderId: string | undefined) => void;
  onDismiss: () => void;
}) {
  if (!episode) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={moveStyles.backdrop} onPress={onDismiss} />
      <View style={moveStyles.sheet}>
        <View style={moveStyles.handle} />
        <Text style={moveStyles.title}>Move to Folder</Text>

        <TouchableOpacity
          style={[moveStyles.row, !episode.folderId && moveStyles.rowSelected]}
          onPress={() => onMove(undefined)}
          activeOpacity={0.7}
        >
          <View style={[moveStyles.dot, { backgroundColor: Colors.textDim }]} />
          <Text style={moveStyles.rowLabel}>No Folder</Text>
          {!episode.folderId && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
        </TouchableOpacity>

        {folders.filter((f) => f.id !== TRASH_FOLDER_ID).map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[moveStyles.row, episode.folderId === f.id && moveStyles.rowSelected]}
            onPress={() => onMove(f.id)}
            activeOpacity={0.7}
          >
            <View style={[moveStyles.dot, { backgroundColor: f.color }]} />
            <Text style={moveStyles.rowLabel}>{f.name}</Text>
            {episode.folderId === f.id && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

const moveStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 40,
    paddingTop: Spacing.md,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
  },
  rowSelected: { backgroundColor: Colors.primary + '10' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowLabel: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: '500' },
});

// ── Episode row with swipe ────────────────────────────────────────────────────

type EpisodeRowProps = {
  item: Episode;
  folders: Folder[];
  navigation: Nav;
  isTrashView: boolean;
  openSwipeable: React.MutableRefObject<Swipeable | null>;
  onPress: (episode: Episode) => void;
  onRename: (episode: Episode) => void;
  onMove: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
  onRestore: (episode: Episode) => void;
  onPermanentDelete: (episode: Episode) => void;
};

function EpisodeRow({
  item,
  folders,
  navigation,
  isTrashView,
  openSwipeable,
  onPress,
  onRename,
  onMove,
  onDelete,
  onRestore,
  onPermanentDelete,
}: EpisodeRowProps) {
  const swipeRef = useRef<Swipeable>(null);
  const folder = item.folderId ? folders.find((f) => f.id === item.folderId) : null;

  const close = () => swipeRef.current?.close();

  const renderRightActions = () => (
    isTrashView ? (
      <View style={swipeStyles.row}>
        <TouchableOpacity
          style={[swipeStyles.action, swipeStyles.restoreAction]}
          onPress={() => { close(); onRestore(item); }}
          activeOpacity={0.85}
        >
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[swipeStyles.action, { backgroundColor: Colors.danger }]}
          onPress={() => { close(); onPermanentDelete(item); }}
          activeOpacity={0.85}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Delete</Text>
        </TouchableOpacity>
      </View>
    ) : (
      <View style={swipeStyles.row}>
        <TouchableOpacity
          style={[swipeStyles.action, { backgroundColor: '#F59E0B' }]}
          onPress={() => {
            close();
            onRename(item);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="pencil-outline" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Rename</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[swipeStyles.action, { backgroundColor: Colors.primary }]}
          onPress={() => {
            close();
            onMove(item);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="folder-open-outline" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Move</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[swipeStyles.action, { backgroundColor: Colors.danger }]}
          onPress={() => {
            close();
            onDelete(item);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Delete</Text>
        </TouchableOpacity>
      </View>
    )
  );

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => {
        if (openSwipeable.current && openSwipeable.current !== swipeRef.current) {
          openSwipeable.current.close();
        }
        openSwipeable.current = swipeRef.current;
      }}
      onSwipeableClose={() => {
        if (openSwipeable.current === swipeRef.current) {
          openSwipeable.current = null;
        }
      }}
    >
      <TouchableOpacity
        style={styles.episodeRow}
        onPress={() => onPress(item)}
        activeOpacity={0.8}
      >
        {item.thumbnailUrl ? (
          <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="headset" size={22} color={Colors.primary} />
          </View>
        )}
        <View style={styles.episodeMeta}>
          <Text style={styles.episodeTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.episodeSubRow}>
            <View style={[styles.modeBadge, item.mode === 'podcast' ? styles.badgePodcast : styles.badgeTts]}>
              <Ionicons
                name={item.mode === 'podcast' ? 'mic' : 'document-text'}
                size={11}
                color={item.mode === 'podcast' ? Colors.primary : Colors.accent}
              />
            </View>
            <Text style={styles.meta2}>{formatDuration(item.durationSeconds)}</Text>
            <Text style={styles.meta2}>{formatDateCompact(item.createdAt)}</Text>
            {!isTrashView && folder && (
              <View style={[styles.folderTag, { backgroundColor: folder.color + '22' }]}>
                <View style={[styles.folderDot, { backgroundColor: folder.color }]} />
                <Text style={[styles.folderTagText, { color: folder.color }]}>{folder.name}</Text>
              </View>
            )}
          </View>
          {isTrashView && item.deletedAt ? (() => {
            const days = Math.floor((Date.now() - item.deletedAt) / (24 * 60 * 60 * 1000));
            const label = days === 0 ? 'Deleted today' : `Deleted ${days}d ago`;
            return (
              <View style={styles.deletedTag}>
                <Ionicons name="time-outline" size={10} color={Colors.danger} />
                <Text style={styles.deletedTagText}>{label}</Text>
              </View>
            );
          })() : null}
        </View>
        {!item.played && !isTrashView && <View style={styles.unplayedDot} />}
      </TouchableOpacity>
    </Swipeable>
  );
}

const swipeStyles = StyleSheet.create({
  row: { flexDirection: 'row' },
  action: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  restoreAction: {
    width: 96,
    backgroundColor: Colors.primary,
  },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export function LibraryScreen() {
  const navigation = useNavigation<Nav>();
  const {
    episodes,
    load: loadEpisodes,
    remove: removeEpisode,
    restore: restoreEpisode,
    update: updateEpisode,
    permanentRemove,
    clearTrash,
  } = useEpisodes();
  const { folders, load: loadFolders, add: addFolder, update: updateFolder, remove: removeFolder } = useFolders();

  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');
  const [movingEpisode, setMovingEpisode] = useState<Episode | null>(null);
  const [pendingGenerations, setPendingGenerations] = useState<PendingGeneration[]>(() => generationStore.get());
  const [refreshing, setRefreshing] = useState(false);
  const openSwipeable = useRef<Swipeable | null>(null);

  // Load on mount and on every focus (covers returning from Player)
  useFocusEffect(
    useCallback(() => {
      loadEpisodes();
      loadFolders();
    }, [loadEpisodes, loadFolders]),
  );

  // Subscribe to generation store — shows pending indicator and triggers reload on completion
  useEffect(() => {
    let prev = generationStore.get().length;
    return generationStore.subscribe((pending) => {
      setPendingGenerations(pending);
      // A generation just finished (count dropped) — reload the episode list
      if (pending.length < prev) {
        loadEpisodes();
      }
      prev = pending.length;
    });
  }, [loadEpisodes]);

  // Also subscribe to episodeEvents as a fallback reload trigger
  useEffect(() => {
    return episodeEvents.subscribe(() => loadEpisodes());
  }, [loadEpisodes]);

  const filteredEpisodes = episodes.filter((e) => {
    if (selectedFolderId === 'all') return e.folderId !== TRASH_FOLDER_ID;
    return e.folderId === selectedFolderId;
  });

  const episodeCountFor = (folderId: string) => episodes.filter((e) => e.folderId === folderId).length;

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleEpisodePress = useCallback(async (episode: Episode) => {
    if (!episode.played) {
      await updateEpisode({ ...episode, played: true });
    }
    navigation.navigate('Player', { episode: { ...episode, played: true } });
  }, [navigation, updateEpisode]);

  const handleRenameEpisode = (episode: Episode) => {
    Alert.prompt(
      'Rename',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (name) => {
            if (name?.trim()) updateEpisode({ ...episode, title: name.trim() });
          },
        },
      ],
      'plain-text',
      episode.title,
    );
  };

  const handleDeleteEpisode = (episode: Episode) => {
    Alert.alert('Move to Trash', 'This audio will stay in Trash for 30 days and can be restored.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', style: 'destructive', onPress: () => removeEpisode(episode.id) },
    ]);
  };

  const handleRestoreEpisode = async (episode: Episode) => {
    await restoreEpisode(episode.id);
  };

  const handlePermanentDelete = (episode: Episode) => {
    Alert.alert('Delete Forever', 'This audio will be permanently deleted and cannot be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => permanentRemove(episode.id) },
    ]);
  };

  const handleEmptyTrash = () => {
    const count = episodes.filter((e) => e.folderId === TRASH_FOLDER_ID).length;
    if (count === 0) return;
    Alert.alert('Empty Trash', `Permanently delete all ${count} audio${count === 1 ? '' : 's'}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete All', style: 'destructive', onPress: () => clearTrash() },
    ]);
  };

  const onFolderLongPress = (folder: Folder) => {
    if (folder.id === TRASH_FOLDER_ID) return;
    const { ActionSheetIOS } = require('react-native');
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Rename', 'Delete'], destructiveButtonIndex: 2, cancelButtonIndex: 0 },
      (index: number) => {
        if (index === 1) {
          Alert.prompt(
            'Rename Folder',
            '',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Save',
                onPress: (name) => {
                  if (name?.trim()) updateFolder({ ...folder, name: name.trim() });
                },
              },
            ],
            'plain-text',
            folder.name,
          );
        }
        if (index === 2) {
          Alert.alert('Delete Folder', 'Episodes inside will be moved to All.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                removeFolder(folder.id);
                if (selectedFolderId === folder.id) setSelectedFolderId('all');
              },
            },
          ]);
        }
      },
    );
  };

  const onNewFolder = () => {
    Alert.prompt(
      'New Folder',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: (name) => {
            if (name?.trim()) {
              addFolder({
                id: generateId(),
                name: name.trim(),
                color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
                createdAt: Date.now(),
              });
            }
          },
        },
      ],
      'plain-text',
    );
  };

  const onMoveConfirm = async (folderId: string | undefined) => {
    if (!movingEpisode) return;
    await updateEpisode({ ...movingEpisode, folderId });
    setMovingEpisode(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        {selectedFolderId === TRASH_FOLDER_ID ? (
          <TouchableOpacity style={styles.deleteAllBtn} onPress={handleEmptyTrash} activeOpacity={0.8}>
            <Ionicons name="trash-outline" size={14} color={Colors.danger} />
            <Text style={styles.deleteAllText}>Delete All</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.newFolderBtn} onPress={onNewFolder} activeOpacity={0.8}>
            <Ionicons name="folder-open-outline" size={15} color={Colors.primary} />
            <Text style={styles.newFolderText}>New Folder</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Folder chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.folderRow}
      >
        <TouchableOpacity
          style={[styles.folderChip, selectedFolderId === 'all' && styles.folderChipActive]}
          onPress={() => setSelectedFolderId('all')}
          activeOpacity={0.8}
        >
          <View style={[styles.allFolderIconWrap, selectedFolderId === 'all' && styles.allFolderIconWrapActive]}>
            <Ionicons
              name="albums-outline"
              size={10}
              color={selectedFolderId === 'all' ? Colors.primary : Colors.textMuted}
            />
          </View>
          <Text style={[styles.folderChipText, selectedFolderId === 'all' && styles.folderChipTextActive]}>
            All
          </Text>
          <Text style={styles.folderChipCount}>{episodes.filter((e) => e.folderId !== TRASH_FOLDER_ID).length}</Text>
        </TouchableOpacity>

        {folders.map((folder) => (
          <TouchableOpacity
            key={folder.id}
            style={[
              styles.folderChip,
              selectedFolderId === folder.id && styles.folderChipActive,
              selectedFolderId === folder.id && { borderColor: folder.color + '66' },
            ]}
            onPress={() => setSelectedFolderId(folder.id)}
            onLongPress={() => onFolderLongPress(folder)}
            activeOpacity={0.8}
            delayLongPress={400}
          >
            {folder.id === TRASH_FOLDER_ID ? (
              <Ionicons
                name="trash-outline"
                size={12}
                color={selectedFolderId === folder.id ? Colors.danger : Colors.textMuted}
              />
            ) : (
              <View style={[styles.folderColorDot, { backgroundColor: folder.color }]} />
            )}
            <Text
              style={[
                styles.folderChipText,
                selectedFolderId === folder.id &&
                  (folder.id === TRASH_FOLDER_ID ? { color: Colors.danger } : { color: folder.color }),
              ]}
            >
              {folder.name}
            </Text>
            <Text style={styles.folderChipCount}>{episodeCountFor(folder.id)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Episode list */}
      <FlatList
        data={filteredEpisodes}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={
          pendingGenerations.length > 0 && selectedFolderId !== TRASH_FOLDER_ID ? (
            <View style={styles.generatingBanner}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.generatingText}>
                {pendingGenerations.length === 1
                  ? 'Generating audio…'
                  : `Generating ${pendingGenerations.length} audios…`}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <EpisodeRow
            item={item}
            folders={folders}
            navigation={navigation}
            isTrashView={selectedFolderId === TRASH_FOLDER_ID}
            openSwipeable={openSwipeable}
            onPress={handleEpisodePress}
            onRename={handleRenameEpisode}
            onMove={(ep) => setMovingEpisode(ep)}
            onDelete={handleDeleteEpisode}
            onRestore={handleRestoreEpisode}
            onPermanentDelete={handlePermanentDelete}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([loadEpisodes(), loadFolders()]);
              setRefreshing(false);
            }}
            tintColor="#60A5FA"
            colors={['#60A5FA']}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="headset-outline" size={48} color={Colors.textDim} />
            <Text style={styles.emptyTitle}>
              {selectedFolderId === 'all'
                ? 'No episodes yet'
                : selectedFolderId === TRASH_FOLDER_ID
                  ? 'Trash is empty'
                  : 'No episodes in this folder'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedFolderId === 'all'
                ? 'Head to Home to create your first episode'
                : selectedFolderId === TRASH_FOLDER_ID
                  ? 'Deleted audios stay here for 30 days'
                  : 'Swipe an episode to move it here'}
            </Text>
          </View>
        }
      />

      <MoveModal
        episode={movingEpisode}
        folders={folders}
        visible={movingEpisode !== null}
        onMove={onMoveConfirm}
        onDismiss={() => setMovingEpisode(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  deleteAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.danger + '15',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  deleteAllText: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  newFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  newFolderText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },

  folderRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    flexDirection: 'row',
  },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  folderChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary + '40',
  },
  folderColorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  allFolderIconWrap: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.border + '66',
  },
  allFolderIconWrapActive: {
    backgroundColor: Colors.primary + '22',
  },
  folderChipText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  folderChipTextActive: {
    color: Colors.primary,
  },
  folderChipCount: {
    color: Colors.textDim,
    fontSize: 10,
    fontWeight: '500',
  },

  listContent: { paddingBottom: 100 },
  generatingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  generatingText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },

  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  thumb: { width: 52, height: 52, borderRadius: Radius.sm },
  thumbPlaceholder: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeMeta: { flex: 1, gap: 4 },
  episodeTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600', lineHeight: 20 },
  episodeSubRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  modeBadge: { borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2 },
  badgePodcast: { backgroundColor: Colors.primary + '22' },
  badgeTts: { backgroundColor: Colors.accent + '22' },
  meta2: { color: Colors.textDim, fontSize: FontSize.xs },
  folderTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  folderDot: { width: 6, height: 6, borderRadius: 3 },
  folderTagText: { fontSize: 10, fontWeight: '600' },
  deletedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  deletedTagText: {
    color: Colors.danger,
    fontSize: 10,
    fontWeight: '600',
  },
  unplayedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },

  empty: { alignItems: 'center', gap: Spacing.sm, paddingTop: 60 },
  emptyTitle: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: '600' },
  emptySub: {
    color: Colors.textDim,
    fontSize: FontSize.sm,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
});
