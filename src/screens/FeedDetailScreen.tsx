import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { formatRelativeDate } from '../utils/format';
import {
  RssFeed,
  ExtendedRssItem,
  feedImageUrl,
  fetchFeedPage,
  loadSubscriptions,
  subscribe,
  unsubscribe,
} from '../services/rssService';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Route = RouteProp<RootStackParamList, 'FeedDetail'>;
type Nav   = StackNavigationProp<RootStackParamList, 'FeedDetail'>;

const PAGE_SIZE = 20;

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

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({
  item,
  onPress,
}: {
  item: ExtendedRssItem;
  onPress: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <TouchableOpacity style={card.row} onPress={onPress} activeOpacity={0.75}>
      {/* Thumbnail */}
      <View style={card.thumbWrap}>
        {item.imageUrl && !imgFailed ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={card.thumb}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={[card.thumb, card.thumbPlaceholder]}>
            <Ionicons name="document-text-outline" size={22} color={Colors.textMuted} />
          </View>
        )}
      </View>

      {/* Text */}
      <View style={card.textWrap}>
        <Text style={card.title} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={card.description} numberOfLines={2}>{item.description}</Text>
        ) : null}
        {item.pubDate ? (
          <Text style={card.date}>{formatRelativeDate(item.pubDate)}</Text>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={card.chevron} />
    </TouchableOpacity>
  );
}

// ── Feed detail screen ────────────────────────────────────────────────────────

export function FeedDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { feed } = params;

  const [items, setItems]             = useState<ExtendedRssItem[]>([]);
  const [hasMore, setHasMore]         = useState(true);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [subscribed, setSubscribed]   = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [imgFailed, setImgFailed]     = useState(false);
  const pageRef = useRef(0);

  // Load subscription state
  useEffect(() => {
    loadSubscriptions().then((subs) => setSubscribed(subs.includes(feed.id)));
  }, [feed.id]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchFeedPage(feed.url, 0, PAGE_SIZE)
      .then(({ items: newItems, hasMore: more }) => {
        setItems(newItems);
        setHasMore(more);
        pageRef.current = 0;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [feed.url]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    fetchFeedPage(feed.url, nextPage, PAGE_SIZE)
      .then(({ items: newItems, hasMore: more }) => {
        setItems((prev) => [...prev, ...newItems]);
        setHasMore(more);
        pageRef.current = nextPage;
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [feed.url, hasMore, loadingMore]);

  const handleSubscribeToggle = useCallback(async () => {
    setSubscribing(true);
    try {
      if (subscribed) {
        await unsubscribe(feed.id);
        setSubscribed(false);
      } else {
        await subscribe(feed.id);
        setSubscribed(true);
      }
    } finally {
      setSubscribing(false);
    }
  }, [feed.id, subscribed]);

  const color  = CATEGORY_COLORS[feed.category] ?? Colors.primary;
  const imgUrl = feedImageUrl(feed.url);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          <Text style={styles.backText}>Feed</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          {imgUrl && !imgFailed ? (
            <Image
              source={{ uri: imgUrl }}
              style={styles.feedImg}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <View style={[styles.feedImg, styles.feedImgPlaceholder]}>
              <Ionicons name="radio-outline" size={28} color={color} />
            </View>
          )}
          <Text style={styles.feedName} numberOfLines={1}>{feed.name}</Text>
        </View>

        <TouchableOpacity
          style={[styles.subBtn, subscribed && styles.subBtnActive]}
          onPress={handleSubscribeToggle}
          disabled={subscribing}
          activeOpacity={0.75}
        >
          {subscribing ? (
            <ActivityIndicator size="small" color={subscribed ? Colors.primary : Colors.textMuted} />
          ) : (
            <Ionicons
              name={subscribed ? 'checkmark-circle' : 'add-circle-outline'}
              size={22}
              color={subscribed ? Colors.primary : Colors.textMuted}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.guid}
          renderItem={({ item }) => (
            <ArticleCard
              item={item}
              onPress={() => navigation.navigate('ArticleDetail', { item, feed })}
            />
          )}
          contentContainerStyle={styles.listContent}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="newspaper-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No articles found</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />
      )}
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
    gap: Spacing.sm,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 70,
    minHeight: 44,
  },
  backText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  feedImg: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  feedImgPlaceholder: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
    flex: 1,
  },
  subBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.full,
  },
  subBtnActive: {
    backgroundColor: Colors.primary + '15',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
  },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.md },
  listContent: { paddingBottom: 120 },
  footer: { paddingVertical: Spacing.lg, alignItems: 'center' },
});

const card = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  thumbWrap: {
    flexShrink: 0,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: Radius.sm,
  },
  thumbPlaceholder: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
    lineHeight: 20,
  },
  description: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  date: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  chevron: {
    marginTop: 2,
    flexShrink: 0,
  },
});
