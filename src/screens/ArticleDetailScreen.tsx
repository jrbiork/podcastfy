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
  Linking,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
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
  'crypto-web3': '#F59E0B',
  environment: '#4ADE80',
  sports: '#FB923C',
  Custom: '#60A5FA',
};

export function ArticleDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { item, feed } = params;

  const [feedImgFailed, setFeedImgFailed] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const color   = CATEGORY_COLORS[feed.category] ?? Colors.primary;
  const feedImg = feedImageUrl(feed.url);

  const handleBrowser = useCallback(() => {
    void Linking.openURL(item.link);
  }, [item.link]);

  const bodyText = item.fullDescription?.trim() || item.description?.trim();

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

        {/* Spacer to mirror back button width */}
        <View style={styles.backBtn} />
      </View>

      {/* Scrollable article body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
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

        {/* Body text — digest summaries and RSS excerpts */}
        {bodyText ? (
          <Text style={styles.body}>{bodyText}</Text>
        ) : null}

        <View style={{ height: 96 }} />
      </ScrollView>

      {/* Sticky action bar */}
      <View style={styles.actions}>
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
