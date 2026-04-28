import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'headset' as const,
    title: 'Turn any article into a podcast',
    body: 'Share a URL or paste text — Podcastify converts it into an audio episode you can listen to anywhere.',
  },
  {
    icon: 'share-social' as const,
    title: 'Share from any app',
    body: 'Use the iOS share sheet from Safari, Chrome, or any app to instantly send articles to Podcastify.',
  },
  {
    icon: 'cloud-offline' as const,
    title: 'Listen anywhere, offline',
    body: 'Episodes are saved on your device. Play them on your commute, at the gym, or with no WiFi.',
  },
];

type Props = {
  onComplete: () => void | Promise<void>;
};

export function OnboardingScreen({ onComplete }: Props) {
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setIndex(Math.round(x / SCREEN_WIDTH));
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {!isLast && (
        <TouchableOpacity style={styles.skip} onPress={() => onComplete()} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.page, { width: SCREEN_WIDTH }]}>
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={52} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        {isLast ? (
          <TouchableOpacity style={styles.cta} onPress={() => onComplete()} activeOpacity={0.85}>
            <Text style={styles.ctaText}>Get Started</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.next}
            onPress={() =>
              listRef.current?.scrollToIndex({ index: index + 1, animated: true })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.nextText}>Next</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  skip: {
    position: 'absolute',
    top: 56,
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  skipText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '500' },
  page: {
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  iconWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.primary + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  body: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 22 },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { color: Colors.bg, fontSize: FontSize.md, fontWeight: '700' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 14,
  },
  nextText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
});
