import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  SectionList,
  FlatList,
  ScrollView,
  TextInput,
  Image,
  Platform,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import {
  RSS_FEEDS,
  RssFeed,
  FeedCategory,
  loadSubscriptions,
  subscribe,
  unsubscribe,
  feedImageUrl,
  loadCustomFeeds,
  addCustomFeed,
  removeCustomFeed,
  saveRssFeedToCustomList,
  searchFeedsOnline,
  getSubscribedTopicFeedUrls,
  getTopFeedsForTopic,
  getAllFeedsForTopic,
} from '../services/rssService';
import { ONBOARDING_TOPICS, normalizeTopicId } from '../services/onboarding';
import { loadOnboardingPrefs } from '../services/onboarding';
import { saveUserPreferences } from '../services/api';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

type Nav = StackNavigationProp<RootStackParamList>;
const MY_FEEDS_TAB = '__my_feeds__';

// ── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<FeedCategory, { icon: string; color: string }> = {
  news:                 { icon: 'newspaper-outline',       color: '#34D399' },
  technology:           { icon: 'hardware-chip-outline',   color: '#60A5FA' },
  'business-finance':   { icon: 'briefcase-outline',       color: '#FBBF24' },
  politics:             { icon: 'megaphone-outline',       color: '#818CF8' },
  'health-wellness':    { icon: 'heart-outline',           color: '#F87171' },
  science:              { icon: 'flask-outline',           color: '#A78BFA' },
  productivity:         { icon: 'rocket-outline',          color: '#38BDF8' },
  fitness:              { icon: 'barbell-outline',         color: '#FB923C' },
  'mental-health':      { icon: 'happy-outline',           color: '#C084FC' },
  food:                 { icon: 'restaurant-outline',      color: '#F472B6' },
  travel:               { icon: 'airplane-outline',        color: '#2DD4BF' },
  parenting:            { icon: 'people-outline',          color: '#EC4899' },
  'entertainment-news': { icon: 'star-outline',            color: '#FBBF24' },
  'movies-tv':          { icon: 'film-outline',            color: '#F472B6' },
  music:                { icon: 'musical-notes-outline',   color: '#E879F9' },
  gaming:               { icon: 'game-controller-outline', color: '#4ADE80' },
  books:                { icon: 'book-outline',            color: '#93C5FD' },
  startups:             { icon: 'bulb-outline',            color: '#FCD34D' },
  'crypto-web3':        { icon: 'logo-bitcoin',            color: '#F59E0B' },
  environment:          { icon: 'leaf-outline',            color: '#4ADE80' },
  sports:               { icon: 'trophy-outline',          color: '#FB923C' },
  Custom:               { icon: 'rss-outline',             color: '#60A5FA' },
};

function categoryMeta(category: FeedCategory): { icon: string; color: string } {
  return CATEGORY_META[category] ?? CATEGORY_META.Custom;
}

const CATEGORY_LABEL_OVERRIDES: Partial<Record<FeedCategory, string>> = {
  'business-finance': 'Business & Finance',
  'health-wellness': 'Health & Wellness',
  'mental-health': 'Mental Health',
  'entertainment-news': 'Entertainment News',
  'movies-tv': 'Movies & TV',
  'crypto-web3': 'Crypto & Web3',
};

function formatCategoryLabel(category: FeedCategory): string {
  if (category === 'Custom') return 'Custom';
  return CATEGORY_LABEL_OVERRIDES[category] ?? category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map topic ID → accent color (onboarding + legacy)
const TOPIC_CHIP_COLOR: Record<string, string> = {
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
  'ai-tech': '#60A5FA',
  world: '#34D399',
  finance: '#FBBF24',
  climate: '#4ADE80',
  culture: '#F472B6',
  health: '#F87171',
  sports: '#FB923C',
  crypto: '#F59E0B',
};

// ── Feed card ────────────────────────────────────────────────────────────────

function FeedCard({
  feed,
  subscribed,
  toggling,
  onToggle,
  onPress,
  onLongPress,
}: {
  feed: RssFeed;
  subscribed: boolean;
  toggling: boolean;
  onToggle: () => void;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const meta = categoryMeta(feed.category);
  const imgUrl = feedImageUrl(feed.url);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
      delayLongPress={400}
    >
      <View style={[styles.cardIcon, { backgroundColor: meta.color + '22' }]}>
        {imgUrl && !imgFailed ? (
          <Image
            source={{ uri: imgUrl }}
            style={styles.cardImg}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Ionicons name={meta.icon as any} size={22} color={meta.color} />
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{feed.name}</Text>
        <Text style={[styles.cardCategory, { color: meta.color }]}>
          {formatCategoryLabel(feed.category)}{feed.custom ? ' · Custom' : ''}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.toggleBtn, subscribed && styles.toggleBtnActive]}
        onPress={(e) => { e.stopPropagation?.(); onToggle(); }}
        disabled={toggling}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        {toggling ? (
          <ActivityIndicator size="small" color={subscribed ? Colors.primary : Colors.textMuted} />
        ) : (
          <Ionicons
            name={subscribed ? 'checkmark-circle' : 'add-circle-outline'}
            size={24}
            color={subscribed ? Colors.primary : Colors.textMuted}
          />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Add custom URL sheet (triggered from header icon) ────────────────────────

function AddFeedSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: (feed: RssFeed) => void;
}) {
  const [value, setValue]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const inputRef = useRef<TextInput>(null);

  // Focus input when sheet opens
  useEffect(() => {
    if (visible) {
      setError('');
      setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setValue('');
      setError('');
    }
  }, [visible]);

  const handleAdd = async () => {
    const url = value.trim();
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const feed = await addCustomFeed(url);
      setValue('');
      onAdded(feed);
      onClose();
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg === 'already_exists')  setError('This feed is already in the list.');
      else if (msg === 'not_a_feed') setError("URL doesn't look like an RSS feed.");
      else                           setError('Could not load feed. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.sheetBackdrop}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Add RSS Feed</Text>
        <TextInput
          ref={inputRef}
          style={styles.urlInput}
          value={value}
          onChangeText={(t) => { setValue(t); setError(''); }}
          placeholder="https://example.com/feed.xml"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleAdd}
        />
        {error ? <Text style={styles.addError}>{error}</Text> : null}
        <View style={styles.sheetActions}>
          <TouchableOpacity style={styles.addCancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.addCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addConfirmBtn, (!value.trim() || loading) && styles.addConfirmDisabled]}
            onPress={handleAdd}
            disabled={!value.trim() || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.bg} />
            ) : (
              <Text style={styles.addConfirmText}>Add Feed</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Online search results ─────────────────────────────────────────────────────

function OnlineResults({
  query,
  subscriptions,
  toggling,
  onToggle,
  onPress,
}: {
  query: string;
  subscriptions: string[];
  toggling: string | null;
  onToggle: (feed: RssFeed) => void;
  onPress: (feed: RssFeed) => void;
}) {
  const [results, setResults]   = useState<RssFeed[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResults([]);
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchFeedsOnline(query);
      setResults(res);
      setSearching(false);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  if (searching) {
    return (
      <View style={styles.searchingRow}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.searchingText}>Searching feeds…</Text>
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View style={styles.noResults}>
        <Text style={styles.noResultsText}>No feeds found for "{query}"</Text>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.sectionHeader}>Results</Text>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <FeedCard
            feed={item}
            subscribed={subscriptions.includes(item.id)}
            toggling={toggling === item.id}
            onToggle={() => onToggle(item)}
            onPress={() => onPress(item)}
          />
        )}
      />
    </>
  );
}

// ── Topic chip bar ────────────────────────────────────────────────────────────

function TopicChips({
  topics,
  selected,
  onSelect,
}: {
  topics: typeof ONBOARDING_TOPICS;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsContainer}
    >
      <TouchableOpacity
        style={[styles.chip, selected === MY_FEEDS_TAB && styles.chipActive]}
        onPress={() => onSelect(MY_FEEDS_TAB)}
        activeOpacity={0.75}
      >
        <Text style={[styles.chipText, selected === MY_FEEDS_TAB && styles.chipTextActive]}>My Feeds</Text>
      </TouchableOpacity>
      {topics.map((t) => {
        const isActive = selected === t.id;
        const color = TOPIC_CHIP_COLOR[t.id] ?? Colors.primary;
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.chip, isActive && { backgroundColor: color + '22', borderColor: color }]}
            onPress={() => onSelect(isActive ? MY_FEEDS_TAB : t.id)}
            activeOpacity={0.75}
          >
            <Ionicons
              name={t.icon as any}
              size={13}
              color={isActive ? color : Colors.textMuted}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.chipText, isActive && { color }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── Feed screen ──────────────────────────────────────────────────────────────

type SectionData = { title: string; data: RssFeed[] };

export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [customFeeds, setCustomFeeds]     = useState<RssFeed[]>([]);
  const [toggling, setToggling]           = useState<string | null>(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [addSheetOpen, setAddSheetOpen]   = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string>(MY_FEEDS_TAB);
  const [userTopics, setUserTopics]       = useState<typeof ONBOARDING_TOPICS>([...ONBOARDING_TOPICS]);
  const isSearching = searchQuery.trim().length > 0;

  const loadAll = useCallback(async () => {
    const [subs, custom, prefs] = await Promise.all([
      loadSubscriptions(),
      loadCustomFeeds(),
      loadOnboardingPrefs(),
    ]);
    setSubscriptions(subs);
    setCustomFeeds(custom);
    const selected = (prefs?.selectedTopics ?? []).map(normalizeTopicId);
    const selectedSet = new Set(selected);
    const first = ONBOARDING_TOPICS.filter((t) => selectedSet.has(t.id));
    const rest = ONBOARDING_TOPICS.filter((t) => !selectedSet.has(t.id));
    setUserTopics([...first, ...rest]);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleToggle = useCallback(async (feed: RssFeed) => {
    setToggling(feed.id);
    try {
      if (subscriptions.includes(feed.id)) {
        await unsubscribe(feed.id);
        setSubscriptions((prev) => prev.filter((id) => id !== feed.id));
      } else {
        // Online search results aren't in the local list yet — persist them as custom feeds
        // so they appear in "My Feeds" after the search is cleared.
        if (feed.id.startsWith('online_')) {
          await saveRssFeedToCustomList(feed);
          setCustomFeeds((prev) =>
            prev.some((f) => f.id === feed.id) ? prev : [...prev, { ...feed, custom: true }],
          );
        }
        await subscribe(feed.id);
        setSubscriptions((prev) => [...prev, feed.id]);
      }
      // Sync updated topic→feed URL mapping to server so scheduled digest uses current selection.
      getSubscribedTopicFeedUrls().then((topicFeedUrls) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        saveUserPreferences({ timezone: tz, topicFeedUrls }).catch(() => {});
      }).catch(() => {});
    } finally {
      setToggling(null);
    }
  }, [subscriptions]);

  const handleLongPress = useCallback((feed: RssFeed) => {
    if (!feed.custom) return;
    const doRemove = () => {
      void removeCustomFeed(feed.id);
      setCustomFeeds((prev) => prev.filter((f) => f.id !== feed.id));
      setSubscriptions((prev) => prev.filter((id) => id !== feed.id));
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Remove feed'], destructiveButtonIndex: 1, cancelButtonIndex: 0 },
        (i) => { if (i === 1) doRemove(); },
      );
    } else {
      Alert.alert('Remove feed', `Remove "${feed.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ]);
    }
  }, []);

  // ── Build section list ────────────────────────────────────────────────────

  const sections: SectionData[] = (() => {
    if (selectedTopic === MY_FEEDS_TAB) {
      const allFeeds = [...RSS_FEEDS, ...customFeeds];
      const subscribedFeeds = allFeeds
        .filter((f) => subscriptions.includes(f.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      return subscribedFeeds.length > 0 ? [{ title: 'My Feeds', data: subscribedFeeds }] : [];
    }

    const topicId = normalizeTopicId(selectedTopic);
    if (topicId) {
      // Topic filter: first 3 = Top Picks, rest = More channels (up to 5 total curated)
      const topicFeeds = getAllFeedsForTopic(topicId);
      const topPicks   = topicFeeds.slice(0, 3);
      const more       = topicFeeds.slice(3);
      return [
        ...(topPicks.length > 0 ? [{ title: 'Top Picks', data: topPicks }] : []),
        ...(more.length     > 0 ? [{ title: 'More channels', data: more }] : []),
      ];
    }

    return [];
  })();

  const renderFeedCard = useCallback(({ item }: { item: RssFeed }) => (
    <FeedCard
      feed={item}
      subscribed={subscriptions.includes(item.id)}
      toggling={toggling === item.id}
      onToggle={() => handleToggle(item)}
      onPress={() => navigation.navigate('FeedDetail', { feed: item })}
      onLongPress={item.custom ? () => handleLongPress(item) : undefined}
    />
  ), [subscriptions, toggling, handleToggle, handleLongPress, navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Add RSS URL sheet */}
      <AddFeedSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdded={(feed) => {
          setCustomFeeds((prev) => [...prev, feed]);
          setAddSheetOpen(false);
        }}
      />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Feed</Text>
          <TouchableOpacity
            style={styles.addIconBtn}
            onPress={() => setAddSheetOpen(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="link-outline" size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Topic filter chips */}
        <TopicChips
          topics={userTopics}
          selected={selectedTopic}
          onSelect={setSelectedTopic}
        />

        {/* Search bar */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search online for RSS feeds…"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      </View>

      {/* Body: online results OR local list */}
      {isSearching ? (
        <OnlineResults
          query={searchQuery}
          subscriptions={subscriptions}
          toggling={toggling}
          onToggle={handleToggle}
          onPress={(feed) => navigation.navigate('FeedDetail', { feed })}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              {section.title === 'Top Picks' && selectedTopic && (
                <View style={styles.topPicksBadge}>
                  <Ionicons name="star" size={10} color="#FBBF24" />
                  <Text style={styles.topPicksBadgeText}>Top 3</Text>
                </View>
              )}
            </View>
          )}
          renderItem={renderFeedCard}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '700',
  },
  addIconBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Add feed sheet (bottom sheet overlay)
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 48,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  sheetTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'flex-end',
    marginTop: Spacing.xs,
  },
  urlInput: {
    color: Colors.text,
    fontSize: FontSize.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  addError: {
    color: Colors.danger,
    fontSize: FontSize.sm,
  },
  addCancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  addCancelText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  addConfirmBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  addConfirmDisabled: {
    backgroundColor: Colors.primary + '50',
  },
  addConfirmText: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },

  // Search bar
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },

  // Topic chips
  chipsContainer: {
    paddingLeft: 0,
    paddingRight: Spacing.md,
    gap: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '18',
  },
  chipText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.primary,
  },

  // List
  listContent: { paddingBottom: 120 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
  },
  sectionHeader: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  topPicksBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FBBF2418',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  topPicksBadgeText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '700',
  },

  // Feed card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardImg: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
  },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  cardCategory: {
    fontSize: FontSize.xs,
    fontWeight: '500',
  },
  toggleBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.full,
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary + '15',
  },

  // Online search states
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
    justifyContent: 'center',
  },
  searchingText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
  },
  noResults: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  noResultsText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
  },
});
