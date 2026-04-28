import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useGenerate, GenerateStep } from '../hooks/useGenerate';
import { useEpisodes } from '../hooks/useEpisodes';
import { hasReachedFreeLimit } from '../services/subscription';
import type { RootStackParamList } from '../navigation/rootNavigationRef';
import { navigateToPaywall } from '../navigation/rootNavigationRef';

type Route = RouteProp<RootStackParamList, 'Generating'>;
type Nav = StackNavigationProp<RootStackParamList, 'Generating'>;

const STEPS: { key: GenerateStep; label: string }[] = [
  { key: 'processing', label: 'Fetching article' },
  { key: 'scripting', label: 'Writing script' },
  { key: 'generating_audio', label: 'Generating audio' },
  { key: 'downloading', label: 'Saving episode' },
];

const ERROR_MESSAGES: Record<string, string> = {
  cloudflare_blocked: "This site uses bot protection. Try pasting the article text instead.",
  scrape_failed: "Couldn't read this page. Check the URL or paste the text.",
  article_too_short: "Not enough content to create a podcast.",
  scrape_timeout: "The page took too long to load. Try again.",
  script_failed: "Script generation failed. Please try again.",
  tts_failed: "Audio generation failed. Please try again.",
  timeout: "This is taking longer than expected. Please try again.",
  download_failed: "Download failed. Please try again.",
  not_enough_storage: "Not enough storage on your device.",
  auth_expired: "Session expired. Please sign in again.",
  not_signed_in: "You're not signed in. Please sign in with Google first.",
  network_error: "Could not reach the API. Check EXPO_PUBLIC_API_BASE and your network.",
  missing_api_base: "API base URL is missing. Set EXPO_PUBLIC_API_BASE in .env.",
  unknown_error: "Something went wrong. Please try again.",
};

function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown_error;
}

function isCloudflareError(code: string): boolean {
  return code === 'cloudflare_blocked';
}

export function GeneratingScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { input, mode } = route.params;
  const { state, isGenerating, generate } = useGenerate();
  const { add } = useEpisodes();
  const spinAnim = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    ).start();

    generate(input, mode, async (episode) => {
      await add(episode);
      navigation.replace('Player', { episode });

      // Check if paywall should be shown after navigating to Player
      const reachedLimit = await hasReachedFreeLimit();
      if (reachedLimit) {
        setTimeout(() => navigateToPaywall(), 600);
      }
    });
  }, []);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const currentStepIndex = STEPS.findIndex((s) => s.key === state.step);
  const isDone = state.step === 'done';
  const isError = state.step === 'error';

  const onRetry = () => {
    navigation.goBack();
  };

  const onSwitchToText = () => {
    // Pop back through ModePicker to Home, which will show CF banner
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <View style={styles.content}>
        <Text style={styles.title}>
          {isError ? 'Something went wrong' : isDone ? 'Episode ready!' : 'Creating your episode…'}
        </Text>
        <Text style={styles.subtitle}>
          {isError ? '' : 'Keep Podcastify open while we work'}
        </Text>

        {!isError && (
          <View style={styles.steps}>
            {STEPS.map((step, i) => {
              const isActive = step.key === state.step;
              const isDoneStep = currentStepIndex > i || isDone;
              return (
                <View key={step.key} style={styles.stepRow}>
                  {isDoneStep ? (
                    <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
                  ) : isActive ? (
                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                      <Ionicons name="sync" size={24} color={Colors.primary} />
                    </Animated.View>
                  ) : (
                    <Ionicons name="ellipse-outline" size={24} color={Colors.textDim} />
                  )}
                  <Text
                    style={[
                      styles.stepLabel,
                      isDoneStep && styles.stepDone,
                      isActive && styles.stepActive,
                    ]}
                  >
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {isError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={48} color={Colors.danger} />
            <Text style={styles.errorText}>{getErrorMessage(state.error ?? 'unknown_error')}</Text>

            <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>

            {isCloudflareError(state.error ?? '') && (
              <TouchableOpacity style={styles.switchBtn} onPress={onSwitchToText} activeOpacity={0.7}>
                <Text style={styles.switchBtnText}>Switch to Paste Text</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xl,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center', marginTop: -Spacing.md },
  steps: { width: '100%', gap: Spacing.md, marginTop: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepLabel: { color: Colors.textDim, fontSize: FontSize.md, flex: 1 },
  stepActive: { color: Colors.text, fontWeight: '600' },
  stepDone: { color: Colors.textMuted },
  errorBox: { alignItems: 'center', gap: Spacing.lg },
  errorText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
  },
  retryBtnText: { color: Colors.bg, fontSize: FontSize.md, fontWeight: '700' },
  switchBtn: { paddingVertical: Spacing.sm },
  switchBtnText: { color: Colors.primary, fontSize: FontSize.sm },
});
