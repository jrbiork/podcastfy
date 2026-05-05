/**
 * Curated RSS URLs per onboarding topic (exactly 3 each).
 * Keep in sync with `lambdas/data/topicFeedMap.ts` (digest-scheduler-trigger).
 * Legacy keys support older installs and DynamoDB `selectedTopics`.
 */
export const TOPIC_FEED_URLS_BY_ID: Record<string, readonly string[]> = {
  news: [
    'https://www.reuters.com/rssFeed/topNews',
    'https://apnews.com/rss',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
  ],
  technology: [
    'https://techcrunch.com/feed',
    'https://www.theverge.com/rss/index.xml',
    'https://www.wired.com/feed/rss',
  ],
  'business-finance': [
    'https://www.bloomberg.com/feed/podcast/etf-report.xml',
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
  ],
  politics: [
    'https://www.politico.com/rss/politics08.xml',
    'https://thehill.com/rss/syndicator/19110',
    'https://feeds.npr.org/1014/rss.xml',
  ],
  'health-wellness': [
    'https://www.health.harvard.edu/rss/blog.xml',
    'https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC',
    'https://tools.cdc.gov/api/v2/resources/media/403372.rss',
  ],
  science: [
    'https://www.scientificamerican.com/feed/rss/',
    'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science',
    'https://www.sciencenews.org/feed',
  ],
  productivity: [
    'https://jamesclear.com/feed',
    'https://zenhabits.net/feed/',
    'https://lifehacker.com/rss',
  ],
  fitness: [
    'https://www.menshealth.com/rss/all.xml/',
    'https://breakingmuscle.com/feed/',
    'https://www.acefitness.org/resources/everyone/blog/rss/',
  ],
  'mental-health': [
    'https://www.psychologytoday.com/us/rss',
    'https://www.verywellmind.com/rss',
    'https://www.mindful.org/feed/',
  ],
  food: [
    'https://www.seriouseats.com/rss',
    'https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml',
    'https://www.bonappetit.com/feed/rss',
  ],
  travel: [
    'https://www.lonelyplanet.com/news/rss.xml',
    'https://www.cntraveler.com/feed/rss',
    'https://thepointsguy.com/feed/',
  ],
  parenting: [
    'https://www.parents.com/thmb/rss',
    'https://www.whattoexpect.com/rss',
    'https://www.scarymommy.com/feed',
  ],
  'entertainment-news': [
    'https://variety.com/feed/',
    'https://www.hollywoodreporter.com/feed',
    'https://ew.com/feed',
  ],
  'movies-tv': [
    'https://www.indiewire.com/feed/',
    'https://collider.com/feed/',
    'https://editorial.rottentomatoes.com/feed/',
  ],
  music: [
    'https://pitchfork.com/rss/news/',
    'https://www.rollingstone.com/music/music-news/feed/',
    'https://www.billboard.com/feed/',
  ],
  gaming: [
    'https://feeds.ign.com/ign/all',
    'https://www.gamespot.com/feeds/mashup/',
    'https://www.polygon.com/rss/index.xml',
  ],
  books: [
    'https://lithub.com/feed/',
    'https://rss.nytimes.com/services/xml/rss/nyt/Books.xml',
    'https://www.theparisreview.org/blog/feed/',
  ],
  startups: [
    'https://techcrunch.com/startups/feed',
    'https://venturebeat.com/feed/',
    'https://www.entrepreneur.com/latest.rss',
  ],
  'crypto-web3': [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
  ],
  environment: [
    'https://insideclimatenews.org/feed/',
    'https://grist.org/feed/',
    'https://e360.yale.edu/feed/rss.xml',
  ],

  'ai-tech': [
    'https://techcrunch.com/feed',
    'https://www.theverge.com/rss/index.xml',
    'https://www.wired.com/feed/rss',
  ],
  world: [
    'https://www.reuters.com/rssFeed/topNews',
    'https://apnews.com/rss',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
  ],
  finance: [
    'https://www.bloomberg.com/feed/podcast/etf-report.xml',
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
  ],
  climate: [
    'https://insideclimatenews.org/feed/',
    'https://grist.org/feed/',
    'https://e360.yale.edu/feed/rss.xml',
  ],
  culture: [
    'https://variety.com/feed/',
    'https://www.hollywoodreporter.com/feed',
    'https://ew.com/feed',
  ],
  health: [
    'https://www.health.harvard.edu/rss/blog.xml',
    'https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC',
    'https://tools.cdc.gov/api/v2/resources/media/403372.rss',
  ],
  sports: [
    'https://www.menshealth.com/rss/all.xml/',
    'https://breakingmuscle.com/feed/',
    'https://www.acefitness.org/resources/everyone/blog/rss/',
  ],
  crypto: [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
  ],
};
