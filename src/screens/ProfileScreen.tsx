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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { loadSession, clearSession, type AuthSession } from '../services/auth';
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

const APP_VERSION = '1.0.0';

function initials(name?: string): string {
  if (!name) return '';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function providerLabel(provider: AuthSession['provider']): string {
  if (provider === 'google') return 'Google';
  if (provider === 'apple') return 'Apple';
  return 'Guest';
}

export function ProfileScreen() {
  const { episodes, load } = useEpisodes();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
      loadSession().then(setSession);
      getTotalGeneratedSeconds().then(setUsedSeconds);
      getIsSubscribed().then(setIsSubscribed);
    }, [load]),
  );

  const totalEpisodeDuration = episodes.reduce((acc, e) => acc + e.durationSeconds, 0);
  const usedMinutes = Math.floor(usedSeconds / 60);
  const totalMinutes = FREE_LIMIT_SECONDS / 60;
  const usedPercent = Math.min(1, usedSeconds / FREE_LIMIT_SECONDS);

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
      'This will permanently delete all episodes and reset your account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything',
          style: 'destructive',
          onPress: async () => {
            await clearAllEpisodes();
            await clearLocalData();
            await clearSession();
            resetToOnboarding();
          },
        },
      ],
    );
  };

  const avatarInitials = initials(session?.displayName);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
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
            {session && (
              <View style={styles.providerBadge}>
                <Text style={styles.providerText}>{providerLabel(session.provider)}</Text>
              </View>
            )}
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

        {/* ── Subscription ───────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Usage</Text>
            {isSubscribed ? (
              <View style={styles.proBadge}>
                <Ionicons name="sparkles" size={11} color="#A78BFA" />
                <Text style={styles.proText}>Pro</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.upgradeBadge} onPress={navigateToPaywall} activeOpacity={0.8}>
                <Text style={styles.upgradeText}>Upgrade</Text>
                <Ionicons name="chevron-forward" size={12} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.usageBar}>
            <View style={[styles.usageFill, { width: `${usedPercent * 100}%` as `${number}%` }]} />
          </View>
          <Text style={styles.usageLabel}>
            {isSubscribed ? 'Unlimited' : `${usedMinutes} / ${totalMinutes} free minutes used`}
          </Text>
        </View>

        {/* ── Stats ──────────────────────────────────────────────────────── */}
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

        {/* ── Settings ───────────────────────────────────────────────────── */}
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
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  avatarFallback: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: Colors.primary,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  displayName: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  email: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 2,
  },
  providerBadge: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  providerText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
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
  proBadgeText: {
    color: '#A78BFA',
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  freeBadge: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  freeBadgeText: {
    color: Colors.textDim,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#A78BFA22',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proText: {
    color: '#A78BFA',
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  upgradeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  upgradeText: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  usageBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
  },
  usageFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  usageLabel: {
    color: Colors.textDim,
    fontSize: FontSize.xs,
  },

  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  statCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statValue: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: -Spacing.md,
  },
});

const settingsStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
  },
  label: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  value: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
});
