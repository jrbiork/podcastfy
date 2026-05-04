import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated,
  StyleSheet,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors, Spacing, FontSize, Radius } from '../utils/theme';
import {
  loadOnboardingPrefs,
  ONBOARDING_TOPICS,
  DEFAULT_TOPICS,
  topicsToFeedUrls,
  formatDeliveryHour,
  formatDeliveryClock,
  getPreviewHeadlines,
} from '../services/onboarding';
import { fetchPreviewTitlesFromFeedUrls } from '../services/rssService';
import { dispatchJob, pollJob, downloadAudio, saveUserPreferences } from '../services/api';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { formatDuration } from '../utils/format';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPreviewScript(headlines: string[], deliveryHour: number): string {
  const time = formatDeliveryHour(deliveryHour);
  const headlineLines = headlines
    .map((h) => h.endsWith('.') ? h : `${h}.`)
    .join(' ');

  return `Good morning. Here's a quick preview of your Sonera daily briefing.

${headlineLines}

Your full briefing will be ready every morning at ${time} — curated from your selected sources, summarized and ready to listen. See you tomorrow.`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'generating' | 'ready' | 'error';

const LOADING_STEPS = [
  'Scanning your feeds',
  'Selecting top stories',
  'Writing summaries',
  'Generating audio',
];

// ── Screen ────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
  onBack?: () => void;
}

export function DigestPreviewScreen({ onComplete, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('generating');
  const [loadingStep, setLoadingStep] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [topicLabels, setTopicLabels] = useState<string[]>([]);
  const [deliveryHour, setDeliveryHour] = useState(8);
  const [deliveryLabel, setDeliveryLabel] = useState('Morning routine');
  const [headlines, setHeadlines] = useState<string[]>([]);

  const [speed, setSpeedState] = useState<0.5 | 0.75 | 1 | 1.5 | 2>(1);
  const [scrubPositionMs, setScrubPositionMs] = useState<number | null>(null);
  const SPEEDS: (0.5 | 0.75 | 1 | 1.5 | 2)[] = [0.5, 0.75, 1, 1.5, 2];

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const revealAnim = useRef(new Animated.Value(0)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const { isPlaying, positionMs, durationMs, play, pause, skip, seek, setRate } = useAudioPlayer(
    audioUri,
    { title: 'Your Sonera preview', durationSeconds: 45 },
  );

  // Pulse animation for orb
  useEffect(() => {
    if (phase === 'generating') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [phase]);

  // Reveal animation when ready
  useEffect(() => {
    if (phase === 'ready') {
      Animated.spring(revealAnim, {
        toValue: 1,
        tension: 55,
        friction: 9,
        useNativeDriver: true,
      }).start();
    }
  }, [phase]);

  // Clear scrub override once playback catches up
  useEffect(() => {
    if (scrubPositionMs === null) return;
    if (Math.abs(positionMs - scrubPositionMs) < 1500) {
      setScrubPositionMs(null);
    }
  }, [positionMs, scrubPositionMs]);

  const totalMs = durationMs || 45_000;

  const handleSpeedPress = useCallback(async () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeedState(next);
    await setRate(next);
  }, [speed, setRate]);

  const generate = useCallback(async () => {
    try {
      const prefs = await loadOnboardingPrefs();
      const topics = prefs?.selectedTopics?.length ? prefs.selectedTopics : DEFAULT_TOPICS;
      const hour = prefs?.deliveryHour ?? 8;
      const label = prefs?.deliveryLabel ?? 'Morning routine';

      setDeliveryHour(hour);
      setDeliveryLabel(label);

      const labels = topics.map((id) => ONBOARDING_TOPICS.find((t) => t.id === id)?.label ?? id);
      setTopicLabels(labels);

      const feedUrls = topicsToFeedUrls(topics);
      let preview = await fetchPreviewTitlesFromFeedUrls(feedUrls, 3);
      if (preview.length < 3) {
        const fallback = getPreviewHeadlines(topics);
        for (const h of fallback) {
          if (preview.length >= 3) break;
          if (!preview.includes(h)) preview.push(h);
        }
      }
      preview = preview.slice(0, 3);
      setHeadlines(preview);

      const script = buildPreviewScript(preview, hour);

      // Advance loading steps while TTS generates (4 steps, ~10s total expected)
      const stepTimer = async () => {
        await sleep(2_500);
        setLoadingStep(1);
        await sleep(3_000);
        setLoadingStep(2);
        await sleep(3_500);
        setLoadingStep(3);
      };
      stepTimer();

      const jobId = await dispatchJob({ type: 'text', text: script }, 'tts');

      let status = await pollJob(jobId);
      while (status.status !== 'done' && status.status !== 'error') {
        await sleep(2_000);
        status = await pollJob(jobId);
      }

      if (status.status === 'error') throw new Error(status.error ?? 'generation_failed');
      if (status.status !== 'done') throw new Error('generation_failed');

      setLoadingStep(3);
      await sleep(600);

      const destUri = `${FileSystem.cacheDirectory}preview-${Date.now()}.mp3`;
      await downloadAudio(status.audioUrl, destUri);

      setAudioUri(destUri);
      setPhase('ready');

      // Save user preferences
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      saveUserPreferences({ timezone, feedUrls, deliveryHour: hour }).catch(() => {});
    } catch (err) {
      console.error('[DigestPreviewScreen] generation failed', err);
      setErrorMsg('Something went wrong generating your preview.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    generate();
  }, [generate]);

  const handleStart = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Topic list string for generating subtitle
  const topicSummary = topicLabels.length > 2
    ? `${topicLabels.slice(0, 2).join(', ')} and more`
    : topicLabels.join(' & ') || 'your topics';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Step 4 of 4 */}
      <View style={styles.progressRow}>
        {[1, 2, 3, 4].map((s) => (
          <View
            key={s}
            style={[
              styles.progressDot,
              s === 4 && styles.progressDotActive,
              s < 4 && styles.progressDotDone,
            ]}
          />
        ))}
      </View>

      {/* ── Generating phase ── */}
      {phase === 'generating' && (
        <View style={styles.generatingWrap}>
          {/* Pulsing orb */}
          <View style={styles.orbContainer}>
            <Animated.View
              style={[
                styles.orbRingOuter,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
            <Animated.View
              style={[
                styles.orbRingMid,
                {
                  transform: [{
                    scale: pulseAnim.interpolate({ inputRange: [1, 1.18], outputRange: [1, 1.12] }),
                  }],
                },
              ]}
            />
            <View style={styles.orbCore}>
              <Ionicons name="mic" size={28} color="#fff" />
            </View>
          </View>

          <Text style={styles.genTitle}>Building your digest...</Text>
          <Text style={styles.genSubtitle}>Curating stories from {topicSummary}</Text>

          <View style={styles.separator} />

          <View style={styles.steps}>
            {LOADING_STEPS.map((label, i) => {
              const isDone = loadingStep > i;
              const isActive = loadingStep === i;
              return (
                <View key={label} style={styles.stepRow}>
                  {isDone ? (
                    <View style={styles.stepCheckWrap}>
                      <Ionicons name="checkmark" size={13} color="#fff" />
                    </View>
                  ) : isActive ? (
                    <View style={[styles.stepCheckWrap, styles.stepCheckActive]} />
                  ) : (
                    <View style={styles.stepDotWrap} />
                  )}
                  <Text
                    style={[
                      styles.stepLabel,
                      isDone && styles.stepLabelDone,
                      isActive && styles.stepLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Ready phase ── */}
      {phase === 'ready' && (
        <Animated.ScrollView
          contentContainerStyle={styles.readyScroll}
          showsVerticalScrollIndicator={false}
          style={{
            opacity: revealAnim,
            transform: [{ scale: revealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
          }}
        >
          <Text style={styles.readyTitle}>Your briefing is ready</Text>
          <Text style={styles.readySubtitle}>Preview a sample · 45 seconds</Text>

          {/* Player card */}
          <View style={styles.playerCard}>
            {/* Status row */}
            <View style={styles.statusRow}>
              <View style={styles.readyBadge}>
                <View style={styles.readyDot} />
                <Text style={styles.readyText}>PREVIEW · 45 SEC</Text>
              </View>
            </View>

            {/* Headlines */}
            {headlines.map((h, i) => (
              <View key={i} style={styles.headlineRow}>
                <View style={styles.headlineBullet} />
                <Text style={styles.headlineText}>{h}</Text>
              </View>
            ))}

            <View style={styles.playerDivider} />

            {/* Scrubber */}
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
                  {formatDuration(Math.floor((scrubPositionMs ?? positionMs) / 1000))}
                </Text>
                <Text style={styles.timeText}>
                  {formatDuration(Math.floor(totalMs / 1000))}
                </Text>
              </View>
            </View>

            {/* Controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => skip(-15_000)}>
                <Ionicons name="play-back" size={18} color={Colors.text} />
                <Text style={styles.skipLabel}>15</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.playBtn}
                activeOpacity={0.85}
                onPress={isPlaying ? pause : play}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#fff" />
                <Text style={styles.playBtnText}>
                  {isPlaying ? 'Pause' : 'Play preview'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.iconBtn} onPress={() => skip(15_000)}>
                <Ionicons name="play-forward" size={18} color={Colors.text} />
                <Text style={styles.skipLabel}>15</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.speedBtn} onPress={handleSpeedPress}>
                <Text style={styles.speedText}>
                  {speed === 1 ? '1×' : `${speed}×`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Delivery card */}
          <View style={styles.deliveryCard}>
            <View style={styles.deliveryLeft}>
              <Text style={styles.deliveryCardLabel}>DAILY DELIVERY</Text>
              <Text style={styles.deliveryCardValue}>
                {deliveryLabel} · {formatDeliveryClock(deliveryHour)}
              </Text>
            </View>
            <Text style={styles.bellEmoji}>🔔</Text>
          </View>

          {/* CTA */}
          <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85} onPress={handleStart}>
            <Text style={styles.ctaBtnText}>Start listening every day</Text>
          </TouchableOpacity>

          {/* Back */}
          {onBack && (
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
          )}
        </Animated.ScrollView>
      )}

      {/* ── Error phase ── */}
      {phase === 'error' && (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85} onPress={handleStart}>
            <Text style={styles.ctaBtnText}>Continue without preview</Text>
          </TouchableOpacity>
          {onBack && (
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ORB_CORE = 72;
const ORB_MID = 108;
const ORB_OUTER = 150;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  progressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  progressDotActive: {
    width: 22,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  progressDotDone: {
    backgroundColor: Colors.primaryDark,
  },

  // Generating
  generatingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  orbContainer: {
    width: ORB_OUTER,
    height: ORB_OUTER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  orbRingOuter: {
    position: 'absolute',
    width: ORB_OUTER,
    height: ORB_OUTER,
    borderRadius: ORB_OUTER / 2,
    backgroundColor: Colors.primary + '18',
  },
  orbRingMid: {
    position: 'absolute',
    width: ORB_MID,
    height: ORB_MID,
    borderRadius: ORB_MID / 2,
    backgroundColor: Colors.primary + '30',
  },
  orbCore: {
    width: ORB_CORE,
    height: ORB_CORE,
    borderRadius: ORB_CORE / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  genSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  separator: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
  steps: { width: '100%', gap: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepCheckWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCheckActive: {
    backgroundColor: Colors.primary + '50',
  },
  stepDotWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepLabel: {
    color: Colors.textDim,
    fontSize: FontSize.md,
    flex: 1,
  },
  stepLabelActive: {
    color: Colors.text,
    fontWeight: '600',
  },
  stepLabelDone: {
    color: Colors.textMuted,
  },

  // Ready
  readyScroll: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  readyTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 6,
  },
  readySubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },

  // Player card
  playerCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headlineBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.textDim,
    marginTop: 7,
    flexShrink: 0,
  },
  headlineText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  playerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  scrubberSection: { width: '100%' },
  slider: { width: '100%', height: 40 },
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

  // Delivery card
  deliveryCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.lg,
  },
  deliveryLeft: { flex: 1 },
  deliveryCardLabel: {
    color: Colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  deliveryCardValue: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  bellEmoji: {
    fontSize: 24,
  },

  // CTA
  ctaBtn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 16,
    marginBottom: Spacing.md,
  },
  ctaBtnText: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },

  // Back
  backBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  backBtnText: {
    color: Colors.textDim,
    fontSize: FontSize.sm,
  },

  // Error
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  errorText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
});
