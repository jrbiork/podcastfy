import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOPIC_FEED_URLS_BY_ID } from '../data/topicFeedMap';
import { startRssGeneration } from './generationService';

// ── Types ────────────────────────────────────────────────────────────────────

export type FeedCategory =
  | 'news'
  | 'technology'
  | 'business-finance'
  | 'politics'
  | 'health-wellness'
  | 'science'
  | 'productivity'
  | 'fitness'
  | 'mental-health'
  | 'food'
  | 'travel'
  | 'parenting'
  | 'entertainment-news'
  | 'movies-tv'
  | 'music'
  | 'gaming'
  | 'books'
  | 'startups'
  | 'crypto-web3'
  | 'environment'
  | 'sports'
  | 'Custom';

export interface RssFeed {
  id: string;
  name: string;
  url: string;
  category: FeedCategory;
  custom?: boolean;
}

/** Internal item used by pollFeed — includes description for text-mode dispatch. */
interface RssItem {
  title: string;
  link: string;
  guid: string;
  description?: string;
}

/** Rich item used by FeedDetailScreen and ArticleDetailScreen. */
export interface ExtendedRssItem {
  title: string;
  link: string;
  guid: string;
  /** Short excerpt (≤300 chars) shown in the article list. */
  description?: string;
  /** Full body text (≤10000 chars), from content:encoded when available. Used for TTS generation. */
  fullDescription?: string;
  imageUrl?: string;
  pubDate?: string;
}

// ── Predefined feeds ─────────────────────────────────────────────────────────
// One row per unique feed URL (used for subscriptions + topic→URL resolution).

export const RSS_FEEDS: RssFeed[] = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'news' },
  { id: 'npr', name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', category: 'news' },
  { id: 'guardian', name: 'The Guardian (World)', url: 'https://www.theguardian.com/world/rss', category: 'news' },
  { id: 'axios', name: 'Axios', url: 'https://api.axios.com/feed/', category: 'news' },
  { id: 'reuters_world', name: 'Reuters World', url: 'https://feeds.reuters.com/reuters/worldNews', category: 'news' },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'technology' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'technology' },
  { id: 'wired', name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'technology' },
  { id: 'ars', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'technology' },
  { id: 'mit', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'technology' },
  { id: 'wsj', name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml', category: 'business-finance' },
  { id: 'bloomberg', name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'business-finance' },
  { id: 'hbr', name: 'Harvard Business Review', url: 'https://feeds.feedburner.com/HarvardBusiness', category: 'business-finance' },
  { id: 'reuters_biz', name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', category: 'business-finance' },
  { id: 'nytimes_biz', name: 'NY Times Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', category: 'business-finance' },
  { id: 'politico', name: 'Politico', url: 'https://www.politico.com/rss/politicopicks.xml', category: 'politics' },
  { id: 'guardian_pol', name: 'Guardian Politics', url: 'https://www.theguardian.com/politics/rss', category: 'politics' },
  { id: 'npr_politics', name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml', category: 'politics' },
  { id: 'atlantic', name: 'The Atlantic', url: 'https://www.theatlantic.com/feed/all/', category: 'politics' },
  { id: 'bbchealth', name: 'BBC Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml', category: 'health-wellness' },
  { id: 'nprhealth', name: 'NPR Health', url: 'https://feeds.npr.org/1128/rss.xml', category: 'health-wellness' },
  { id: 'healthline', name: 'Healthline', url: 'https://www.healthline.com/rss/health-news', category: 'health-wellness' },
  { id: 'stat_news', name: 'STAT News', url: 'https://www.statnews.com/feed/', category: 'health-wellness' },
  { id: 'nytimes_health', name: 'NY Times Health', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml', category: 'health-wellness' },
  { id: 'sciam', name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', category: 'science' },
  { id: 'guardian_science', name: 'Guardian Science', url: 'https://www.theguardian.com/science/rss', category: 'science' },
  { id: 'sciencedaily', name: 'Science Daily', url: 'https://www.sciencedaily.com/rss/all.rss', category: 'science' },
  { id: 'newscientist', name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', category: 'science' },
  { id: 'lifehacker', name: 'Lifehacker', url: 'https://lifehacker.com/rss', category: 'productivity' },
  { id: 'zenhabits', name: 'Zen Habits', url: 'https://zenhabits.net/feed/', category: 'productivity' },
  { id: 'tim_blog', name: 'Tim Ferriss', url: 'https://tim.blog/feed/', category: 'productivity' },
  { id: 'productivityist', name: 'Productivityist', url: 'https://www.productivityist.com/feed/', category: 'productivity' },
  { id: 'fastco', name: 'Fast Company', url: 'https://www.fastcompany.com/latest/rss', category: 'productivity' },
  { id: 'menshealth', name: "Men's Health", url: 'https://www.menshealth.com/rss/all.xml/', category: 'fitness' },
  { id: 'runnersworld', name: "Runner's World", url: 'https://www.runnersworld.com/rss/all/index.xml', category: 'fitness' },
  { id: 'shape', name: 'Shape', url: 'https://www.shape.com/feeds/all.xml', category: 'fitness' },
  { id: 'self_mag', name: 'SELF', url: 'https://www.self.com/feed/self-atom.xml', category: 'fitness' },
  { id: 'nerdfitness', name: 'Nerd Fitness', url: 'https://www.nerdfitness.com/blog/feed/', category: 'fitness' },
  { id: 'guardian_mental_health', name: 'Guardian Mental Health', url: 'https://www.theguardian.com/society/mental-health/rss', category: 'mental-health' },
  { id: 'sciencedaily_mental_health', name: 'ScienceDaily Mental Health', url: 'https://www.sciencedaily.com/rss/mind_brain/mental_health.xml', category: 'mental-health' },
  { id: 'medlineplus_depression', name: 'MedlinePlus (Depression)', url: 'https://medlineplus.gov/feeds/topics/depression.xml', category: 'mental-health' },
  { id: 'stat_health', name: 'STAT Health', url: 'https://www.statnews.com/category/health/feed/', category: 'mental-health' },
  { id: 'smitten_kitchen', name: 'Smitten Kitchen', url: 'https://www.smittenkitchen.com/feed/', category: 'food' },
  { id: 'bonappetit', name: 'Bon Appétit', url: 'https://www.bonappetit.com/feed/rss', category: 'food' },
  { id: 'eater', name: 'Eater', url: 'https://www.eater.com/rss/index.xml', category: 'food' },
  { id: 'epicurious', name: 'Epicurious', url: 'https://www.epicurious.com/services/rss/recipes/new', category: 'food' },
  { id: 'food52', name: 'Food52', url: 'https://food52.com/blog.rss', category: 'food' },
  { id: 'cntraveler', name: 'Condé Nast Traveler', url: 'https://www.cntraveler.com/feed/rss', category: 'travel' },
  { id: 'skift', name: 'Skift', url: 'https://skift.com/feed/', category: 'travel' },
  { id: 'bbc_travel', name: 'BBC Travel', url: 'https://www.bbc.com/travel/feed.rss', category: 'travel' },
  { id: 'travel_leisure', name: 'Travel + Leisure', url: 'https://www.travelandleisure.com/feeds/syndication/rss_latest.xml', category: 'travel' },
  { id: 'nytimes_travel', name: 'NY Times Travel', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml', category: 'travel' },
  { id: 'parents_mag', name: 'Parents', url: 'https://www.parents.com/feeds/all', category: 'parenting' },
  { id: 'babycenter', name: 'BabyCenter', url: 'https://www.babycenter.com/rss/baby/', category: 'parenting' },
  { id: 'todaysparent', name: "Today's Parent", url: 'https://www.todaysparent.com/feed/', category: 'parenting' },
  { id: 'fatherly', name: 'Fatherly', url: 'https://www.fatherly.com/feed', category: 'parenting' },
  { id: 'variety', name: 'Variety', url: 'https://variety.com/feed/', category: 'entertainment-news' },
  { id: 'hollywoodreporter', name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', category: 'entertainment-news' },
  { id: 'deadline', name: 'Deadline', url: 'https://deadline.com/feed/', category: 'entertainment-news' },
  { id: 'ew', name: 'Entertainment Weekly', url: 'https://ew.com/feed/', category: 'entertainment-news' },
  { id: 'npr_culture', name: 'NPR Culture', url: 'https://feeds.npr.org/1008/rss.xml', category: 'entertainment-news' },
  { id: 'slashfilm', name: '/Film', url: 'https://www.slashfilm.com/feed/', category: 'movies-tv' },
  { id: 'indiewire', name: 'IndieWire', url: 'https://www.indiewire.com/feed/rss.xml', category: 'movies-tv' },
  { id: 'avclub', name: 'The A.V. Club', url: 'https://www.avclub.com/rss.xml', category: 'movies-tv' },
  { id: 'vulture', name: 'Vulture', url: 'https://www.vulture.com/rss/index.xml', category: 'movies-tv' },
  { id: 'collider', name: 'Collider', url: 'https://collider.com/feed/', category: 'movies-tv' },
  { id: 'pitchfork', name: 'Pitchfork', url: 'https://pitchfork.com/rss/news/feed.xml', category: 'music' },
  { id: 'rolling_stone', name: 'Rolling Stone', url: 'https://www.rollingstone.com/feed/', category: 'music' },
  { id: 'nme', name: 'NME', url: 'https://www.nme.com/feed', category: 'music' },
  { id: 'billboard', name: 'Billboard', url: 'https://www.billboard.com/feed/', category: 'music' },
  { id: 'stereogum', name: 'Stereogum', url: 'https://www.stereogum.com/feed/', category: 'music' },
  { id: 'polygon', name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', category: 'gaming' },
  { id: 'ign', name: 'IGN', url: 'https://www.ign.com/rss.xml', category: 'gaming' },
  { id: 'gamespot', name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/?type=rss', category: 'gaming' },
  { id: 'kotaku', name: 'Kotaku', url: 'https://kotaku.com/rss', category: 'gaming' },
  { id: 'pcgamer', name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', category: 'gaming' },
  { id: 'lithub', name: 'Literary Hub', url: 'https://lithub.com/feed/', category: 'books' },
  { id: 'guardian_books', name: 'Guardian Books', url: 'https://www.theguardian.com/books/rss', category: 'books' },
  { id: 'nytimes_books', name: 'NY Times Books', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Books.xml', category: 'books' },
  { id: 'bookpage', name: 'BookPage', url: 'https://www.bookpage.com/feed/?post_type=preview', category: 'books' },
  { id: 'hackernews', name: 'Hacker News Best', url: 'https://hnrss.org/best', category: 'startups' },
  { id: 'venturebeat', name: 'VentureBeat', url: 'https://venturebeat.com/feed/', category: 'startups' },
  { id: 'inc', name: 'Inc.', url: 'https://www.inc.com/rss', category: 'startups' },
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto-web3' },
  { id: 'cointele', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto-web3' },
  { id: 'bitcoin_mag', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', category: 'crypto-web3' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', category: 'crypto-web3' },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', category: 'crypto-web3' },
  { id: 'guardian_env', name: 'Guardian Environment', url: 'https://www.theguardian.com/environment/rss', category: 'environment' },
  { id: 'climatecentral', name: 'Climate Central', url: 'https://www.climatecentral.org/feeds/news.rss', category: 'environment' },
  { id: 'carbonbrief', name: 'Carbon Brief', url: 'https://www.carbonbrief.org/feed', category: 'environment' },
  { id: 'grist', name: 'Grist', url: 'https://grist.org/feed/', category: 'environment' },
  { id: 'bbc_sci_env', name: 'BBC Science & Environment', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', category: 'environment' },
  { id: 'nytimes_arts', name: 'NY Times Arts', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml', category: 'entertainment-news' },
  { id: 'bbcsport', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sports' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/espn/rss/news', category: 'sports' },
  { id: 'skysports', name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', category: 'sports' },
  { id: 'sports_ill', name: 'Sports Illustrated', url: 'https://www.si.com/rss/si_topstories.rss', category: 'sports' },
  { id: 'cbssports', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/', category: 'sports' },
  { id: 'reuters_top_news', name: 'Reuters Top News', url: 'https://www.reuters.com/rssFeed/topNews', category: 'news' },
  { id: 'apnews', name: 'Associated Press', url: 'https://apnews.com/rss', category: 'news' },
  { id: 'nytimes_homepage', name: 'NY Times Home Page', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', category: 'news' },
  { id: 'bloomberg_etf_report', name: 'Bloomberg ETF Report', url: 'https://www.bloomberg.com/feed/podcast/etf-report.xml', category: 'business-finance' },
  { id: 'cnbc_top_news', name: 'CNBC Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'business-finance' },
  { id: 'wsj_markets_main', name: 'WSJ Markets Main', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', category: 'business-finance' },
  { id: 'politico_politics', name: 'POLITICO Politics', url: 'https://www.politico.com/rss/politics08.xml', category: 'politics' },
  { id: 'the_hill_politics', name: 'The Hill Politics', url: 'https://thehill.com/rss/syndicator/19110', category: 'politics' },
  { id: 'harvard_health_blog', name: 'Harvard Health', url: 'https://www.health.harvard.edu/rss/blog.xml', category: 'health-wellness' },
  { id: 'webmd_public', name: 'WebMD', url: 'https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC', category: 'health-wellness' },
  { id: 'cdc_health_news', name: 'CDC News', url: 'https://tools.cdc.gov/api/v2/resources/media/403372.rss', category: 'health-wellness' },
  { id: 'scientific_american', name: 'Scientific American', url: 'https://www.scientificamerican.com/feed/rss/', category: 'science' },
  { id: 'science_magazine', name: 'Science Magazine', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science', category: 'science' },
  { id: 'science_news', name: 'Science News', url: 'https://www.sciencenews.org/feed', category: 'science' },
  { id: 'james_clear', name: 'James Clear', url: 'https://jamesclear.com/feed', category: 'productivity' },
  { id: 'breaking_muscle', name: 'Breaking Muscle', url: 'https://breakingmuscle.com/feed/', category: 'fitness' },
  { id: 'ace_fitness', name: 'ACE Fitness', url: 'https://www.acefitness.org/resources/everyone/blog/rss/', category: 'fitness' },
  { id: 'psychology_today', name: 'Psychology Today', url: 'https://www.psychologytoday.com/us/rss', category: 'mental-health' },
  { id: 'verywell_mind', name: 'Verywell Mind', url: 'https://www.verywellmind.com/rss', category: 'mental-health' },
  { id: 'mindful', name: 'Mindful', url: 'https://www.mindful.org/feed/', category: 'mental-health' },
  { id: 'serious_eats', name: 'Serious Eats', url: 'https://www.seriouseats.com/rss', category: 'food' },
  { id: 'nytimes_dining_wine', name: 'NY Times Dining & Wine', url: 'https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml', category: 'food' },
  { id: 'lonely_planet', name: 'Lonely Planet', url: 'https://www.lonelyplanet.com/news/rss.xml', category: 'travel' },
  { id: 'the_points_guy', name: 'The Points Guy', url: 'https://thepointsguy.com/feed/', category: 'travel' },
  { id: 'parents_thmb', name: 'Parents', url: 'https://www.parents.com/thmb/rss', category: 'parenting' },
  { id: 'what_to_expect', name: 'What to Expect', url: 'https://www.whattoexpect.com/rss', category: 'parenting' },
  { id: 'scary_mommy', name: 'Scary Mommy', url: 'https://www.scarymommy.com/feed', category: 'parenting' },
  { id: 'indiewire_feed', name: 'IndieWire', url: 'https://www.indiewire.com/feed/', category: 'movies-tv' },
  { id: 'rotten_tomatoes_editorial', name: 'Rotten Tomatoes Editorial', url: 'https://editorial.rottentomatoes.com/feed/', category: 'movies-tv' },
  { id: 'pitchfork_news', name: 'Pitchfork News', url: 'https://pitchfork.com/rss/news/', category: 'music' },
  { id: 'rolling_stone_music_news', name: 'Rolling Stone Music News', url: 'https://www.rollingstone.com/music/music-news/feed/', category: 'music' },
  { id: 'ign_all', name: 'IGN All', url: 'https://feeds.ign.com/ign/all', category: 'gaming' },
  { id: 'gamespot_mashup', name: 'GameSpot Mashup', url: 'https://www.gamespot.com/feeds/mashup/', category: 'gaming' },
  { id: 'paris_review', name: 'The Paris Review', url: 'https://www.theparisreview.org/blog/feed/', category: 'books' },
  { id: 'techcrunch_startups', name: 'TechCrunch Startups', url: 'https://techcrunch.com/startups/feed', category: 'startups' },
  { id: 'entrepreneur_latest', name: 'Entrepreneur', url: 'https://www.entrepreneur.com/latest.rss', category: 'startups' },
  { id: 'inside_climate_news', name: 'Inside Climate News', url: 'https://insideclimatenews.org/feed/', category: 'environment' },
  { id: 'yale_e360', name: 'Yale Environment 360', url: 'https://e360.yale.edu/feed/rss.xml', category: 'environment' },
];

// ── AsyncStorage keys ────────────────────────────────────────────────────────

const SUBSCRIPTIONS_KEY  = 'rss_subscriptions';
const SEEN_GUIDS_PREFIX  = 'rss_seen_guids_';
const LAST_POLL_KEY      = 'rss_last_poll_ms';
const CUSTOM_FEEDS_KEY   = 'rss_custom_feeds';

const POLL_THROTTLE_MS   = 6 * 60 * 60 * 1000;
const MAX_SEEN_GUIDS     = 200;
const MAX_ITEMS_PER_FEED = 5;

// ── Image helper ─────────────────────────────────────────────────────────────

/** Returns a Google favicon URL for any feed URL domain. */
export function feedImageUrl(feedUrl: string): string {
  try {
    const { hostname } = new URL(feedUrl);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
  } catch {
    return '';
  }
}

// ── Search helpers ────────────────────────────────────────────────────────────

/** Client-side filter for the local predefined + custom list. */
export function searchFeeds(query: string, feeds: RssFeed[]): RssFeed[] {
  const q = query.trim().toLowerCase();
  if (!q) return feeds;
  return feeds.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q),
  );
}

interface FeedlyResult {
  id: string;          // "feed/https://techcrunch.com/feed/"
  title?: string;
  website?: string;
  subscribers?: number;
  description?: string;
}

/**
 * Searches the Feedly public feed directory for RSS feeds matching `query`.
 * No API key required. Returns up to 20 results as RssFeed objects.
 */
export async function searchFeedsOnline(query: string): Promise<RssFeed[]> {
  const q = query.trim();
  if (!q) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=20&locale=en`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: FeedlyResult[] };
    return (data.results ?? [])
      .map((r) => {
        // Upgrade http:// → https:// so iOS ATS doesn't block the feed fetch
        const feedUrl = r.id.replace(/^feed\//, '').replace(/^http:\/\//, 'https://');
        return {
          id: `online_${feedUrl}`,
          name: r.title ?? r.website ?? feedUrl,
          url: feedUrl,
          category: 'Custom' as FeedCategory,
        };
      })
      .filter((f) => {
        try { new URL(f.url); return true; } catch { return false; }
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Custom feeds ──────────────────────────────────────────────────────────────

export async function loadCustomFeeds(): Promise<RssFeed[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_FEEDS_KEY);
    return raw ? (JSON.parse(raw) as RssFeed[]) : [];
  } catch {
    return [];
  }
}

export async function getAllFeeds(): Promise<RssFeed[]> {
  const custom = await loadCustomFeeds();
  return [...RSS_FEEDS, ...custom];
}

export async function addCustomFeed(url: string): Promise<RssFeed> {
  const trimmed = url.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let xml: string;
  try {
    const res = await fetch(trimmed, { signal: controller.signal });
    if (!res.ok) throw new Error('fetch_failed');
    xml = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // Extract channel title from <channel><title>
  const channelBlock = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/)?.[1] ?? xml;
  const rawTitle = extractText(channelBlock, 'title');
  const name = rawTitle || trimmed;

  // Validate that it looks like a feed (has at least one <item> or <entry>)
  if (!/<item[\s>]/.test(xml) && !/<entry[\s>]/.test(xml)) {
    throw new Error('not_a_feed');
  }

  const existing = await loadCustomFeeds();

  // De-duplicate by URL
  if (existing.some((f) => f.url === trimmed) || RSS_FEEDS.some((f) => f.url === trimmed)) {
    throw new Error('already_exists');
  }

  const id = `custom_${Date.now()}`;
  const feed: RssFeed = { id, name, url: trimmed, category: 'Custom', custom: true };
  await AsyncStorage.setItem(CUSTOM_FEEDS_KEY, JSON.stringify([...existing, feed]));
  return feed;
}

export async function removeCustomFeed(id: string): Promise<void> {
  const existing = await loadCustomFeeds();
  await AsyncStorage.setItem(CUSTOM_FEEDS_KEY, JSON.stringify(existing.filter((f) => f.id !== id)));
}

/**
 * Directly saves a pre-parsed feed object to the custom list, without re-fetching the URL.
 * Used when subscribing to an online search result — the feed data is already available
 * from the Feedly API, so there's no need to re-validate.
 */
export async function saveRssFeedToCustomList(feed: RssFeed): Promise<void> {
  const existing = await loadCustomFeeds();
  if (existing.some((f) => f.id === feed.id) || RSS_FEEDS.some((f) => f.id === feed.id)) return;
  const toSave: RssFeed = { ...feed, custom: true };
  await AsyncStorage.setItem(CUSTOM_FEEDS_KEY, JSON.stringify([...existing, toSave]));
}

// ── Subscription CRUD ────────────────────────────────────────────────────────

export async function loadSubscriptions(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SUBSCRIPTIONS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function subscribe(feedId: string): Promise<void> {
  const subs = await loadSubscriptions();
  if (subs.includes(feedId)) return;
  await AsyncStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify([...subs, feedId]));
}

export async function unsubscribe(feedId: string): Promise<void> {
  const subs = await loadSubscriptions();
  await AsyncStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subs.filter((id) => id !== feedId)));
}

// ── Topic → feed mapping ──────────────────────────────────────────────────────
// Built from `TOPIC_FEED_URLS_BY_ID` (src/data/topicFeedMap.ts) so onboarding,
// digest scheduler, and Feed stay aligned.

function normalizeFeedUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase().replace(/\/$/, '');
  }
}

const feedIdByNormalizedUrl = new Map<string, string>(
  RSS_FEEDS.map((f) => [normalizeFeedUrl(f.url), f.id]),
);

function urlsToUniqueFeedIds(urls: readonly string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const id = feedIdByNormalizedUrl.get(normalizeFeedUrl(url));
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** First 3 feed IDs per topic are “Top Picks” in the Feed screen when a topic is selected. */
export const TOPIC_TO_RSS_FEED_IDS: Record<string, string[]> = (() => {
  const built: Record<string, string[]> = {};
  for (const [topicId, urls] of Object.entries(TOPIC_FEED_URLS_BY_ID)) {
    built[topicId] = urlsToUniqueFeedIds(urls);
  }
  return built;
})();

const FEEDS_PER_TOPIC_BOOTSTRAP = 3;

/**
 * Sets built-in RSS subscriptions from onboarding topics (top 3 feeds per topic).
 * Removes previous built-in subscriptions so stale feeds do not stay checked;
 * custom / online feed IDs are preserved.
 */
export async function bootstrapSubscriptionsFromTopics(topicIds: string[]): Promise<void> {
  const builtInIds = new Set(RSS_FEEDS.map((f) => f.id));
  const subs = await loadSubscriptions();
  const keepIds = subs.filter((id) => !builtInIds.has(id));
  const fromTopics = [
    ...new Set(
      topicIds.flatMap((id) => (TOPIC_TO_RSS_FEED_IDS[id] ?? []).slice(0, FEEDS_PER_TOPIC_BOOTSTRAP)),
    ),
  ];
  await AsyncStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify([...keepIds, ...fromTopics]));
}

/**
 * Returns a map of topicId → all 5 feed URLs for each selected topic.
 * Used by the digest service to build a topic-balanced, category-diverse feed request.
 */
export function getTopicFeedUrls(selectedTopics: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const topicId of selectedTopics) {
    const feedIds = TOPIC_TO_RSS_FEED_IDS[topicId];
    if (!feedIds?.length) continue;
    const urls = feedIds
      .map((id) => RSS_FEEDS.find((f) => f.id === id)?.url)
      .filter((u): u is string => Boolean(u));
    if (urls.length > 0) result[topicId] = urls;
  }
  return result;
}

/**
 * Returns the top `count` predefined feeds for a given topic ID.
 * The first 3 in the list are the "Top Picks"; feeds 4–5 are "More Channels".
 */
export function getTopFeedsForTopic(topicId: string, count = 3): RssFeed[] {
  const ids = (TOPIC_TO_RSS_FEED_IDS[topicId] ?? []).slice(0, count);
  return ids.map((id) => RSS_FEEDS.find((f) => f.id === id)).filter((f): f is RssFeed => Boolean(f));
}

/** Returns all 5 predefined feeds for a topic ID. */
export function getAllFeedsForTopic(topicId: string): RssFeed[] {
  const ids = TOPIC_TO_RSS_FEED_IDS[topicId] ?? [];
  return ids.map((id) => RSS_FEEDS.find((f) => f.id === id)).filter((f): f is RssFeed => Boolean(f));
}

/**
 * Returns the top `feedsPerTopic` feed URLs for each of the given topic IDs,
 * deduplicated. Used by the digest service to build a category-balanced feed list.
 */
export function getTopFeedUrlsForTopics(topicIds: string[], feedsPerTopic = 3): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const topicId of topicIds) {
    for (const feed of getTopFeedsForTopic(topicId, feedsPerTopic)) {
      if (!seen.has(feed.url)) {
        seen.add(feed.url);
        urls.push(feed.url);
      }
    }
  }
  return urls;
}

/** Returns the feed URLs for all currently subscribed feeds (built-in + custom). */
export async function getSubscribedFeedUrls(): Promise<string[]> {
  const [subs, custom] = await Promise.all([loadSubscriptions(), loadCustomFeeds()]);
  const allFeeds = [...RSS_FEEDS, ...custom];
  return allFeeds.filter((f) => subs.includes(f.id)).map((f) => f.url);
}

/**
 * Clears all local RSS-related state, including manual feeds, subscriptions,
 * poll metadata, and per-feed seen GUID caches.
 */
export async function clearRssLocalData(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const seenKeys = keys.filter((k) => k.startsWith(SEEN_GUIDS_PREFIX));
    const keysToRemove = [SUBSCRIPTIONS_KEY, CUSTOM_FEEDS_KEY, LAST_POLL_KEY, ...seenKeys];
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
  } catch {
    // best-effort
  }
}

// ── Seen-GUID helpers ─────────────────────────────────────────────────────────

async function loadSeenGuids(feedId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_GUIDS_PREFIX + feedId);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeenGuids(feedId: string, guids: Set<string>): Promise<void> {
  const arr = Array.from(guids).slice(-MAX_SEEN_GUIDS);
  await AsyncStorage.setItem(SEEN_GUIDS_PREFIX + feedId, JSON.stringify(arr));
}

/**
 * Mark a single GUID as seen for a feed, so background polls don't regenerate
 * an article the user already manually triggered generation for.
 */
export async function markArticleSeen(feedId: string, guid: string): Promise<void> {
  try {
    const seen = await loadSeenGuids(feedId);
    seen.add(guid);
    await saveSeenGuids(feedId, seen);
  } catch {
    // best-effort
  }
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractText(block: string, tag: string): string {
  const cdataMatch = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return plainMatch ? plainMatch[1].trim() : '';
}

function stripHtml(html: string): string {
  return html
    // Decode entities FIRST so encoded tags like &lt;p&gt; become <p> before stripping
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Then strip all HTML tags (including any that were encoded above)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractItemImage(block: string, descHtml: string): string {
  // 1. <enclosure type="image/..." url="..."/>
  const enclosure = block.match(/<enclosure[^>]*type="image\/[^"]*"[^>]*url="([^"]+)"/);
  if (enclosure) return enclosure[1];
  const enclosure2 = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image\/[^"]*"/);
  if (enclosure2) return enclosure2[1];
  // 2. <media:thumbnail url="..."/>
  const mediaThumbnail = block.match(/<media:thumbnail[^>]*url="([^"]+)"/);
  if (mediaThumbnail) return mediaThumbnail[1];
  // 3. <media:content url="..." medium="image".../>
  const mediaContent = block.match(/<media:content[^>]*medium="image"[^>]*url="([^"]+)"/);
  if (mediaContent) return mediaContent[1];
  const mediaContent2 = block.match(/<media:content[^>]*url="([^"]+)"[^>]*medium="image"/);
  if (mediaContent2) return mediaContent2[1];
  // 4. First <img src="..."> inside the description HTML
  const imgSrc = descHtml.match(/<img[^>]*src="([^"]+)"/);
  if (imgSrc) return imgSrc[1];
  return '';
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchXml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some feeds block requests without a recognisable User-Agent
        'User-Agent': 'Mozilla/5.0 (compatible; Podcastify/1.0; +https://podcastify.app)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Used by pollFeed — lightweight, fetches only needed fields. */
async function fetchFeedItems(url: string): Promise<RssItem[]> {
  const xml = await fetchXml(url);
  if (!xml) return [];

  const items: RssItem[] = [];
  // Match <item> or <item rdf:about="..."> (RSS 1.0/RDF) — the [^>]* handles attributes
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = extractText(block, 'title');
    const link  =
      extractText(block, 'link') ||
      ((block.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] ?? '');
    const guid  = extractText(block, 'guid') || link;

    // Prefer content:encoded (full article body) for text-mode TTS dispatch
    const contentEncoded = extractText(block, 'content:encoded');
    const descRaw = extractText(block, 'description');
    const description = (contentEncoded || descRaw)
      ? stripHtml(contentEncoded || descRaw).slice(0, 6000)
      : undefined;

    if (link) items.push({ title, link, guid, description });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }

  return items;
}

/** Used by FeedDetailScreen — full ExtendedRssItem with pagination. */
export async function fetchFeedPage(
  url: string,
  page: number,
  pageSize = 20,
): Promise<{ items: ExtendedRssItem[]; hasMore: boolean }> {
  const xml = await fetchXml(url);
  if (!xml) return { items: [], hasMore: false };

  const allItems: ExtendedRssItem[] = [];

  // Support both RSS <item>/<item rdf:about="..."> (RSS 1.0/2.0) and Atom <entry>
  const re = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const block = m[1];

    const title   = extractText(block, 'title');
    const link    =
      extractText(block, 'link') ||
      ((block.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] ?? '');
    const guid    = extractText(block, 'guid') || extractText(block, 'id') || link;
    const pubDate = extractText(block, 'pubDate') || extractText(block, 'updated') || extractText(block, 'published');

    const contentEncoded = extractText(block, 'content:encoded');
    const descRaw  = extractText(block, 'description') || extractText(block, 'summary') || extractText(block, 'content');
    const bodyRaw  = contentEncoded || descRaw;
    const imageUrl = extractItemImage(block, bodyRaw);
    const description     = descRaw    ? stripHtml(descRaw).slice(0, 300)    : undefined;
    const fullDescription = bodyRaw    ? stripHtml(bodyRaw).slice(0, 10000)   : undefined;

    if (link) {
      allItems.push({ title, link, guid, description, fullDescription, imageUrl: imageUrl || undefined, pubDate: pubDate || undefined });
    }
  }

  const start    = page * pageSize;
  const end      = start + pageSize;
  const items    = allItems.slice(start, end);
  const hasMore  = end < allItems.length;

  return { items, hasMore };
}

/**
 * Pulls up to `maxTitles` unique article titles from the given RSS feed URLs (in order),
 * for onboarding preview. Best-effort per feed; skips feeds that fail to load.
 */
export async function fetchPreviewTitlesFromFeedUrls(
  feedUrls: string[],
  maxTitles: number = 3,
): Promise<string[]> {
  const seenTitle = new Set<string>();
  const titles: string[] = [];
  const urls = [...new Set(feedUrls.filter(Boolean))];

  for (const url of urls) {
    if (titles.length >= maxTitles) break;
    try {
      const { items } = await fetchFeedPage(url, 0, 8);
      for (const item of items) {
        const t = item.title?.replace(/\s+/g, ' ').trim();
        if (!t || seenTitle.has(t)) continue;
        seenTitle.add(t);
        titles.push(t);
        if (titles.length >= maxTitles) break;
      }
    } catch {
      /* try next feed */
    }
  }

  return titles;
}

// ── pollFeed ──────────────────────────────────────────────────────────────────

export async function pollFeed(feedId: string, force = false, maxNew = Infinity): Promise<void> {
  const allFeeds = await getAllFeeds();
  const feed = allFeeds.find((f) => f.id === feedId);
  if (!feed) return;

  const seen = await loadSeenGuids(feedId);
  let items: RssItem[];
  try {
    items = await fetchFeedItems(feed.url);
  } catch (e) {
    console.warn('[rss] fetch failed', { feedId, error: (e as Error).message });
    return;
  }

  const newItems = items.filter((item) => !seen.has(item.guid));
  // Mark all fetched items as seen — even the ones we won't generate — so future
  // polls don't re-surface them.
  newItems.forEach((item) => seen.add(item.guid));
  await saveSeenGuids(feedId, seen);

  const toGenerate = newItems.slice(0, maxNew);
  for (const item of toGenerate) {
    void startRssGeneration(item.link, item.title, item.description);
  }
}

// ── pollSubscribedFeeds ───────────────────────────────────────────────────────

export async function pollSubscribedFeeds(opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force ?? false;

  if (!force) {
    try {
      const lastPollRaw = await AsyncStorage.getItem(LAST_POLL_KEY);
      const lastPollMs  = lastPollRaw ? Number(lastPollRaw) : 0;
      if (Date.now() - lastPollMs < POLL_THROTTLE_MS) return;
    } catch {
      // proceed
    }
  }

  const subs = await loadSubscriptions();
  if (subs.length === 0) return;

  await AsyncStorage.setItem(LAST_POLL_KEY, String(Date.now()));

  for (const feedId of subs) {
    void pollFeed(feedId, force);
  }
}
