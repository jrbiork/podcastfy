import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useEpisodes } from '../hooks/useEpisodes';
import { useIncomingShare } from '../hooks/useIncomingShare';
import { getTotalGeneratedSeconds, FREE_LIMIT_SECONDS } from '../services/subscription';
import { formatDuration, formatDateCompact } from '../utils/format';
import { Episode, GenerationInput } from '../types';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Nav = StackNavigationProp<RootStackParamList>;
type InputTab = 'url' | 'text';

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { episodes, loading, load, remove } = useEpisodes();

  const [tab, setTab] = useState<InputTab>('url');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState(
    'This is a dummy test article for QA flows. It contains more than one hundred characters so the paste text input passes the minimum length validation during testing.'
  );
  const [clipboardBanner, setClipboardBanner] = useState<string | null>(null);
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [cfBanner, setCfBanner] = useState(false);
  const urlInputRef = useRef<TextInput>(null);

  useEffect(() => {
    load();
    getTotalGeneratedSeconds().then(setUsedSeconds);
  }, [load]);

  // Handle incoming share URL (deep link from share extension)
  useIncomingShare((url) => {
    setTab('url');
    setUrlInput(url);
    setClipboardBanner(null);
  });

  // Expose CF banner setter via navigation params so GeneratingScreen can trigger it
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      getTotalGeneratedSeconds().then(setUsedSeconds);
    });
    return unsubscribe;
  }, [navigation]);

  const onUrlFocus = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && isValidUrl(text) && text !== urlInput) {
        setClipboardBanner(text);
      }
    } catch {
      /* clipboard access may be denied */
    }
  };

  const onNext = () => {
    const input = buildInput();
    if (!input) return;
    navigation.navigate('ModePicker', { input });
  };

  const buildInput = (): GenerationInput | null => {
    if (tab === 'url') {
      const url = urlInput.trim();
      if (!url) { Alert.alert('Enter a URL'); return null; }
      if (!isValidUrl(url)) { Alert.alert('Invalid URL', 'Please enter a valid URL.'); return null; }
      return { type: 'url', url };
    } else {
      const text = textInput.trim();
      if (text.length < 100) { Alert.alert('Too short', 'Paste at least 100 characters of article text.'); return null; }
      return { type: 'text', text };
    }
  };

  const usedMinutes = Math.floor(usedSeconds / 60);
  const totalMinutes = FREE_LIMIT_SECONDS / 60;
  const usedPercent = Math.min(1, usedSeconds / FREE_LIMIT_SECONDS);

  const renderEpisode = ({ item }: { item: Episode }) => (
    <TouchableOpacity
      style={styles.episodeRow}
      onPress={() => navigation.navigate('Player', { episode: item })}
      activeOpacity={0.8}
    >
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
      ) : (
        <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
          <Ionicons name="headset" size={24} color={Colors.primary} />
        </View>
      )}
      <View style={styles.episodeMeta}>
        <Text style={styles.episodeTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.episodeSubRow}>
          <View style={[styles.modeBadge, item.mode === 'podcast' ? styles.badgePodcast : styles.badgeTts]}>
            <Text style={styles.modeText}>{item.mode === 'podcast' ? '🎙 Podcast' : '📖 Read'}</Text>
          </View>
          <Text style={styles.episodeDuration}>{formatDuration(item.durationSeconds)}</Text>
          <Text style={styles.episodeDate}>{formatDateCompact(item.createdAt)}</Text>
        </View>
      </View>
      {!item.played && <View style={styles.unplayedDot} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {cfBanner && (
        <View style={styles.cfBanner}>
          <Ionicons name="shield-outline" size={16} color={Colors.danger} />
          <Text style={styles.cfBannerText}>
            This site uses bot protection. Paste the article text instead.
          </Text>
          <TouchableOpacity onPress={() => { setCfBanner(false); setTab('text'); }}>
            <Text style={styles.cfBannerAction}>Switch</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.appTitle}>Podcastify</Text>
        <View style={styles.usageBarWrap}>
          <Text style={styles.usageLabel}>{usedMinutes} / {totalMinutes} min free</Text>
          <View style={styles.usageBar}>
            <View style={[styles.usageFill, { width: `${usedPercent * 100}%` as `${number}%` }]} />
          </View>
        </View>
      </View>

      {/* Input tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'url' && styles.tabActive]}
          onPress={() => setTab('url')}
        >
          <Ionicons name="link" size={16} color={tab === 'url' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.tabText, tab === 'url' && styles.tabTextActive]}>URL</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'text' && styles.tabActive]}
          onPress={() => setTab('text')}
        >
          <Ionicons name="clipboard" size={16} color={tab === 'text' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.tabText, tab === 'text' && styles.tabTextActive]}>Paste Text</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputArea}>
        {tab === 'url' ? (
          <>
            <TextInput
              ref={urlInputRef}
              style={styles.urlInput}
              value={urlInput}
              onChangeText={(v) => { setUrlInput(v); setClipboardBanner(null); }}
              onFocus={onUrlFocus}
              placeholder="https://example.com/article"
              placeholderTextColor={Colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
            />
            {clipboardBanner && (
              <TouchableOpacity
                style={styles.clipboardBanner}
                onPress={() => { setUrlInput(clipboardBanner); setClipboardBanner(null); }}
              >
                <Ionicons name="clipboard-outline" size={14} color={Colors.primary} />
                <Text style={styles.clipboardText} numberOfLines={1}>
                  Paste from clipboard: {clipboardBanner}
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <TextInput
              style={styles.textInput}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Paste article text here…"
              placeholderTextColor={Colors.textDim}
              multiline
              textAlignVertical="top"
              maxLength={14000}
            />
            <Text style={styles.charCount}>{textInput.length.toLocaleString()} / 14,000</Text>
          </>
        )}

        <TouchableOpacity style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={styles.nextBtnText}>Next</Text>
          <Ionicons name="chevron-forward" size={20} color={Colors.bg} />
        </TouchableOpacity>
      </View>

      {/* Episodes list */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(e) => e.id}
          renderItem={renderEpisode}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            episodes.length > 0 ? <Text style={styles.listHeader}>Episodes</Text> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="headset-outline" size={48} color={Colors.textDim} />
              <Text style={styles.emptyText}>No episodes yet</Text>
              <Text style={styles.emptySubtext}>Paste a URL or article text above to get started</Text>
            </View>
          }
          onLongPress={undefined}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  cfBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.danger + '22',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  cfBannerText: { flex: 1, color: Colors.danger, fontSize: FontSize.xs },
  cfBannerAction: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
  header: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  appTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700', marginBottom: Spacing.xs },
  usageBarWrap: { gap: 4 },
  usageLabel: { color: Colors.textMuted, fontSize: FontSize.xs },
  usageBar: { height: 3, backgroundColor: Colors.border, borderRadius: 2 },
  usageFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  tabActive: { backgroundColor: Colors.surfaceElevated },
  tabText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '500' },
  tabTextActive: { color: Colors.primary },
  inputArea: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
  urlInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: FontSize.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  clipboardText: { flex: 1, color: Colors.primary, fontSize: FontSize.xs },
  textInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: FontSize.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    height: 130,
  },
  charCount: { color: Colors.textDim, fontSize: FontSize.xs, textAlign: 'right' },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
  },
  nextBtnText: { color: Colors.bg, fontSize: FontSize.md, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl },
  listHeader: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  thumbnail: { width: 56, height: 56, borderRadius: Radius.sm },
  thumbnailPlaceholder: {
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeMeta: { flex: 1, gap: 4 },
  episodeTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
  episodeSubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modeBadge: { borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  badgePodcast: { backgroundColor: Colors.primary + '22' },
  badgeTts: { backgroundColor: Colors.accent + '22' },
  modeText: { fontSize: 10, color: Colors.textMuted },
  episodeDuration: { color: Colors.textMuted, fontSize: FontSize.xs },
  episodeDate: { color: Colors.textDim, fontSize: FontSize.xs },
  unplayedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xxl },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: '600' },
  emptySubtext: { color: Colors.textDim, fontSize: FontSize.sm, textAlign: 'center', maxWidth: 260 },
});
