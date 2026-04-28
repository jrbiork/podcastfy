import React, { useCallback, useState } from 'react';
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
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useEpisodes } from '../hooks/useEpisodes';
import { useFolders } from '../hooks/useFolders';
import { formatDuration, formatDateCompact, generateId } from '../utils/format';
import { Episode, Folder } from '../types';
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

        {folders.map((f) => (
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
  rowSelected: {
    backgroundColor: Colors.primary + '10',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export function LibraryScreen() {
  const navigation = useNavigation<Nav>();
  const { episodes, load: loadEpisodes, remove: removeEpisode, update: updateEpisode } = useEpisodes();
  const { folders, load: loadFolders, add: addFolder, update: updateFolder, remove: removeFolder } = useFolders();

  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');
  const [movingEpisode, setMovingEpisode] = useState<Episode | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadEpisodes();
      loadFolders();
    }, [loadEpisodes, loadFolders]),
  );

  const filteredEpisodes =
    selectedFolderId === 'all'
      ? episodes
      : episodes.filter((e) => e.folderId === selectedFolderId);

  const episodeCountFor = (folderId: string) =>
    episodes.filter((e) => e.folderId === folderId).length;

  // ── Actions ────────────────────────────────────────────────────────────────

  const onEpisodeLongPress = (episode: Episode) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Rename', 'Move to Folder', 'Delete'],
        destructiveButtonIndex: 3,
        cancelButtonIndex: 0,
        title: episode.title,
      },
      (index) => {
        if (index === 1) {
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
        }
        if (index === 2) setMovingEpisode(episode);
        if (index === 3) {
          Alert.alert('Delete Episode', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => removeEpisode(episode.id) },
          ]);
        }
      },
    );
  };

  const onFolderLongPress = (folder: Folder) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Rename', 'Delete'], destructiveButtonIndex: 2, cancelButtonIndex: 0 },
      (index) => {
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderEpisode = ({ item }: { item: Episode }) => {
    const folder = item.folderId ? folders.find((f) => f.id === item.folderId) : null;
    return (
      <TouchableOpacity
        style={styles.episodeRow}
        onPress={() => navigation.navigate('Player', { episode: item })}
        onLongPress={() => onEpisodeLongPress(item)}
        activeOpacity={0.8}
        delayLongPress={350}
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
              <Text style={styles.modeText}>{item.mode === 'podcast' ? '🎙' : '📖'}</Text>
            </View>
            <Text style={styles.episodeMeta2}>{formatDuration(item.durationSeconds)}</Text>
            <Text style={styles.episodeMeta2}>{formatDateCompact(item.createdAt)}</Text>
            {folder && (
              <View style={[styles.folderTag, { backgroundColor: folder.color + '22' }]}>
                <View style={[styles.folderDot, { backgroundColor: folder.color }]} />
                <Text style={[styles.folderTagText, { color: folder.color }]}>{folder.name}</Text>
              </View>
            )}
          </View>
        </View>
        {!item.played && <View style={styles.unplayedDot} />}
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => onEpisodeLongPress(item)}
          hitSlop={8}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textDim} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <TouchableOpacity style={styles.newFolderBtn} onPress={onNewFolder} activeOpacity={0.8}>
          <Ionicons name="folder-open-outline" size={16} color={Colors.primary} />
          <Text style={styles.newFolderText}>New Folder</Text>
        </TouchableOpacity>
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
          <Ionicons
            name="albums"
            size={14}
            color={selectedFolderId === 'all' ? Colors.primary : Colors.textMuted}
          />
          <Text style={[styles.folderChipText, selectedFolderId === 'all' && styles.folderChipTextActive]}>
            All
          </Text>
          <Text style={styles.folderChipCount}>{episodes.length}</Text>
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
            <View style={[styles.folderColorDot, { backgroundColor: folder.color }]} />
            <Text
              style={[
                styles.folderChipText,
                selectedFolderId === folder.id && { color: folder.color },
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
        renderItem={renderEpisode}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="headset-outline" size={48} color={Colors.textDim} />
            <Text style={styles.emptyTitle}>
              {selectedFolderId === 'all' ? 'No episodes yet' : 'No episodes in this folder'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedFolderId === 'all'
                ? 'Head to Home to create your first episode'
                : 'Long-press any episode to move it here'}
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
  newFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
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
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    flexDirection: 'row',
  },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  folderChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary + '40',
  },
  folderColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  folderChipText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  folderChipTextActive: {
    color: Colors.primary,
  },
  folderChipCount: {
    color: Colors.textDim,
    fontSize: 11,
    fontWeight: '500',
  },

  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },

  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
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
  modeText: { fontSize: 11 },
  episodeMeta2: { color: Colors.textDim, fontSize: FontSize.xs },
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
  unplayedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  moreBtn: {
    padding: 4,
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
