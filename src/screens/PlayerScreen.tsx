import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Image,
  GestureResponderEvent,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useEpisodes } from '../hooks/useEpisodes';
import { formatDuration } from '../utils/format';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Route = RouteProp<RootStackParamList, 'Player'>;
type Nav = StackNavigationProp<RootStackParamList, 'Player'>;

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function PlayerScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { update } = useEpisodes();

  const episode = params.episode;
  const [trackWidth, setTrackWidth] = useState(1);

  const { isPlaying, positionMs, durationMs, hasEnded, play, pause, seek, skip, restart } =
    useAudioPlayer(episode.uri);

  const totalMs = durationMs || episode.durationSeconds * 1000 || 1;
  const progress = Math.min(1, positionMs / totalMs);

  // Mark as played and save position on pause / leave
  const persistPosition = useCallback(
    async (ms: number) => {
      const played = ms > totalMs * 0.9 || episode.played;
      await update({ ...episode, positionMs: ms, played });
    },
    [episode, totalMs, update],
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        // Save position when navigating away
        persistPosition(positionMs);
      };
    }, [positionMs, persistPosition]),
  );

  // Auto-seek to saved position on first load
  const didSeekRef = useRef(false);
  useEffect(() => {
    if (didSeekRef.current || !durationMs) return;
    if (episode.positionMs && episode.positionMs > 0 && episode.positionMs < durationMs * 0.98) {
      didSeekRef.current = true;
      seek(episode.positionMs);
    }
  }, [durationMs, episode.positionMs, seek]);

  const handlePlayPress = useCallback(() => {
    if (hasEnded) { restart(); return; }
    if (isPlaying) { pause(); return; }
    play();
  }, [hasEnded, isPlaying, restart, pause, play]);

  const handleScrub = useCallback(
    (e: GestureResponderEvent) => {
      const fraction = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
      seek(fraction * totalMs);
    },
    [trackWidth, totalMs, seek],
  );

  const domain = sourceDomain(episode.sourceUrl);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {episode.title}
        </Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.content}>
        {/* Artwork */}
        <View style={styles.artworkWrap}>
          {episode.thumbnailUrl ? (
            <Image source={{ uri: episode.thumbnailUrl }} style={styles.artwork} />
          ) : (
            <View style={[styles.artwork, styles.artworkPlaceholder]}>
              <Ionicons name="headset" size={64} color={Colors.primary} />
            </View>
          )}
        </View>

        {/* Meta */}
        <View style={styles.meta}>
          <Text style={styles.episodeTitle} numberOfLines={2}>
            {episode.title}
          </Text>
          <View style={styles.metaRow}>
            {domain ? (
              <Text style={styles.domain} numberOfLines={1}>
                {domain}
              </Text>
            ) : null}
            <View style={[styles.modeBadge, episode.mode === 'podcast' ? styles.badgePodcast : styles.badgeTts]}>
              <Text style={styles.modeText}>{episode.mode === 'podcast' ? '🎙 Podcast' : '📖 TTS'}</Text>
            </View>
          </View>
        </View>

        {/* Scrubber */}
        <View style={styles.scrubberSection}>
          <View
            style={styles.scrubberTrack}
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrub}
            onResponderMove={handleScrub}
          >
            <View style={[styles.scrubberFill, { width: `${progress * 100}%` as `${number}%` }]} />
            <View style={[styles.scrubberThumb, { left: progress * Math.max(0, trackWidth - 16) }]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatDuration(Math.floor(positionMs / 1000))}</Text>
            <Text style={styles.timeText}>{formatDuration(Math.floor(totalMs / 1000))}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(-15000)} activeOpacity={0.7}>
            <Ionicons name="play-back-outline" size={20} color={Colors.textMuted} />
            <Text style={styles.skipText}>15</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.playBtn} onPress={handlePlayPress} activeOpacity={0.8}>
            <Ionicons
              name={isPlaying ? 'pause' : hasEnded ? 'refresh' : 'play'}
              size={32}
              color={Colors.bg}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={() => skip(30000)} activeOpacity={0.7}>
            <Ionicons name="play-forward-outline" size={20} color={Colors.textMuted} />
            <Text style={styles.skipText}>30</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 70,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  backText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  headerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    gap: Spacing.xl,
    alignItems: 'center',
  },
  artworkWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  artwork: {
    width: 240,
    height: 240,
    borderRadius: Radius.lg,
  },
  artworkPlaceholder: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  meta: { width: '100%', gap: Spacing.xs },
  episodeTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  domain: { color: Colors.textMuted, fontSize: FontSize.sm, flex: 1 },
  modeBadge: {
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePodcast: { backgroundColor: Colors.primary + '22' },
  badgeTts: { backgroundColor: Colors.accent + '22' },
  modeText: { fontSize: FontSize.xs, color: Colors.textMuted },
  scrubberSection: { width: '100%', gap: Spacing.xs },
  scrubberTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'visible',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  scrubberThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  timeText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    minHeight: 44,
  },
  skipText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  playBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
