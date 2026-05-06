import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import type { RootStackParamList } from '../navigation/rootNavigationRef';
import { useState } from 'react';

type Route = RouteProp<RootStackParamList, 'ModePicker'>;
type Nav = StackNavigationProp<RootStackParamList, 'ModePicker'>;

export function ModePickerScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { input } = route.params;
  const [checking, setChecking] = useState(false);

  const pick = async (mode: 'podcast' | 'tts') => {
    setChecking(true);
    try {
      navigation.replace('Generating', { input, mode });
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="close" size={24} color={Colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>How would you like to listen?</Text>
        <Text style={styles.subtitle}>Choose a format for your episode</Text>

        {checking ? (
          <ActivityIndicator color={Colors.primary} size="large" />
        ) : (
          <View style={styles.cards}>
            <TouchableOpacity
              style={styles.card}
              onPress={() => pick('podcast')}
              activeOpacity={0.85}
            >
              <View style={[styles.cardIcon, { backgroundColor: Colors.primary + '22' }]}>
                <Ionicons name="mic" size={28} color={Colors.primary} />
              </View>
              <Text style={styles.cardTitle}>Audio Style</Text>
              <Text style={styles.cardDesc}>
                AI rewrites the article as a lively 2-speaker dialogue with Host &amp; Guest
              </Text>
              <View style={styles.cardBadge}>
                <Ionicons name="sparkles" size={12} color={Colors.primary} />
                <Text style={styles.cardBadgeText}>~30s • More engaging</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.card}
              onPress={() => pick('tts')}
              activeOpacity={0.85}
            >
              <View style={[styles.cardIcon, { backgroundColor: Colors.accent + '22' }]}>
                <Ionicons name="document-text" size={28} color={Colors.accent} />
              </View>
              <Text style={styles.cardTitle}>Text to Speech</Text>
              <Text style={styles.cardDesc}>
                Article read aloud, word for word, by a single narrator voice
              </Text>
              <View style={styles.cardBadge}>
                <Ionicons name="flash" size={12} color={Colors.accent} />
                <Text style={[styles.cardBadgeText, { color: Colors.accent }]}>~10s • Faster</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center', marginTop: -Spacing.sm },
  cards: { gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  cardTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '700' },
  cardDesc: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },
  cardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
  },
  cardBadgeText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '600' },
});
