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
  AppState,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '../utils/theme';
import { Episode, DigestStory } from '../types';
import {
  bootTodayDigest,
  pollTodayDigestStatus,
} from '../services/digestService';
import {
  getDebugDateOffset,
  setDebugDateOffset,
  getDebugDate,
} from '../utils/debugDate';
import {
  recordDigestListened,
  getDigestTrialState,
} from '../services/subscription';
import { navigateToPaywall } from '../navigation/rootNavigationRef';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useEpisodes } from '../hooks/useEpisodes';
import { formatDuration } from '../utils/format';
import type { RootStackParamList } from '../navigation/rootNavigationRef';
import { feedImageUrl } from '../services/rssService';
import type { RssFeed, ExtendedRssItem, FeedCategory } from '../services/rssService';

const TOPIC_LABEL_TO_CATEGORY: Record<string, FeedCategory> = {
  'World News':        'news',
  'Technology':        'technology',
  'Economy':           'economy',
  'Business & Finance':'business-finance',
  'Politics':          'politics',
  'Health':            'health-wellness',
  'Science':           'science',
  'Productivity':      'productivity',
  'Fitness':           'fitness',
  'Mental Health':     'mental-health',
  'Food':              'food',
  'Travel':            'travel',
  'Parenting':         'parenting',
  'Entertainment':     'entertainment-news',
  'Movies & TV':       'movies-tv',
  'Music':             'music',
  'Gaming':            'gaming',
  'Books':             'books',
  'Startups':          'startups',
  'Crypto':            'crypto',
  'Environment':       'environment',
  'Sports':            'sports',
};
import { Analytics } from '../services/analytics';
import { setArticleNavList } from '../services/articleNavStore';

type Nav = StackNavigationProp<RootStackParamList>;
type Phase = 'loading' | 'preparing' | 'ready' | 'error';

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

function hasKnownStepStatus(status: string): boolean {
  return (
    status === 'fetching_feeds' ||
    status === 'ranking' ||
    status === 'summarizing' ||
    status === 'scripting' ||
    status === 'generating_audio'
  );
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

/** First story whose `[audioStartMs, audioEndMs)` contains `positionMs`, or null. */
function findActiveDigestStoryIndex(
  stories: DigestStory[],
  positionMs: number,
): number | null {
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]!;
    if (s.audioStartMs === undefined || s.audioEndMs === undefined) continue;
    if (positionMs >= s.audioStartMs && positionMs < s.audioEndMs) return i;
  }
  return null;
}

function groupByTopic(
  stories: DigestStory[],
): { label: string | undefined; stories: DigestStory[] }[] {
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

/**
 * Strip digest intro + `Source: "headline".` so detail matches narration body only.
 * Matches the last colon before a quoted headline (see digestWriter source+title line).
 */
function extractDetailText(
  spokenText?: string,
  summary?: string,
): string | undefined {
  const spoken = spokenText?.trim();
  if (spoken) {
    const stripped = spoken.replace(/^[\s\S]*?:\s*"[\s\S]*?"\.\s*/, '').trim();
    return stripped.length > 0 ? stripped : spoken;
  }
  return summary?.trim();
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
  active,
  onPress,
}: {
  story: DigestStory;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.storyRow, active && styles.storyRowActive]}
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
  const { update: updateEpisode } = useEpisodes();

  const [phase, setPhase] = useState<Phase>('loading');
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [cyclingStepIndex, setCyclingStepIndex] = useState(0);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [dateOffset, setDateOffset] = useState(() => getDebugDateOffset());
  const [speed, setSpeed] = useState<0.75 | 1 | 1.25>(1);
  const SPEEDS: (0.75 | 1 | 1.25)[] = [0.75, 1, 1.25];
  const [scrubPositionMs, setScrubPositionMs] = useState<number | null>(null);
  const [showSoftPaywall, setShowSoftPaywall] = useState(false);

  const digestScrollRef = useRef<ScrollView>(null);
  /** Top of storiesSection inside scroll content (from onLayout). */
  const storiesSectionTopRef = useRef(0);
  /** Each story row's y relative to storiesSection (from onLayout). */
  const storyRowYRef = useRef<Record<number, number>>({});
  const scrubbingRef = useRef(false);
  scrubbingRef.current = scrubPositionMs !== null;
  /** True while the user is dragging / coasting the digest list — skip auto-scroll to avoid fighting them. */
  const digestListUserScrollRef = useRef(false);
  const activeStoryIndexRef = useRef<number | null>(null);
  /** Last story index we auto-scrolled for; only scroll again when playback enters a different story. */
  const lastAutoScrollStoryIndexRef = useRef<number | null>(null);

  // Always call hooks at top level
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const handleDurationResolved = useCallback(
    (durationSeconds: number) => {
      if (!episode || durationSeconds === episode.durationSeconds) return;
      const updated = { ...episode, durationSeconds };
      setEpisode(updated);
      void updateEpisode(updated);
    },
    [episode, updateEpisode],
  );

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
      ? {
          title: episode.title,
          durationSeconds: episode.durationSeconds,
          onDurationResolved: handleDurationResolved,
        }
      : undefined,
  );

  // Match PlayerScreen: clear scrub override once playback catches up
  useEffect(() => {
    if (scrubPositionMs === null) return;
    if (Math.abs(positionMs - scrubPositionMs) < 1500) {
      setScrubPositionMs(null);
    }
  }, [positionMs, scrubPositionMs]);

  // Log when episode becomes available for playback
  useEffect(() => {
    if (!episode) return;
    void Analytics.playerOpened(episode.title, episode.mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id]);

  // Trigger paywall milestone when a daily digest is fully listened.
  useEffect(() => {
    if (!hasEnded || !episode) return;
    void Analytics.episodeCompleted(episode.title, Math.floor((durationMs || episode.durationSeconds * 1000) / 1000));
    const date = new Date(episode.createdAt).toISOString().slice(0, 10);
    void recordDigestListened(date).then((shouldShowSoftPaywall) => {
      if (shouldShowSoftPaywall) setShowSoftPaywall(true);
    });
  }, [hasEnded, episode, durationMs]);

  const digestInProgress = phase === 'loading' || phase === 'preparing';
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

  // Keep progress indicator alive while digest is in progress, even before
  // backend status arrives (e.g. app reopen while only checking existing digest).
  useEffect(() => {
    if (!digestInProgress) {
      setCyclingStepIndex(0);
      return;
    }
    const lastStep = PROGRESS_STEPS.length - 1;
    const interval = setInterval(() => {
      setCyclingStepIndex((prev) => Math.min(prev + 1, lastStep));
    }, 900);
    return () => clearInterval(interval);
  }, [digestInProgress]);

  // Boot: dispatch if needed, then return immediately
  useEffect(() => {
    let cancelled = false;

    setPhase('loading');
    setProgressStatus('');
    setEpisode(null);
    setErrorMsg(null);

    const ERROR_LABELS: Record<string, string> = {
      auth_expired: 'Session expired. Please sign in again.',
      not_signed_in: "You're not signed in.",
    };

    (async () => {
      try {
        const result = await bootTodayDigest();
        if (cancelled) return;
        if (result.type === 'ready') {
          setEpisode(result.episode);
          setPhase('ready');
        } else {
          setPhase('preparing');
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const code =
          (err as { code?: string }).code ??
          (err as Error).message ??
          'unknown';
        setErrorMsg(
          ERROR_LABELS[code] ?? 'Something went wrong. Tap to try again.',
        );
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // Background poll every 5 s while preparing + re-check on foreground
  useEffect(() => {
    if (phase !== 'preparing') return;

    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      const result = await pollTodayDigestStatus();
      if (cancelled) return;
      if (result.type === 'ready') {
        setEpisode(result.episode);
        setPhase('ready');
      } else if (result.status) {
        setProgressStatus(result.status);
      }
    };

    const interval = setInterval(check, 5_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [phase]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const stepIndex = hasKnownStepStatus(progressStatus)
    ? statusToStepIndex(progressStatus)
    : cyclingStepIndex;

  const totalMs = durationMs || (episode?.durationSeconds ?? 0) * 1000 || 1;

  const handleSpeedPress = useCallback(async () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    await setRate(next);
  }, [speed, setRate]);

  const handlePlayPress = useCallback(async () => {
    const state = await getDigestTrialState();
    if (state === 'hard') {
      navigateToPaywall();
      return;
    }
    if (hasEnded) {
      if (episode) void Analytics.episodeRestarted(episode.title);
      void restart();
      return;
    }
    if (isPlaying) {
      if (episode) void Analytics.episodePaused(episode.title, Math.floor(positionMs / 1000));
      void pause();
      return;
    }
    if (episode) void Analytics.episodePlayed(episode.title, Math.floor(positionMs / 1000));
    void play();
  }, [hasEnded, isPlaying, restart, pause, play, episode, positionMs]);

  const handleSoftPaywallSubscribe = useCallback(() => {
    setShowSoftPaywall(false);
    navigateToPaywall();
  }, []);

  const handleSoftPaywallContinue = useCallback(() => {
    setShowSoftPaywall(false);
  }, []);

  const storyToItem = useCallback((s: DigestStory): ExtendedRssItem => {
    const preview = extractDetailText(s.spokenText, s.summary);
    return {
      title: s.title,
      link: s.link,
      guid: s.link,
      audioStartMs: s.audioStartMs,
      audioEndMs: s.audioEndMs,
      ...(preview ? { description: preview, fullDescription: preview } : {}),
    };
  }, []);

  // Must be declared before handleStoryPress so the useCallback dep array captures
  // the real stories value, not undefined (temporal dead zone issue).
  const stories = episode?.stories ?? [];

  const handleStoryPress = useCallback(
    (story: DigestStory) => {
      const item = storyToItem(story);
      const feed: RssFeed = {
        id: story.feedId,
        name: story.feedName,
        url: '',
        category: (story.topicLabel ? TOPIC_LABEL_TO_CATEGORY[story.topicLabel] : undefined) ?? 'news',
      };
      const allItems = stories.map(storyToItem);
      const currentIndex = stories.findIndex(s => s.link === story.link);
      setArticleNavList(allItems, feed);
      navigation.navigate('ArticleDetail', { item, feed, currentIndex: currentIndex >= 0 ? currentIndex : 0 });
    },
    [navigation, stories, storyToItem],
  );

  const handleDateShift = useCallback(
    (delta: number) => {
      const next = dateOffset + delta;
      setDebugDateOffset(next);
      setDateOffset(next);
      setRetryKey((k) => k + 1);
    },
    [dateOffset],
  );

  const dateLabel = getDebugDate().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  const showContentSkeleton = phase === 'loading' || phase === 'preparing';
  const uniqueFeeds = [...new Map(stories.map((s) => [s.feedId, s])).values()];

  const effectivePlaybackMs = scrubPositionMs ?? positionMs;

  const activeStoryIndex = useMemo(() => {
    if (phase !== 'ready' || !episode || stories.length === 0) return null;
    return findActiveDigestStoryIndex(stories, effectivePlaybackMs);
  }, [phase, episode, stories, effectivePlaybackMs]);
  activeStoryIndexRef.current = activeStoryIndex;

  const groupedStoriesWithGlobalIndex = useMemo(() => {
    let globalIndex = 0;
    return groupByTopic(stories).map((group) => ({
      label: group.label,
      entries: group.stories.map((story) => ({
        story,
        globalIndex: globalIndex++,
      })),
    }));
  }, [stories]);

  const digestStoriesKey = `${episode?.sourceUrl ?? ''}:${stories.length}`;
  useEffect(() => {
    storyRowYRef.current = {};
    lastAutoScrollStoryIndexRef.current = null;
  }, [digestStoriesKey]);

  const scrollActiveStoryIntoView = useCallback(
    (index: number, animated: boolean) => {
      if (digestListUserScrollRef.current) return;
      const rowY = storyRowYRef.current[index];
      if (rowY === undefined) return;
      const sectionY = storiesSectionTopRef.current;
      const pad = 16;
      digestScrollRef.current?.scrollTo({
        y: Math.max(0, sectionY + rowY - pad),
        animated,
      });
    },
    [],
  );

  /**
   * User finished list gesture: do not pull scroll back to the highlight unless playback
   * moved to another story while they were dragging (catch-up once).
   */
  const endDigestListUserScroll = useCallback(() => {
    if (!digestListUserScrollRef.current) return;
    digestListUserScrollRef.current = false;
    const idx = activeStoryIndexRef.current;
    if (idx == null) return;
    if (idx === lastAutoScrollStoryIndexRef.current) return;
    requestAnimationFrame(() => {
      if (digestListUserScrollRef.current) return;
      if (storyRowYRef.current[idx] === undefined) return;
      scrollActiveStoryIntoView(idx, !scrubbingRef.current);
      lastAutoScrollStoryIndexRef.current = idx;
    });
  }, [scrollActiveStoryIntoView]);

  const handleDigestScrollBeginDrag = useCallback(() => {
    digestListUserScrollRef.current = true;
  }, []);

  const handleDigestScrollEndDrag = useCallback(
    (e: { nativeEvent: { velocity?: { y?: number } } }) => {
      if (!digestListUserScrollRef.current) return;
      const vy = e.nativeEvent.velocity?.y;
      if (vy === undefined) {
        return;
      }
      if (Math.abs(vy) >= 0.5) {
        return;
      }
      requestAnimationFrame(() => endDigestListUserScroll());
    },
    [endDigestListUserScroll],
  );

  const handleDigestMomentumScrollEnd = useCallback(() => {
    if (!digestListUserScrollRef.current) return;
    requestAnimationFrame(() => endDigestListUserScroll());
  }, [endDigestListUserScroll]);

  useEffect(() => {
    if (phase !== 'ready' || stories.length === 0) {
      return;
    }
    if (activeStoryIndex == null) {
      lastAutoScrollStoryIndexRef.current = null;
      return;
    }
    if (activeStoryIndex === lastAutoScrollStoryIndexRef.current) {
      return;
    }

    let cancelled = false;
    const targetIndex = activeStoryIndex;
    const animated = !scrubbingRef.current;
    const run = (attempt: number) => {
      if (cancelled) return;
      if (digestListUserScrollRef.current) return;
      if (storyRowYRef.current[targetIndex] !== undefined) {
        scrollActiveStoryIntoView(targetIndex, animated);
        lastAutoScrollStoryIndexRef.current = targetIndex;
        return;
      }
      if (attempt >= 8) {
        lastAutoScrollStoryIndexRef.current = targetIndex;
        return;
      }
      requestAnimationFrame(() => run(attempt + 1));
    };
    const id = requestAnimationFrame(() => run(0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [phase, activeStoryIndex, stories.length, scrollActiveStoryIntoView]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <View style={styles.topSection}>
        {/* ── App header ── */}
        <Text style={styles.appTitle}>Sonera</Text>

        {/* ── Debug date nav (dev only) ── */}
        {__DEV__ && (
          <View style={styles.debugDateRow}>
            <TouchableOpacity
              style={styles.debugBtn}
              onPress={() => handleDateShift(-1)}
            >
              <Ionicons name="chevron-back" size={16} color="orange" />
            </TouchableOpacity>
            <Text style={styles.debugDateText}>
              {dateOffset === 0
                ? 'Today (real)'
                : dateOffset > 0
                  ? `+${dateOffset}d from today`
                  : `${dateOffset}d from today`}
            </Text>
            <TouchableOpacity
              style={styles.debugBtn}
              onPress={() => handleDateShift(1)}
            >
              <Ionicons name="chevron-forward" size={16} color="orange" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Player card (ready phase) ── */}
        {phase === 'ready' && episode && (
          <View style={styles.playerCard}>
            <View style={styles.statusRow}>
              <Text style={styles.playerCardSubtitle} numberOfLines={2}>
                Daily update
              </Text>
              <Text
                style={[styles.playerCardSubtitle, { textAlign: 'right' }]}
              >
                {dateLabel} · {stories.length}{' '}
                {stories.length === 1 ? 'story' : 'stories'}
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
                  if (episode) void Analytics.episodeSeeked(episode.title, Math.floor(positionMs / 1000), Math.floor(v / 1000));
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
                onPress={() => { if (episode) void Analytics.episodeSkipped(episode.title, 'back', 15, Math.floor(positionMs / 1000)); skip(-15_000); }}
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
                onPress={() => { if (episode) void Analytics.episodeSkipped(episode.title, 'forward', 15, Math.floor(positionMs / 1000)); skip(15_000); }}
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

        {/* ── Loading / Preparing card ── */}
        {(phase === 'loading' || phase === 'preparing') && (
          <View style={styles.preparingCard}>
            <Text style={styles.preparingTitle}>Preparing your briefing…</Text>
            {phase === 'preparing' && (
              <Text style={styles.preparingBody}>
                This usually takes 2–5 minutes. Feel free to come back later —
                we'll notify you when it's ready.
              </Text>
            )}
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
      </View>

      <ScrollView
        ref={digestScrollRef}
        style={styles.contentScroll}
        contentContainerStyle={styles.contentScrollInner}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleDigestScrollBeginDrag}
        onScrollEndDrag={handleDigestScrollEndDrag}
        onMomentumScrollEnd={handleDigestMomentumScrollEnd}
      >
        <View>
          {showContentSkeleton && (
            <View style={styles.skeletonSection}>
              {[0, 1, 2, 3].map((idx) => (
                <View key={idx} style={styles.skeletonStoryRow}>
                  <View style={styles.skeletonBadge} />
                  <View style={styles.skeletonStoryMeta}>
                    <View style={styles.skeletonSource} />
                    <View style={styles.skeletonTitle} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Stories list (Fragment groups so row onLayout y is relative to storiesSection) ── */}
          {stories.length > 0 && (
            <View
              style={styles.storiesSection}
              onLayout={(e) => {
                storiesSectionTopRef.current = e.nativeEvent.layout.y;
              }}
            >
              {groupedStoriesWithGlobalIndex.map((group, gIdx, arr) => (
                <React.Fragment key={gIdx}>
                  <Text style={styles.categoryLabel}>
                    {(group.label ?? 'General').toUpperCase()}
                  </Text>
                  {group.entries.map(({ story, globalIndex }, sIdx) => (
                    <View
                      key={story.link + globalIndex}
                      collapsable={false}
                      onLayout={(ev) => {
                        storyRowYRef.current[globalIndex] =
                          ev.nativeEvent.layout.y;
                      }}
                    >
                      <StoryRow
                        story={story}
                        active={activeStoryIndex === globalIndex}
                        onPress={() => handleStoryPress(story)}
                      />
                      {sIdx < group.entries.length - 1 && (
                        <View style={styles.storyDivider} />
                      )}
                    </View>
                  ))}
                  {gIdx < arr.length - 1 && (
                    <View style={styles.categoryDivider} />
                  )}
                </React.Fragment>
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
            <Text style={styles.paywallHeadline}>
              Enjoying your daily digest?
            </Text>
            <Text style={styles.paywallBody}>
              Subscribe to keep your daily audio briefing going — unlimited
              digests, every day.
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
              <Text style={styles.paywallContinueBtnText}>
                Continue listening
              </Text>
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
  topSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  contentScroll: {
    flex: 1,
  },
  contentScrollInner: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  // Header
  appTitle: {
    color: Colors.text,
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },

  // Player card
  playerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
    width: '100%',
  },
  playerCardSubtitle: {
    flex: 1,
    minWidth: 0,
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 18,
    marginRight: Spacing.sm,
  },
  metaText: {
    flexShrink: 0,
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    textAlign: 'right',
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

  // Preparing card
  preparingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  preparingTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  preparingBody: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
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
    paddingHorizontal: Spacing.sm,
    marginHorizontal: -Spacing.sm,
    borderRadius: Radius.md,
  },
  storyRowActive: {
    backgroundColor: Colors.primaryGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.primaryDark,
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
  skeletonSection: {
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    minHeight: 320,
  },
  skeletonStoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  skeletonBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  skeletonStoryMeta: {
    flex: 1,
    gap: 8,
  },
  skeletonSource: {
    width: 110,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
  },
  skeletonTitle: {
    width: '85%',
    height: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
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

  // Debug date navigator (dev only)
  debugDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    backgroundColor: 'rgba(255,165,0,0.08)',
    borderRadius: Radius.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,165,0,0.25)',
  },
  debugBtn: {
    padding: 4,
  },
  debugDateText: {
    color: 'orange',
    fontSize: FontSize.sm,
    fontWeight: '700',
    minWidth: 120,
    textAlign: 'center',
  },
});
