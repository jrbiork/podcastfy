import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { FolderModal } from '../components/FolderModal';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
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

function formatFolderName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';

  return (
    normalized.charAt(0).toLocaleUpperCase() +
    normalized.slice(1).toLocaleLowerCase()
  );
}

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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={moveStyles.backdrop} onPress={onDismiss} />
      <View style={moveStyles.sheet}>
        <View style={moveStyles.handle} />
        <Text style={moveStyles.title}>Move to Folder</Text>

        <TouchableOpacity
          style={[moveStyles.row, !episode.folderId && moveStyles.rowSelected]}
          onPress={() => onMove(undefined)}
          activeOpacity={0.7}
        >
          <View style={[moveStyles.iconWrap, { backgroundColor: Colors.textDim + '22', borderColor: Colors.textDim + '44' }]}>
            <Ionicons name="albums-outline" size={14} color={Colors.textDim} />
          </View>
          <Text style={moveStyles.rowLabel}>No Folder</Text>
          {!episode.folderId && (
            <Ionicons name="checkmark" size={18} color={Colors.primary} />
          )}
        </TouchableOpacity>

        {folders
          .filter((f) => f.id !== TRASH_FOLDER_ID)
          .map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[
                moveStyles.row,
                episode.folderId === f.id && moveStyles.rowSelected,
              ]}
              onPress={() => onMove(f.id)}
              activeOpacity={0.7}
            >
              <View style={[moveStyles.iconWrap, { backgroundColor: f.color + '22', borderColor: f.color + '55' }]}>
                <Ionicons
                  name={(f.iconName ?? 'folder-outline') as any}
                  size={14}
                  color={f.color}
                />
              </View>
              <Text style={moveStyles.rowLabel}>
                {formatFolderName(f.name)}
              </Text>
              {episode.folderId === f.id && (
                <Ionicons name="checkmark" size={18} color={Colors.primary} />
              )}
            </TouchableOpacity>
          ))}
      </View>
    </Modal>
  );
}

const moveStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
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
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
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
  const folderColor = item.folderId && item.folderId !== TRASH_FOLDER_ID
    ? folders.find((f) => f.id === item.folderId)?.color
    : undefined;

  const close = () => swipeRef.current?.close();

  const renderRightActions = () =>
    isTrashView ? (
      <View style={swipeStyles.row}>
        <TouchableOpacity
          style={[swipeStyles.action, swipeStyles.restoreAction]}
          onPress={() => {
            close();
            onRestore(item);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={swipeStyles.actionLabel}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[swipeStyles.action, { backgroundColor: Colors.danger }]}
          onPress={() => {
            close();
            onPermanentDelete(item);
          }}
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
    );

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => {
        if (
          openSwipeable.current &&
          openSwipeable.current !== swipeRef.current
        ) {
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
        {folderColor && (
          <View style={[styles.folderPip, { backgroundColor: folderColor }]} />
        )}
        <View style={styles.thumbWrap}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="headset" size={22} color={Colors.primary} />
            </View>
          )}
          <View style={styles.thumbBadges}>
            {item.sourceType === 'pdf' && (
              <View style={styles.pdfTagOnThumb}>
                <Ionicons
                  name="document-outline"
                  size={9}
                  color={Colors.primary}
                />
                <Text style={styles.pdfTagTextOnThumb}>PDF</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.episodeMeta}>
          <Text style={styles.episodeTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.episodeSubRow}>
            <View
              style={[
                styles.modeBadge,
                item.mode === 'podcast' ? styles.badgePodcast : styles.badgeTts,
              ]}
            >
              <Ionicons
                name={item.mode === 'podcast' ? 'mic' : 'document-text'}
                size={11}
                color={item.mode === 'podcast' ? Colors.primary : Colors.accent}
              />
            </View>
            <Text style={styles.metaDate}>
              {formatDateCompact(item.createdAt)}
            </Text>
            <View style={styles.trailingMeta}>
              <View style={styles.durationWrap}>
                <Ionicons
                  name="time-outline"
                  size={12}
                  color={Colors.primary}
                />
                <Text style={styles.meta2}>
                  {formatDuration(item.durationSeconds)}
                </Text>
              </View>
              {!item.played && !isTrashView && (
                <View style={styles.unplayedDot} />
              )}
            </View>
          </View>
        </View>
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
  const {
    folders,
    load: loadFolders,
    add: addFolder,
    update: updateFolder,
    remove: removeFolder,
  } = useFolders();

  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>(
    'all',
  );
  const [movingEpisode, setMovingEpisode] = useState<Episode | null>(null);
  const [pendingGenerations, setPendingGenerations] = useState<
    PendingGeneration[]
  >(() => generationStore.get());
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const openSwipeable = useRef<Swipeable | null>(null);
  const listRef = useRef<FlatList<Episode>>(null);

  // Load on mount and on every focus (covers returning from Player)
  useFocusEffect(
    useCallback(() => {
      loadEpisodes();
      loadFolders();
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
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
  const sortedEpisodes = useMemo(
    () => [...filteredEpisodes].sort((a, b) => b.createdAt - a.createdAt),
    [filteredEpisodes],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedFolderId, filteredEpisodes.length]);

  const episodeCountFor = (folderId: string) =>
    episodes.filter((e) => e.folderId === folderId).length;

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleEpisodePress = useCallback(
    async (episode: Episode) => {
      if (!episode.played) {
        await updateEpisode({ ...episode, played: true });
      }
      navigation.navigate('Player', { episode: { ...episode, played: true } });
    },
    [navigation, updateEpisode],
  );

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
    Alert.alert(
      'Move to Trash',
      'This audio will stay in Trash for 30 days and can be restored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          style: 'destructive',
          onPress: () => removeEpisode(episode.id),
        },
      ],
    );
  };

  const handleRestoreEpisode = async (episode: Episode) => {
    await restoreEpisode(episode.id);
  };

  const handlePermanentDelete = (episode: Episode) => {
    Alert.alert(
      'Delete Forever',
      'This audio will be permanently deleted and cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => permanentRemove(episode.id),
        },
      ],
    );
  };

  const handleEmptyTrash = () => {
    const count = episodes.filter((e) => e.folderId === TRASH_FOLDER_ID).length;
    if (count === 0) return;
    Alert.alert(
      'Empty Trash',
      `Permanently delete all ${count} audio${count === 1 ? '' : 's'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => clearTrash(),
        },
      ],
    );
  };

  const handleFolderSave = ({ name, color, iconName }: Pick<Folder, 'name' | 'color' | 'iconName'>) => {
    const normalized = formatFolderName(name);
    if (!normalized) return;

    if (editingFolder) {
      updateFolder({ ...editingFolder, name: normalized, color, iconName });
    } else {
      addFolder({ id: generateId(), name: normalized, color, iconName, createdAt: Date.now() });
    }
    setEditingFolder(undefined);
  };

  const onFolderLongPress = (folder: Folder) => {
    if (folder.id === TRASH_FOLDER_ID) return;
    const { ActionSheetIOS } = require('react-native');
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Edit', 'Delete'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 0,
      },
      (index: number) => {
        if (index === 1) {
          setEditingFolder(folder);
          setFolderModalVisible(true);
        }
        if (index === 2) {
          Alert.alert(
            'Delete Folder',
            'Episodes inside will be moved to All.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  removeFolder(folder.id);
                  if (selectedFolderId === folder.id)
                    setSelectedFolderId('all');
                },
              },
            ],
          );
        }
      },
    );
  };

  const onNewFolder = () => {
    setEditingFolder(undefined);
    setFolderModalVisible(true);
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
          <TouchableOpacity
            style={styles.deleteAllBtn}
            onPress={handleEmptyTrash}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={14} color={Colors.danger} />
            <Text style={styles.deleteAllText}>Delete All</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.newFolderBtn}
            onPress={onNewFolder}
            activeOpacity={0.8}
          >
            <Ionicons
              name="folder-open-outline"
              size={15}
              color={Colors.primary}
            />
            <Text style={styles.newFolderText}>New Folder</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Folder chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.folderCarousel}
        contentContainerStyle={styles.folderRow}
      >
        <TouchableOpacity
          style={[
            styles.folderChip,
            selectedFolderId === 'all' && styles.folderChipActive,
          ]}
          onPress={() => setSelectedFolderId('all')}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.allFolderIconWrap,
              selectedFolderId === 'all' && styles.allFolderIconWrapActive,
            ]}
          >
            <Ionicons
              name="albums-outline"
              size={10}
              color={
                selectedFolderId === 'all' ? Colors.primary : Colors.textMuted
              }
            />
          </View>
          <Text
            style={[
              styles.folderChipText,
              selectedFolderId === 'all' && styles.folderChipTextActive,
            ]}
          >
            All
          </Text>
          <Text style={styles.folderChipCount}>
            {episodes.filter((e) => e.folderId !== TRASH_FOLDER_ID).length}
          </Text>
        </TouchableOpacity>

        {folders.map((folder) => (
          <TouchableOpacity
            key={folder.id}
            style={[
              styles.folderChip,
              selectedFolderId === folder.id && styles.folderChipActive,
              selectedFolderId === folder.id && {
                borderColor: folder.color + '66',
              },
            ]}
            onPress={() => setSelectedFolderId(folder.id)}
            onLongPress={() => onFolderLongPress(folder)}
            activeOpacity={0.8}
            delayLongPress={400}
          >
            <Ionicons
              name={(folder.iconName ?? (folder.id === TRASH_FOLDER_ID ? 'trash-outline' : 'folder-outline')) as any}
              size={12}
              color={
                selectedFolderId === folder.id
                  ? folder.id === TRASH_FOLDER_ID
                    ? Colors.danger
                    : folder.color
                  : Colors.textMuted
              }
            />
            <Text
              style={[
                styles.folderChipText,
                selectedFolderId === folder.id &&
                  (folder.id === TRASH_FOLDER_ID
                    ? { color: Colors.danger }
                    : { color: folder.color }),
              ]}
            >
              {formatFolderName(folder.name)}
            </Text>
            <Text style={styles.folderChipCount}>
              {episodeCountFor(folder.id)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Episode list */}
      <FlatList
        ref={listRef}
        data={sortedEpisodes}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={
          pendingGenerations.length > 0 &&
          selectedFolderId !== TRASH_FOLDER_ID ? (
            <View style={styles.generatingBanner}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.generatingText}>
                {pendingGenerations.length === 1
                  ? 'Generating audio — this may take a couple of minutes.'
                  : `Generating ${pendingGenerations.length} audios — this may take a couple of minutes.`}
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
                ? 'No audios yet'
                : selectedFolderId === TRASH_FOLDER_ID
                  ? 'Trash is empty'
                  : 'No audios in this folder'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedFolderId === 'all'
                ? 'Head to Home to create your first audio'
                : selectedFolderId === TRASH_FOLDER_ID
                  ? 'Deleted audios stay here for 30 days'
                  : 'Move an audio here or create a new one from Home'}
            </Text>
            {selectedFolderId !== TRASH_FOLDER_ID ? (
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.reset({
                      index: 0,
                      routes: [
                        {
                          name: 'Main',
                          state: {
                            index: 0,
                            routes: [{ name: 'HomeTab' }, { name: 'LibraryTab' }, { name: 'ProfileTab' }],
                          },
                        },
                      ],
                    }),
                  )
                }
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.bg} />
                <Text style={styles.emptyCtaText}>Create Audio</Text>
              </TouchableOpacity>
            ) : null}
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

      <FolderModal
        visible={folderModalVisible}
        folder={editingFolder}
        onSave={handleFolderSave}
        onClose={() => { setFolderModalVisible(false); setEditingFolder(undefined); }}
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
    paddingVertical: 8,
    gap: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  folderCarousel: {
    flexGrow: 0,
    height: 60,
  },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 44,
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
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.8,
  },
  folderChipTextActive: {
    color: Colors.primary,
    opacity: 1,
  },
  folderChipCount: {
    color: Colors.text,
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.7,
  },

  listContent: {
    justifyContent: 'flex-start',
    paddingTop: Spacing.xs,
    paddingBottom: 100,
  },
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
    flex: 1,
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
    paddingRight: Spacing.md,
  },

  folderPip: {
    position: 'absolute',
    left: 6,
    width: 2,
    height: 20,
    borderRadius: 1,
    opacity: 0.7,
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
  thumbWrap: { position: 'relative' },
  thumbBadges: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    alignItems: 'flex-end',
    gap: 4,
  },
  thumb: { width: 64, height: 64, borderRadius: Radius.sm },
  thumbPlaceholder: {
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeMeta: { flex: 1, gap: 4 },
  episodeTitle: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 20,
  },
  episodeSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  trailingMeta: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  durationWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 16 },
  modeBadge: {
    borderRadius: Radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgePodcast: { backgroundColor: Colors.primary + '22' },
  badgeTts: { backgroundColor: Colors.accent + '22' },
  meta2: { color: Colors.text, fontSize: FontSize.xs, fontWeight: '500', opacity: 0.75 },
  metaDate: {
    color: Colors.text,
    fontSize: FontSize.xs,
    fontWeight: '500',
    opacity: 0.75,
    textAlign: 'center',
    lineHeight: 16,
  },
  pdfTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '18',
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pdfTagText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
  folderTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pdfTagOnThumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
  },
  pdfTagTextOnThumb: { color: Colors.primary, fontSize: 9, fontWeight: '700' },
  unplayedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },

  empty: { alignItems: 'center', gap: Spacing.sm, paddingTop: 60 },
  emptyTitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  emptySub: {
    color: Colors.textDim,
    fontSize: FontSize.sm,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
  emptyCta: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 11,
    paddingHorizontal: Spacing.lg,
  },
  emptyCtaText: {
    color: Colors.bg,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});
