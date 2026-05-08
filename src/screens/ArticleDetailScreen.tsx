import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useProgress } from 'react-native-track-player';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { formatRelativeDate } from '../utils/format';
import { feedImageUrl } from '../services/rssService';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Route = RouteProp<RootStackParamList, 'ArticleDetail'>;
type Nav   = StackNavigationProp<RootStackParamList, 'ArticleDetail'>;

const CATEGORY_COLORS: Record<string, string> = {
  news: '#34D399',
  technology: '#60A5FA',
  economy: '#F59E0B',
  'business-finance': '#FBBF24',
  politics: '#818CF8',
  'health-wellness': '#F87171',
  science: '#A78BFA',
  productivity: '#38BDF8',
  fitness: '#FB923C',
  'mental-health': '#C084FC',
  food: '#F472B6',
  travel: '#2DD4BF',
  parenting: '#EC4899',
  'entertainment-news': '#FBBF24',
  'movies-tv': '#F472B6',
  music: '#E879F9',
  gaming: '#4ADE80',
  books: '#93C5FD',
  startups: '#FCD34D',
  crypto: '#F59E0B',
  environment: '#4ADE80',
  sports: '#FB923C',
  Custom: '#60A5FA',
};

export function ArticleDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [feedImgFailed, setFeedImgFailed] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const progress = useProgress(500);
  const positionMs = Math.floor(progress.position * 1000);

  // All hooks above — safe to early-return now
  const params = route.params;
  if (!params?.item || !params?.feed) return null;

  const { item, feed, allItems, currentIndex } = params;

  const isBeingRead =
    item.audioStartMs !== undefined &&
    item.audioEndMs !== undefined &&
    positionMs >= item.audioStartMs &&
    positionMs < item.audioEndMs;

  const color   = CATEGORY_COLORS[feed.category] ?? Colors.primary;
  const feedImg = feedImageUrl(feed.url);

  const bodyText = item.fullDescription?.trim() || item.description?.trim();

  const hasPrev = allItems != null && currentIndex != null && currentIndex > 0;
  const hasNext = allItems != null && currentIndex != null && currentIndex < allItems.length - 1;

  const handleBrowser = () => { void Linking.openURL(item.link); };

  const handlePrev = () => {
    if (!allItems || currentIndex == null || currentIndex <= 0) return;
    navigation.setParams({ item: allItems[currentIndex - 1], currentIndex: currentIndex - 1 });
  };

  const handleNext = () => {
    if (!allItems || currentIndex == null || currentIndex >= allItems.length - 1) return;
    navigation.setParams({ item: allItems[currentIndex + 1], currentIndex: currentIndex + 1 });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Feed pill */}
        <View style={styles.feedPill}>
          {feedImg && !feedImgFailed ? (
            <Image
              source={{ uri: feedImg }}
              style={styles.feedPillImg}
              onError={() => setFeedImgFailed(true)}
            />
          ) : (
            <Ionicons name="radio-outline" size={14} color={color} />
          )}
          <Text style={[styles.feedPillName, { color }]} numberOfLines={1}>{feed.name}</Text>
        </View>

        {/* Spacer */}
        <View style={styles.backBtn} />
      </View>

      {/* Scrollable article body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Article content — blue border when this story is being narrated */}
        <View style={[styles.articleContent, isBeingRead && styles.articleContentActive]}>
          {/* Category chip */}
          <View style={[styles.chip, { backgroundColor: color + '22' }]}>
            <Text style={[styles.chipText, { color }]}>{feed.category}</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>{item.title}</Text>

          {/* Date */}
          {item.pubDate ? (
            <Text style={styles.date}>{formatRelativeDate(item.pubDate)}</Text>
          ) : null}

          {/* Hero image */}
          {item.imageUrl && !heroImgFailed ? (
            <Image
              source={{ uri: item.imageUrl }}
              style={styles.hero}
              resizeMode="cover"
              onError={() => setHeroImgFailed(true)}
            />
          ) : null}

          {/* Body text */}
          {bodyText ? (
            <Text style={styles.body}>{bodyText}</Text>
          ) : null}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky action bar */}
      <View style={styles.actions}>
        {/* Prev / Next row */}
        {allItems != null && allItems.length > 1 && (
          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={handlePrev}
              disabled={!hasPrev}
              activeOpacity={0.7}
              style={styles.navBtn}
            >
              <Ionicons name="chevron-back-circle" size={32} color={hasPrev ? Colors.primary : Colors.textDim} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNext}
              disabled={!hasNext}
              activeOpacity={0.7}
              style={styles.navBtn}
            >
              <Ionicons name="chevron-forward-circle" size={32} color={hasNext ? Colors.primary : Colors.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {/* Open in browser */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryOutlineBtn]}
          onPress={handleBrowser}
          activeOpacity={0.8}
        >
          <Ionicons name="open-outline" size={18} color={Colors.primary} />
          <Text style={[styles.actionText, { color: Colors.primary }]}>Open in Browser</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 72,
    minHeight: 44,
  },
  backText: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  feedPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  feedPillImg: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  feedPillName: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    maxWidth: 180,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
  },

  articleContent: {
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  articleContentActive: {
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: 'rgba(96, 165, 250, 0.05)',
  },

  chip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    marginBottom: Spacing.sm,
  },
  chipText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: Spacing.sm,
  },
  date: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginBottom: Spacing.lg,
  },
  hero: {
    width: '100%',
    height: 200,
    borderRadius: Radius.md,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  body: {
    color: Colors.text,
    fontSize: FontSize.md,
    lineHeight: 26,
  },

  // Action bar
  actions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 32,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navBtn: {
    padding: 4,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  primaryOutlineBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionText: {
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});
