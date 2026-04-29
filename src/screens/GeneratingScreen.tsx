import React, { useEffect, useRef, useState } from 'react';
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
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize } from '../utils/theme';
import { startGeneration } from '../services/generationService';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Route = RouteProp<RootStackParamList, 'Generating'>;
type Nav = StackNavigationProp<RootStackParamList, 'Generating'>;

const STEPS = [
  'Fetching content',
  'Writing script',
  'Generating audio',
  'Saving episode',
];

const STEP_DURATION_MS = 1200;

function goToLibrary(navigation: Nav) {
  navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'Main',
          state: {
            index: 1,
            routes: [{ name: 'HomeTab' }, { name: 'LibraryTab' }],
          },
        },
      ],
    }),
  );
}

export function GeneratingScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { input, mode } = route.params;

  const [animStep, setAnimStep] = useState(0);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ).start();

    // Fire-and-forget: generation runs fully in background
    startGeneration(input, mode);

    // Cycle through steps visually, then navigate to Library
    let step = 0;
    const advance = () => {
      step += 1;
      if (step < STEPS.length) {
        setAnimStep(step);
        timer = setTimeout(advance, STEP_DURATION_MS);
      } else {
        goToLibrary(navigation);
      }
    };
    let timer = setTimeout(advance, STEP_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <View style={styles.content}>
        <Text style={styles.title}>Working on it…</Text>
        <Text style={styles.subtitle}>
          You'll see it in your Library when it's ready.
        </Text>

        <View style={styles.steps}>
          {STEPS.map((label, i) => {
            const isDone = animStep > i;
            const isActive = animStep === i;
            return (
              <View key={label} style={styles.stepRow}>
                {isDone ? (
                  <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                ) : isActive ? (
                  <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <Ionicons name="sync" size={22} color={Colors.primary} />
                  </Animated.View>
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={Colors.textDim} />
                )}
                <Text
                  style={[
                    styles.stepLabel,
                    isDone && styles.stepDone,
                    isActive && styles.stepActive,
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity onPress={() => goToLibrary(navigation)} activeOpacity={0.7}>
          <Text style={styles.skipText}>Go to Library now</Text>
        </TouchableOpacity>
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
    gap: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  steps: { width: '100%', gap: Spacing.md, marginTop: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepLabel: { color: Colors.textDim, fontSize: FontSize.md, flex: 1 },
  stepActive: { color: Colors.text, fontWeight: '600' },
  stepDone: { color: Colors.textMuted },
  skipText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
  },
});
