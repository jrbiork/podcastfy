import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import {
  initPurchases,
  isPurchasesConfigured,
  purchaseOffering,
  restorePurchases,
} from '../services/subscription';
import { loadSession } from '../services/auth';
import type { RootStackParamList } from '../navigation/rootNavigationRef';
import { Analytics } from '../services/analytics';

type Nav = StackNavigationProp<RootStackParamList, 'Paywall'>;

const BENEFITS = [
  'Unlimited audio generation',
  'Unlimited text-to-speech',
  'All future features included',
];

function packageLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'WEEKLY': return 'Weekly';
    case 'MONTHLY': return 'Monthly';
    case 'ANNUAL': return 'Annual';
    default: return pkg.product.title || 'Subscription';
  }
}

function packageBadge(pkg: PurchasesPackage): string | null {
  if (pkg.packageType === 'ANNUAL') return 'Best Value';
  return null;
}

export function PaywallScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);

  useEffect(() => { void Analytics.paywallShown('hard'); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession().catch(() => null);

      await initPurchases(session?.userId).catch(() => {});

      if (!isPurchasesConfigured() || cancelled) {
        setLoading(false);
        return;
      }

      try {
        const offerings = await Purchases.getOfferings();
        const pkgs = offerings.current?.availablePackages ?? [];
        if (!cancelled) {
          setPackages(pkgs);
          // Default select monthly, or first available
          const monthly = pkgs.find((p) => p.packageType === 'MONTHLY') ?? pkgs[0] ?? null;
          setSelected(monthly);
        }
      } catch {
        // No packages loaded — show generic UI
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSubscribe = async () => {
    if (!selected) return;
    setError(null);
    setActionLoading(true);
    void Analytics.paywallSubscribeTapped(selected.packageType, selected.product.priceString);
    try {
      const ok = await purchaseOffering(selected);
      if (ok) {
        void Analytics.subscriptionStarted(selected.identifier);
        navigation.goBack();
      } else {
        void Analytics.purchaseFailed(selected.packageType, 'entitlement_inactive');
        setError('Purchase completed but subscription not active. Check RevenueCat entitlement.');
      }
    } catch (e: unknown) {
      void Analytics.purchaseFailed(selected.packageType, e instanceof Error ? e.message : 'unknown');
      setError(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setActionLoading(false);
    }
  };

  const onRestore = async () => {
    setError(null);
    setActionLoading(true);
    void Analytics.restoreTapped();
    try {
      const ok = await restorePurchases();
      if (ok) {
        void Analytics.restoreSuccess();
        navigation.goBack();
      } else {
        void Analytics.restoreFailed('no_active_subscription');
        setError('No active subscription found to restore.');
      }
    } catch (e: unknown) {
      void Analytics.restoreFailed(e instanceof Error ? e.message : 'unknown');
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.close} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="close" size={24} color={Colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={36} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Unlock Unlimited</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((line) => (
            <View key={line} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
              <Text style={styles.benefitText}>{line}</Text>
            </View>
          ))}
        </View>

        {/* Package selector */}
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
        ) : packages.length > 0 ? (
          <View style={styles.packageList}>
            {packages.map((pkg) => {
              const isSelected = selected?.identifier === pkg.identifier;
              const badge = packageBadge(pkg);
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[styles.packageCard, isSelected && styles.packageCardSelected]}
                  onPress={() => setSelected(pkg)}
                  activeOpacity={0.8}
                >
                  {badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                  <View style={styles.packageInfo}>
                    <Text style={[styles.packageLabel, isSelected && styles.packageLabelSelected]}>
                      {packageLabel(pkg)}
                    </Text>
                    <Text style={styles.packagePrice}>{pkg.product.priceString}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <Text style={styles.noPackages}>Configure your RevenueCat offerings to display plans here.</Text>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, (actionLoading || !selected) && styles.btnDisabled]}
          onPress={onSubscribe}
          disabled={actionLoading || !selected}
          activeOpacity={0.85}
        >
          {actionLoading ? (
            <ActivityIndicator color={Colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>
              {selected ? `Subscribe — ${selected.product.priceString}` : 'Subscribe'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.restoreBtn} onPress={onRestore} disabled={actionLoading}>
          <Text style={styles.restoreBtnText}>Restore purchases</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.legal}>
          Payment charged to your Apple ID. Manage or cancel in Settings &gt; Subscriptions.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, paddingBottom: 40, gap: Spacing.lg },
  close: { alignSelf: 'flex-end', padding: Spacing.sm },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary + '1A',
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
  },
  benefits: { gap: Spacing.sm },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { color: Colors.text, fontSize: FontSize.md, flex: 1 },
  packageList: { gap: Spacing.sm },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    position: 'relative',
  },
  packageCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: Colors.bg, fontSize: 10, fontWeight: '700' },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterSelected: { borderColor: Colors.primary },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  packageInfo: { flex: 1 },
  packageLabel: { color: Colors.textMuted, fontSize: FontSize.md, fontWeight: '600' },
  packageLabelSelected: { color: Colors.text },
  packagePrice: { color: Colors.textMuted, fontSize: FontSize.sm },
  noPackages: { color: Colors.textDim, fontSize: FontSize.sm, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: Colors.bg, fontSize: FontSize.md, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  restoreBtn: { paddingVertical: 12, alignItems: 'center' },
  restoreBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  error: { color: Colors.danger, fontSize: FontSize.sm, textAlign: 'center' },
  legal: {
    color: Colors.textDim,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
});
