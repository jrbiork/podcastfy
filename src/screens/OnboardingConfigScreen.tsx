import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Animated,
  StyleSheet,
  Platform,
  Modal,
} from 'react-native';

import RNDateTimePicker from '@react-native-community/datetimepicker';
const DateTimePicker = RNDateTimePicker as any;
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '../utils/theme';
import {
  ONBOARDING_TOPICS,
  TOPIC_GROUPS,
  OnboardingPrefs,
  saveOnboardingPrefs,
  formatDeliveryHour,
} from '../services/onboarding';
import { bootstrapSubscriptionsFromTopics } from '../services/rssService';

// ── Data ──────────────────────────────────────────────────────────────────────

const TIME_OPTIONS: Array<{
  label: string;
  sub: string;
  hour: number | null;
}> = [
  { label: 'Early bird',      sub: 'Start the day sharp',     hour: 6    },
  { label: 'Before work',     sub: 'Ready before you leave',  hour: 7    },
  { label: 'Morning routine', sub: 'With your coffee',        hour: 8    },
  { label: 'Commute',         sub: 'On the way in',           hour: 9    },
  { label: 'Custom time',     sub: 'You choose',              hour: null },
];

function selectionFeedback(count: number): string {
  if (count === 0) return 'Pick at least one topic to continue';
  if (count === 1) return '1 selected · Add a few more for variety';
  if (count === 2) return '2 selected · Nice start!';
  if (count === 3) return '3 selected · Looking good!';
  if (count <= 6) return `${count} selected · Great mix!`;
  return `${count} selected · Great variety!`;
}

/** Returns a Date object with today's date but the given hour set. */
function hourToDate(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (prefs: OnboardingPrefs) => void;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function OnboardingConfigScreen({ onComplete }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(
    () => new Set(['news']),
  );
  const [timeOption, setTimeOption] = useState<number | null>(7);
  const [customDate, setCustomDate] = useState<Date>(hourToDate(10));
  const [showPicker, setShowPicker] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  const customHour = customDate.getHours();
  const deliveryHour = timeOption !== null ? timeOption : customHour;
  const deliveryLabel =
    timeOption !== null
      ? (TIME_OPTIONS.find((o) => o.hour === timeOption)?.label ?? String(timeOption))
      : 'Custom time';

  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const advanceTo = (next: 1 | 2 | 3) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 100, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]).start(() => {
      setStep(next);
      slideAnim.setValue(20);
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    });
  };

  const goBack = () => {
    if (step <= 1) return;
    advanceTo(1);
  };

  const toggleTopic = (id: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleContinue = async () => {
    if (step < 2) {
      advanceTo(2);
      return;
    }
    const prefs: OnboardingPrefs = {
      selectedTopics: [...selectedTopics],
      deliveryHour,
      deliveryLabel,
    };
    await saveOnboardingPrefs(prefs);
    await bootstrapSubscriptionsFromTopics(prefs.selectedTopics);
    // Server prefs (selectedTopics, deliveryHour, etc.) are synced in
    // AuthScreen after sign-in — this screen runs before the user has a token.
    onComplete(prefs);
  };

  const canContinue = step === 1 ? selectedTopics.size > 0 : true;

  const stepTitles = [
    {
      label: 'WHAT INTERESTS YOU?',
      title: 'News that\nmatters to you',
      subtitle: "Pick your topics — we'll find the best sources automatically.",
    },
    {
      label: 'WHEN TO DELIVER?',
      title: 'Pick your listening\nmoment',
      subtitle: 'We will drop your briefing at the right time.',
    },
  ];

  const current = stepTitles[step - 1];

  // ── iOS-style custom time picker modal ──────────────────────────────────────

  const customTimeStr = formatDeliveryHour(customHour);

  const pickerModal = (
    <Modal
      transparent
      animationType="slide"
      visible={showPicker}
      onRequestClose={() => setShowPicker(false)}
    >
      <TouchableOpacity
        style={styles.pickerBackdrop}
        activeOpacity={1}
        onPress={() => setShowPicker(false)}
      />
      <View style={styles.pickerSheet}>
        <View style={styles.pickerHeader}>
          <TouchableOpacity onPress={() => setShowPicker(false)}>
            <Text style={styles.pickerDone}>Done</Text>
          </TouchableOpacity>
        </View>
        <DateTimePicker
          value={customDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minuteInterval={60}
          onChange={(_e: any, date?: Date) => {
            if (date) setCustomDate(date);
          }}
          style={styles.picker}
          textColor={Colors.text}
        />
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      {pickerModal}

      <View style={styles.progressRow}>
        {[1, 2, 3].map((s) => (
          <View
            key={s}
            style={[
              styles.dot,
              s === step && styles.dotActive,
              s < step && styles.dotDone,
            ]}
          />
        ))}
      </View>

      <Animated.View style={[styles.content, { transform: [{ translateX: slideAnim }] }]}>
        {/* Header */}
        <Text style={styles.sectionLabel}>{current.label}</Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.subtitle}>{current.subtitle}</Text>

        {step === 2 ? (
          <Text style={styles.timezoneHint}>Detected timezone: {detectedTimezone}</Text>
        ) : null}

        {/* ── Step 1: Topics ── */}
        {step === 1 && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.topicsWrap}
            keyboardShouldPersistTaps="handled"
          >
            {TOPIC_GROUPS.map((group) => (
              <View key={group.id} style={styles.topicGroup}>
                <Text style={styles.topicGroupLabel}>{group.label}</Text>
                <View style={styles.topicsGrid}>
                  {ONBOARDING_TOPICS.filter((t) => t.group === group.id).map((topic) => {
                    const selected = selectedTopics.has(topic.id);
                    return (
                      <TouchableOpacity
                        key={topic.id}
                        style={[styles.topicChip, selected && styles.topicChipSelected]}
                        activeOpacity={0.75}
                        onPress={() => toggleTopic(topic.id)}
                      >
                        <Ionicons
                          name={topic.icon as any}
                          size={18}
                          color={selected ? Colors.primary : Colors.textMuted}
                        />
                        <Text
                          style={[styles.topicLabel, selected && styles.topicLabelSelected]}
                          allowFontScaling={false}
                        >
                          {topic.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ── Step 2: Delivery time ── */}
        {step === 2 && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.timeListWrap}>
            {TIME_OPTIONS.map((opt) => {
              const isSelected =
                opt.hour !== null ? timeOption === opt.hour : timeOption === null;
              const clockStr = opt.hour !== null ? `${opt.hour}:00` : customTimeStr;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.timeCard, isSelected && styles.timeCardSelected]}
                  activeOpacity={0.8}
                  onPress={() => {
                    setTimeOption(opt.hour);
                    if (opt.hour === null) setShowPicker(true);
                  }}
                >
                  <View style={styles.timeMeta}>
                    <Text style={[styles.timeLabel, isSelected && styles.timeLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.timeDesc}>{opt.sub}</Text>
                  </View>
                  <Text style={[styles.timeClock, isSelected && styles.timeClockSelected]}>
                    {clockStr}
                  </Text>
                  {isSelected ? (
                    <View style={styles.radioOn}>
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    </View>
                  ) : (
                    <View style={styles.radioOff} />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Tap to change custom time when already selected */}
            {timeOption === null ? (
              <TouchableOpacity
                style={styles.changeTimeBtn}
                activeOpacity={0.8}
                onPress={() => setShowPicker(true)}
              >
                <Ionicons name="time-outline" size={16} color={Colors.primary} />
                <Text style={styles.changeTimeBtnText}>Change time · {customTimeStr}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </Animated.View>

      {/* Footer */}
      <View style={styles.footer}>
        {step === 1 ? (
          <Text style={styles.selectionFeedback}>{selectionFeedback(selectedTopics.size)}</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.cta, !canContinue && styles.ctaDisabled]}
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={!canContinue}
        >
          <Text style={styles.ctaText}>Continue</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
        {step > 1 ? (
          <TouchableOpacity
            style={styles.backLink}
            onPress={goBack}
            hitSlop={{ top: 12, bottom: 12 }}
          >
            <Text style={styles.backLinkText}>← Back</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  dotActive: {
    width: 22,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  dotDone: {
    backgroundColor: Colors.primaryDark,
  },

  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },

  sectionLabel: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 8,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  timezoneHint: {
    color: Colors.textDim,
    fontSize: FontSize.sm,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },

  // ── Topics ──────────────────────────────────────────────────────────────────
  topicsWrap: { paddingBottom: Spacing.lg, gap: Spacing.lg },
  topicGroup: { gap: Spacing.sm },
  topicGroupLabel: {
    color: Colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  topicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topicChipSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
    backgroundColor: Colors.primaryGlow,
  },
  topicLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  topicLabelSelected: {
    color: Colors.text,
    fontWeight: '600',
  },

  // ── Duration ────────────────────────────────────────────────────────────────
  durationList: { gap: Spacing.sm },
  durationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  durationCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryGlow,
  },
  durationLeft: { flex: 1 },
  durationLabel: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  durationLabelSelected: { color: Colors.text },
  durationName: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '500',
    marginTop: 3,
  },
  durationDetail: {
    color: Colors.textDim,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  radioOn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOff: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    backgroundColor: 'transparent',
  },

  // ── Time options ─────────────────────────────────────────────────────────────
  timeListWrap: { gap: Spacing.sm, paddingBottom: Spacing.md },
  timeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  timeCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryGlow,
  },
  timeMeta: { flex: 1 },
  timeLabel: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  timeLabelSelected: { color: Colors.text },
  timeDesc: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginTop: 2,
  },
  timeClock: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
    marginRight: Spacing.sm,
    minWidth: 48,
    textAlign: 'right',
  },
  timeClockSelected: {
    color: Colors.primary,
  },
  changeTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    marginTop: 4,
  },
  changeTimeBtnText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },

  // ── iOS picker sheet ──────────────────────────────────────────────────────
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pickerSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pickerDone: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  picker: {
    backgroundColor: Colors.surfaceElevated,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  selectionFeedback: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 16,
  },
  ctaDisabled: { opacity: 0.35 },
  ctaText: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  ctaArrow: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  backLinkText: {
    color: Colors.textDim,
    fontSize: FontSize.sm,
  },
});
