import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Image,
  Modal,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '../utils/theme';
import { Episode, DigestStory } from '../types';
import { getOrCreateTodayDigest, DigestProgress } from '../services/digestService';
import { recordFirstDigestUse, getDigestTrialState } from '../services/subscription';
import { navigateToPaywall } from '../navigation/rootNavigationRef';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { formatDuration } from '../utils/format';
import type { RootStackParamList } from '../navigation/rootNavigationRef';
import { feedImageUrl } from '../services/rssService';
import type { RssFeed, ExtendedRssItem } from '../services/rssService';

type Nav = StackNavigationProp<RootStackParamList>;
type Phase = 'loading' | 'generating' | 'ready' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROGRESS_STEPS = [
  { key: 'fetching_feeds', label: 'Fetching news' },
  { key: 'ranking_summarizing', label: 'Reading stories' },
  { key: 'scripting', label: 'Summarizing content' },
  { key: 'generating_audio', label: 'Generating audio' },
];

function statusToStepIndex(status: string): number {
  if (status === 'fetching_feeds') return 0;
  if (status === 'ranking' || status === 'summarizing') return 1;
  if (status === 'scripting') return 2;
  if (status === 'generating_audio') return 3;
  return 0;
}

// Source badge colors — deterministic from feed name
const BADGE_COLORS = [
  '#2D5A27',
  '#8B2635',
  '#1B3A5C',
  '#4A3728',
  '#3D2B5A',
  '#1A4D2E',
  '#5A3A1A',
  '#2B3A5A',
];

function groupByTopic(stories: DigestStory[]): { label: string | undefined; stories: DigestStory[] }[] {
  const groups: { label: string | undefined; stories: DigestStory[] }[] = [];
  for (const story of stories) {
    const last = groups[groups.length - 1];
    if (last && last.label === story.topicLabel) {
      last.stories.push(story);
    } else {
      groups.push({ label: story.topicLabel, stories: [story] });
    }
  }
  return groups;
}

function getBadgeColor(feedName: string): string {
  let hash = 0;
  for (const c of feedName) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
}

function getAbbrev(feedName: string): string {
  return feedName.replace(/^The /, '').slice(0, 3).toUpperCase();
}

// ── Feed badge (favicon with colored-abbrev fallback) ─────────────────────────

function FeedBadge({
  name,
  link,
  size = 36,
}: {
  name: string;
  link?: string;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const faviconUrl = useMemo(() => (link ? feedImageUrl(link) : ''), [link]);

  return (
    <View
      style={[
        styles.sourceBadge,
        { width: size, height: size, backgroundColor: getBadgeColor(name) },
      ]}
    >
      {faviconUrl && !imgFailed ? (
        <Image
          source={{ uri: faviconUrl }}
          style={{ width: size * 0.62, height: size * 0.62, borderRadius: 3 }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Text style={[styles.sourceBadgeText, { fontSize: size * 0.28 }]}>
          {getAbbrev(name)}
        </Text>
      )}
    </View>
  );
}

// ── Story row ─────────────────────────────────────────────────────────────────

function StoryRow({
  story,
  onPress,
}: {
  story: DigestStory;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.storyRow}
      activeOpacity={0.75}
      onPress={onPress}
    >
      <FeedBadge name={story.feedName} link={story.link} size={44} />
      <View style={styles.storyMeta}>
        <Text style={styles.storySource}>{story.feedName.toUpperCase()}</Text>
        <Text style={styles.storyTitle} numberOfLines={2}>
          {story.title}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textDim} />
    </TouchableOpacity>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.actionBtn}
      activeOpacity={0.75}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={Colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function DigestScreen() {
  const navigation = useNavigation<Nav>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState<DigestProgress | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [speed, setSpeed] = useState<0.5 | 0.75 | 1 | 1.5 | 2>(1);
  const SPEEDS: (0.5 | 0.75 | 1 | 1.5 | 2)[] = [0.5, 0.75, 1, 1.5, 2];
  const [scrubPositionMs, setScrubPositionMs] = useState<number | null>(null);
  const [showSoftPaywall, setShowSoftPaywall] = useState(false);

  // Always call hooks at top level
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const {
    isPlaying,
    positionMs,
    durationMs,
    hasEnded,
    play,
    pause,
    skip,
    seek,
    restart,
    setRate,
  } = useAudioPlayer(
    episode?.uri ?? null,
    episode
      ? { title: episode.title, durationSeconds: episode.durationSeconds }
      : undefined,
  );

  // Match PlayerScreen: clear scrub override once playback catches up
  useEffect(() => {
    if (scrubPositionMs === null) return;
    if (Math.abs(positionMs - scrubPositionMs) < 1500) {
      setScrubPositionMs(null);
    }
  }, [positionMs, scrubPositionMs]);

  // Record first digest use when ready (idempotent)
  useEffect(() => {
    if (phase === 'ready') void recordFirstDigestUse();
  }, [phase]);

  // Spinner: one continuous loop while digest is in progress. Do not key on `phase`
  // alone — it goes `loading` → `generating` on first progress tick, which would
  // restart the animation and look like a reset every step.
  const digestInProgress = phase === 'loading' || phase === 'generating';
  useEffect(() => {
    if (!digestInProgress) {
      spinLoop.current?.stop();
      spinLoop.current = null;
      spinAnim.setValue(0);
      return;
    }

    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.current = loop;
    loop.start();

    return () => {
      loop.stop();
    };
  }, [digestInProgress]);

  // Fetch / generate digest on mount and retry
  useEffect(() => {
    let cancelled = false;

    // Errors that should never auto-retry — user must act
    const PERMANENT_ERRORS = new Set(['auth_expired', 'not_signed_in', 'timeout']);
    // Max silent auto-retries before showing the error screen
    const MAX_AUTO_RETRIES = 2;

    const ERROR_LABELS: Record<string, string> = {
      timeout: 'Generation timed out. Tap to try again.',
      auth_expired: 'Session expired. Please sign in again.',
      not_signed_in: "You're not signed in.",
      network_error: "Can't reach the server. Check your connection.",
    };

    setPhase('loading');
    setProgress(null);
    setEpisode(null);
    setErrorMsg(null);

    const attempt = async (retriesLeft: number) => {
      try {
        const ep = await getOrCreateTodayDigest((p) => {
          if (cancelled) return;
          setProgress(p);
          setPhase('generating');
        });
        if (cancelled) return;
        setEpisode(ep);
        setPhase('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        const code =
          (err as { code?: string }).code ??
          (err as Error).message ??
          'unknown';

        // For transient errors with retries remaining, wait 5 s and silently retry
        if (!PERMANENT_ERRORS.has(code) && retriesLeft > 0) {
          setPhase('loading');
          await new Promise<void>((res) => setTimeout(res, 5_000));
          if (!cancelled) attempt(retriesLeft - 1);
          return;
        }

        setErrorMsg(ERROR_LABELS[code] ?? 'Something went wrong. Tap to try again.');
        setPhase('error');
      }
    };

    attempt(MAX_AUTO_RETRIES);

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const stepIndex = progress ? statusToStepIndex(progress.status) : 0;

  const totalMs = durationMs || (episode?.durationSeconds ?? 0) * 1000 || 1;

  const handleSpeedPress = useCallback(async () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    await setRate(next);
  }, [speed, setRate]);

  const handlePlayPress = useCallback(async () => {
    const state = await getDigestTrialState();
    if (state === 'hard') { navigateToPaywall(); return; }
    if (state === 'soft') { setShowSoftPaywall(true); return; }
    if (hasEnded) { void restart(); return; }
    if (isPlaying) { void pause(); return; }
    void play();
  }, [hasEnded, isPlaying, restart, pause, play]);

  const handleSoftPaywallSubscribe = useCallback(() => {
    setShowSoftPaywall(false);
    navigateToPaywall();
  }, []);

  const handleSoftPaywallContinue = useCallback(() => {
    setShowSoftPaywall(false);
    if (hasEnded) void restart();
    else void play();
  }, [hasEnded, restart, play]);

  const handleStoryPress = useCallback(
    (story: DigestStory) => {
      const preview = story.summary?.trim();
      const item: ExtendedRssItem = {
        title: story.title,
        link: story.link,
        guid: story.link,
        ...(preview
          ? { description: preview, fullDescription: preview }
          : {}),
      };
      const feed: RssFeed = {
        id: story.feedId,
        name: story.feedName,
        url: '',
        category: 'news',
      };
      navigation.navigate('ArticleDetail', { item, feed });
    },
    [navigation],
  );

  const dateLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  const stories = episode?.stories ?? [];
  const uniqueFeeds = [...new Map(stories.map((s) => [s.feedId, s])).values()];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── App header ── */}
        <Text style={styles.appTitle}>Sonera</Text>
        <Text style={styles.appSubtitle}>Your daily audio digest</Text>

        {/* ── Player card (ready phase) ── */}
        {phase === 'ready' && episode && (
          <View style={styles.playerCard}>
            {/* Status row */}
            <View style={styles.statusRow}>
              <View style={styles.readyBadge}>
                <View style={styles.readyDot} />
                <Text style={styles.readyText}>READY TO PLAY</Text>
              </View>
              <Text style={styles.metaText}>
                {dateLabel} · {stories.length}{' '}
                {stories.length === 1 ? 'story' : 'stories'} ·{' '}
                {formatDuration(episode.durationSeconds)}
              </Text>
            </View>

            {/* Source chips — avatar stack + label */}
            {uniqueFeeds.length > 0 && (
              <View style={styles.sourcesRow}>
                <View style={styles.badgeStack}>
                  {uniqueFeeds.slice(0, 5).map((s, i) => (
                    <View
                      key={s.feedId}
                      style={[
                        styles.stackItem,
                        i > 0 && { marginLeft: -9 },
                        { zIndex: uniqueFeeds.length - i },
                      ]}
                    >
                      <FeedBadge name={s.feedName} link={s.link} size={26} />
                    </View>
                  ))}
                </View>
                <Text style={styles.sourcesLabel} numberOfLines={1}>
                  {uniqueFeeds
                    .slice(0, 2)
                    .map((s) => s.feedName)
                    .join(' · ')}
                  {uniqueFeeds.length > 2 ? ` +${uniqueFeeds.length - 2}` : ''}
                </Text>
              </View>
            )}

            {/* Scrubber (same as PlayerScreen) */}
            <View style={styles.scrubberSection}>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={totalMs}
                value={scrubPositionMs ?? positionMs}
                tapToSeek
                minimumTrackTintColor={Colors.primary}
                maximumTrackTintColor={Colors.border}
                thumbTintColor={Colors.primary}
                onValueChange={(v) => setScrubPositionMs(v)}
                onSlidingComplete={(v) => {
                  seek(v);
                  setScrubPositionMs(v);
                }}
              />
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>
                  {formatDuration(
                    Math.floor((scrubPositionMs ?? positionMs) / 1000),
                  )}
                </Text>
                <Text style={styles.timeText}>
                  {formatDuration(Math.floor(totalMs / 1000))}
                </Text>
              </View>
            </View>

            {/* Controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => skip(-15_000)}
              >
                <Ionicons name="play-back" size={18} color={Colors.text} />
                <Text style={styles.skipLabel}>15</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.playBtn}
                activeOpacity={0.85}
                onPress={handlePlayPress}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : hasEnded ? 'refresh' : 'play'}
                  size={22}
                  color="#fff"
                />
                <Text style={styles.playBtnText}>
                  {isPlaying
                    ? 'Pause'
                    : hasEnded
                      ? 'Play again'
                      : 'Play Digest'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => skip(15_000)}
              >
                <Ionicons name="play-forward" size={18} color={Colors.text} />
                <Text style={styles.skipLabel}>15</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.speedBtn}
                onPress={handleSpeedPress}
              >
                <Text style={styles.speedText}>
                  {speed === 1 ? '1×' : `${speed}×`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Generating progress (loading / generating phases) ── */}
        {(phase === 'loading' || phase === 'generating') && (
          <View style={styles.generatingCard}>
            <Text style={styles.generatingTitle}>Preparing your briefing…</Text>
            <View style={styles.progressSteps}>
              {PROGRESS_STEPS.map((step, i) => {
                const isDone = stepIndex > i;
                const isActive = stepIndex === i;
                return (
                  <View key={step.key} style={styles.stepRow}>
                    {isDone ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={Colors.success}
                      />
                    ) : isActive ? (
                      <Animated.View style={{ transform: [{ rotate: spin }] }}>
                        <Ionicons
                          name="sync"
                          size={20}
                          color={Colors.primary}
                        />
                      </Animated.View>
                    ) : (
                      <Ionicons
                        name="ellipse-outline"
                        size={20}
                        color={Colors.textDim}
                      />
                    )}
                    <Text
                      style={[
                        styles.stepLabel,
                        isDone && styles.stepDone,
                        isActive && styles.stepActive,
                      ]}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <View style={styles.errorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={40}
              color={Colors.danger}
            />
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              activeOpacity={0.8}
              onPress={() => setRetryKey((k) => k + 1)}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Stories list ── */}
        {stories.length > 0 && (
          <View style={styles.storiesSection}>
            <View style={styles.storiesHeader}>
              <Text style={styles.storiesTitle}>IN TODAY'S DIGEST</Text>
              <Text style={styles.allStoriesLink}>All stories</Text>
            </View>

            {groupByTopic(stories).map((group, gIdx, arr) => (
              <View key={gIdx}>
                <Text style={styles.categoryLabel}>
                  {(group.label ?? 'General').toUpperCase()}
                </Text>
                {group.stories.map((story, sIdx) => (
                  <React.Fragment key={story.link + sIdx}>
                    <StoryRow
                      story={story}
                      onPress={() => handleStoryPress(story)}
                    />
                    {sIdx < group.stories.length - 1 && <View style={styles.storyDivider} />}
                  </React.Fragment>
                ))}
                {gIdx < arr.length - 1 && <View style={styles.categoryDivider} />}
              </View>
            ))}
          </View>
        )}

        {/* ── Bottom actions ── */}
        <View style={styles.actionsRow}>
          <ActionButton
            icon="radio-outline"
            label="Manage Feeds"
            onPress={() =>
              (navigation as any).navigate('Main', { screen: 'FeedTab' })
            }
          />
          <ActionButton
            icon="albums-outline"
            label="Past Digests"
            onPress={() =>
              (navigation as any).navigate('Main', { screen: 'LibraryTab' })
            }
          />
          <ActionButton
            icon="mic-outline"
            label="Convert Article"
            onPress={() =>
              (navigation as any).navigate('Main', { screen: 'HomeTab' })
            }
          />
        </View>
      </ScrollView>

      <Modal
        visible={showSoftPaywall}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSoftPaywall(false)}
      >
        <View style={styles.paywallBackdrop}>
          <View style={styles.paywallCard}>
            <Ionicons name="sparkles" size={32} color={Colors.primary} />
            <Text style={styles.paywallHeadline}>Enjoying your daily digest?</Text>
            <Text style={styles.paywallBody}>
              Subscribe to keep your daily audio briefing going — unlimited digests, every day.
            </Text>
            <TouchableOpacity
              style={styles.paywallSubscribeBtn}
              activeOpacity={0.85}
              onPress={handleSoftPaywallSubscribe}
            >
              <Text style={styles.paywallSubscribeBtnText}>Subscribe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.paywallContinueBtn}
              activeOpacity={0.75}
              onPress={handleSoftPaywallContinue}
            >
              <Text style={styles.paywallContinueBtnText}>Continue listening</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  // Header
  appTitle: {
    color: Colors.text,
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    marginTop: 2,
    marginBottom: Spacing.lg,
  },

  // Player card
  playerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },

  // Status row
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  readyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  readyText: {
    color: Colors.text,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metaText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },

  // Sources row — avatar stack + label
  sourcesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  sourcesLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginLeft: 10,
    flex: 1,
  },
  sourceBadge: {
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBadgeText: {
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  scrubberSection: { width: '100%' },
  slider: { width: '100%', height: 40 },

  // Time (aligned with PlayerScreen scrubber)
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

  // Controls
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  skipLabel: {
    position: 'absolute',
    bottom: 2,
    color: Colors.textMuted,
    fontSize: 8,
    fontWeight: '600',
  },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 12,
  },
  playBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  speedBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  // Generating card
  generatingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  generatingTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  progressSteps: { gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepLabel: { color: Colors.textDim, fontSize: FontSize.sm, flex: 1 },
  stepActive: { color: Colors.text, fontWeight: '600' },
  stepDone: { color: Colors.textMuted },

  // Error
  errorCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  errorText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
  },

  // Stories section
  storiesSection: {
    marginBottom: Spacing.lg,
  },
  storiesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  storiesTitle: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  allStoriesLink: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  categoryLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  categoryDivider: {
    height: 1,
    backgroundColor: Colors.border ?? 'rgba(255,255,255,0.08)',
    marginVertical: Spacing.sm,
  },
  storyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  storyMeta: {
    flex: 1,
    gap: 3,
  },
  storySource: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  storyTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
    lineHeight: 21,
  },
  storyDuration: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  storyDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  actionLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Soft paywall overlay
  paywallBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  paywallCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  paywallHeadline: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  paywallBody: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  paywallSubscribeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  paywallSubscribeBtnText: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  paywallContinueBtn: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    width: '100%',
  },
  paywallContinueBtnText: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
