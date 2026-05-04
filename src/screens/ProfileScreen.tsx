import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ActionSheetIOS,
  Modal,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import RNDateTimePicker from '@react-native-community/datetimepicker';
const DateTimePicker = RNDateTimePicker as any;
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { loadSession, clearSession, type AuthSession } from '../services/auth';
import { getUserPreferences, saveUserPreferences, deleteDigestToday, type UserPreferences } from '../services/api';
import {
  getTotalGeneratedSeconds,
  getIsSubscribed,
  FREE_LIMIT_SECONDS,
  clearLocalData,
} from '../services/subscription';
import { clearAllEpisodes } from '../services/storage';
import { useEpisodes } from '../hooks/useEpisodes';
import { resetToAuth, resetToOnboarding, navigateToPaywall } from '../navigation/rootNavigationRef';
import { formatDuration } from '../utils/format';
import {
  clearOnboardingPrefs,
  clearOnboardingProgress,
  formatDeliveryHour,
  loadOnboardingPrefs,
  saveOnboardingPrefs,
  type OnboardingPrefs,
} from '../services/onboarding';

const APP_VERSION = '1.0.0';

const VOICES = [
  { id: 'alloy',   label: 'Alloy',   description: 'Neutral, versatile' },
  { id: 'echo',    label: 'Echo',    description: 'Warm, conversational' },
  { id: 'fable',   label: 'Fable',   description: 'British, authoritative' },
  { id: 'nova',    label: 'Nova',    description: 'Bright, energetic' },
  { id: 'onyx',    label: 'Onyx',    description: 'Deep, confident' },
  { id: 'shimmer', label: 'Shimmer', description: 'Soft, expressive' },
];

function initials(name?: string): string {
  if (!name) return '';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function hourToDate(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function ProfileScreen() {
  const { episodes, load } = useEpisodes();
  const [session, setSession]           = useState<AuthSession | null>(null);
  const [usedSeconds, setUsedSeconds]   = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [signingOut, setSigningOut]     = useState(false);
  const [preferences, setPreferences]   = useState<UserPreferences | null>(null);
  const [prefs, setPrefs]               = useState<OnboardingPrefs | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickerDate, setPickerDate]     = useState<Date>(hourToDate(7));
  const [saving, setSaving]             = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load();
      loadSession().then((s) => {
        if (!cancelled) setSession(s);
      });
      getTotalGeneratedSeconds().then((n) => {
        if (!cancelled) setUsedSeconds(n);
      });
      getIsSubscribed().then((v) => {
        if (!cancelled) setIsSubscribed(v);
      });
      void (async () => {
        const [server, local] = await Promise.all([
          getUserPreferences().catch(() => null),
          loadOnboardingPrefs(),
        ]);
        if (cancelled) return;
        if (server) setPreferences(server);
        if (local) {
          setPrefs(local);
          if (local.deliveryHour != null) setPickerDate(hourToDate(local.deliveryHour));
        } else if (server?.selectedTopics && server.selectedTopics.length > 0) {
          setPrefs({
            selectedTopics: [...server.selectedTopics],
            deliveryHour: server.deliveryHour ?? 6,
            deliveryLabel: 'From account',
            ...(server.voice ? { voice: server.voice } : {}),
          });
          if (server.deliveryHour != null) setPickerDate(hourToDate(server.deliveryHour));
        } else {
          setPrefs(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const currentVoice = prefs?.voice ?? 'alloy';
  const currentHour  = prefs?.deliveryHour ?? preferences?.deliveryHour ?? 6;

  // ── Save helpers ─────────────────────────────────────────────────────────────

  const applyPrefs = useCallback(async (updated: OnboardingPrefs) => {
    setSaving(true);
    try {
      await saveOnboardingPrefs(updated);
      setPrefs(updated);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await saveUserPreferences({
        timezone: tz,
        deliveryHour: updated.deliveryHour,
        voice: updated.voice,
        selectedTopics: updated.selectedTopics,
      }).catch(() => {});
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Voice picker ─────────────────────────────────────────────────────────────

  const handleVoicePress = useCallback(() => {
    const options = [...VOICES.map((v) => v.label), 'Cancel'];
    const cancelIdx = options.length - 1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIdx, title: 'Digest Voice' },
        async (i) => {
          if (i === cancelIdx) return;
          const voice = VOICES[i].id;
          const updated: OnboardingPrefs = {
            ...(prefs ?? { selectedTopics: [], deliveryHour: 6, deliveryLabel: 'Before work' }),
            voice,
          };
          await applyPrefs(updated);
        },
      );
    } else {
      Alert.alert(
        'Digest Voice',
        undefined,
        [
          ...VOICES.map((v) => ({
            text: `${v.label} — ${v.description}`,
            onPress: async () => {
              const updated: OnboardingPrefs = {
                ...(prefs ?? { selectedTopics: [], deliveryHour: 6, deliveryLabel: 'Before work' }),
                voice: v.id,
              };
              await applyPrefs(updated);
            },
          })),
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    }
  }, [prefs, applyPrefs]);

  // ── Time picker ──────────────────────────────────────────────────────────────

  const handleTimeConfirm = useCallback(async () => {
    setShowTimePicker(false);
    const hour = pickerDate.getHours();
    const updated: OnboardingPrefs = {
      ...(prefs ?? { selectedTopics: [], deliveryHour: 6, deliveryLabel: 'Before work' }),
      deliveryHour: hour,
      deliveryLabel: 'Custom time',
    };
    await applyPrefs(updated);
  }, [pickerDate, prefs, applyPrefs]);

  // ── Destructive actions ──────────────────────────────────────────────────────

  const onSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await clearSession();
            resetToAuth();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const onClearData = () => {
    Alert.alert(
      'Clear All Data',
      "This will permanently delete all episodes, reset your account, and remove today's digest from the server. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything',
          style: 'destructive',
          onPress: async () => {
            // Delete today's digest from S3 first so a fresh one can be generated
            await deleteDigestToday();
            await clearAllEpisodes();
            await clearLocalData();
            await clearOnboardingProgress();
            await clearOnboardingPrefs();
            await clearSession();
            resetToOnboarding();
          },
        },
      ],
    );
  };

  const avatarInitials = initials(session?.displayName);
  const totalEpisodeDuration = episodes.reduce((acc, e) => acc + e.durationSeconds, 0);
  const usedMinutes   = Math.floor(usedSeconds / 60);
  const totalMinutes  = FREE_LIMIT_SECONDS / 60;
  const usedPercent   = Math.min(1, usedSeconds / FREE_LIMIT_SECONDS);

  const voiceLabel = VOICES.find((v) => v.id === currentVoice)?.label ?? 'Alloy';
  const tz         = preferences?.timezone?.split('/').pop()?.replace(/_/g, ' ') ?? '';
  const timeLabel     = `Daily at ${formatDeliveryHour(currentHour)}${tz ? ` · ${tz}` : ''}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* ── iOS time picker sheet ──────────────────────────────────────────── */}
      <Modal
        transparent
        animationType="slide"
        visible={showTimePicker}
        onRequestClose={() => setShowTimePicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setShowTimePicker(false)}
        />
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => setShowTimePicker(false)}>
              <Text style={styles.pickerCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>Delivery Time</Text>
            <TouchableOpacity onPress={handleTimeConfirm}>
              <Text style={styles.pickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={pickerDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minuteInterval={60}
            onChange={(_e: any, date?: Date) => { if (date) setPickerDate(date); }}
            style={styles.picker}
            textColor={Colors.text}
          />
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarWrap}>
            {session?.photoUrl ? (
              <Image source={{ uri: session.photoUrl }} style={styles.avatar} />
            ) : avatarInitials ? (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>{avatarInitials}</Text>
              </View>
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={36} color={Colors.textMuted} />
              </View>
            )}
          </View>
          <Text style={styles.displayName}>{session?.displayName ?? 'Sonera User'}</Text>
          {session?.email ? <Text style={styles.email}>{session.email}</Text> : null}
          <View style={styles.badgeRow}>
            {isSubscribed ? (
              <View style={styles.proBadgeHeader}>
                <Ionicons name="sparkles" size={11} color="#A78BFA" />
                <Text style={styles.proBadgeText}>Pro</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.freeBadge} onPress={navigateToPaywall} activeOpacity={0.8}>
                <Text style={styles.freeBadgeText}>Free</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Subscription ────────────────────────────────────────────────── */}
        {!isSubscribed ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Usage</Text>
              <TouchableOpacity style={styles.upgradeBadge} onPress={navigateToPaywall} activeOpacity={0.8}>
                <Text style={styles.upgradeText}>Upgrade</Text>
                <Ionicons name="chevron-forward" size={12} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.usageBar}>
              <View style={[styles.usageFill, { width: `${usedPercent * 100}%` as `${number}%` }]} />
            </View>
            <Text style={styles.usageLabel}>
              {usedMinutes} / {totalMinutes} free minutes used
            </Text>
          </View>
        ) : null}

        {/* ── Stats ───────────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Ionicons name="headset" size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{episodes.length}</Text>
            <Text style={styles.statLabel}>Episodes</Text>
          </View>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Ionicons name="time-outline" size={20} color={Colors.accent} />
            <Text style={styles.statValue}>{formatDuration(totalEpisodeDuration)}</Text>
            <Text style={styles.statLabel}>Total Time</Text>
          </View>
        </View>

        {/* ── Digest settings ──────────────────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>DAILY DIGEST</Text>
          {saving ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
        </View>
        <View style={styles.card}>
          <SettingsRow
            icon="mic-outline"
            label="Voice"
            value={voiceLabel}
            onPress={handleVoicePress}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="time-outline"
            label="Delivery time"
            value={timeLabel}
            onPress={() => setShowTimePicker(true)}
          />
        </View>

        {/* ── App settings ─────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SettingsRow
            icon="information-circle-outline"
            label="App Version"
            value={APP_VERSION}
          />
        </View>

        <View style={styles.card}>
          <SettingsRow
            icon="log-out-outline"
            label={signingOut ? 'Signing out…' : 'Sign Out'}
            onPress={signingOut ? undefined : onSignOut}
            danger
            right={signingOut ? <ActivityIndicator size="small" color={Colors.danger} /> : undefined}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="trash-outline"
            label="Clear All Data"
            onPress={onClearData}
            danger
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  danger,
  right,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  const color = danger ? Colors.danger : Colors.text;
  const inner = (
    <View style={settingsStyles.row}>
      <Ionicons name={icon as any} size={20} color={danger ? Colors.danger : Colors.primary} />
      <Text style={[settingsStyles.label, { color }]}>{label}</Text>
      <View style={settingsStyles.right}>
        {right ?? (value ? <Text style={settingsStyles.value}>{value}</Text> : null)}
        {onPress && !right ? <Ionicons name="chevron-forward" size={16} color={Colors.textDim} /> : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 100 },

  profileHeader: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  avatarWrap: {
    shadowColor: Colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '700' },
  displayName: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700' },
  email: { color: Colors.textMuted, fontSize: FontSize.sm },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  proBadgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#A78BFA22',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#A78BFA44',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  proBadgeText: { color: '#A78BFA', fontSize: FontSize.xs, fontWeight: '700' },
  freeBadge: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  freeBadgeText: { color: Colors.textDim, fontSize: FontSize.xs, fontWeight: '600' },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  upgradeBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  upgradeText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
  usageBar: { height: 6, backgroundColor: Colors.border, borderRadius: 3 },
  usageFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  usageLabel: { color: Colors.textDim, fontSize: FontSize.xs },

  statsRow: { flexDirection: 'row', gap: Spacing.md },
  statCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statValue: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700' },
  statLabel: { color: Colors.textMuted, fontSize: FontSize.xs },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: -4,
  },
  sectionLabelText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: -Spacing.md,
  },

  // Time picker modal
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pickerTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '600' },
  pickerCancel: { color: Colors.textMuted, fontSize: FontSize.md },
  pickerDone: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  picker: { backgroundColor: Colors.surfaceElevated },
});

const settingsStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  label: { flex: 1, fontSize: FontSize.md, fontWeight: '500' },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  value: { color: Colors.textMuted, fontSize: FontSize.sm },
});
