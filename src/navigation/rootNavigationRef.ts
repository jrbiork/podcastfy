import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import type { Episode } from '../types';
import type { OnboardingPrefs } from '../services/onboarding';

export type RootStackParamList = {
  Onboarding: undefined;
  /** Fresh onboarding prefs (AsyncStorage can lag right after replace); used on first sign-in sync. */
  Auth: { pendingOnboardingPrefs?: OnboardingPrefs } | undefined;
  DigestPreview: undefined;
  Main:
    | {
        screen?: 'TodayTab' | 'FeedTab' | 'LibraryTab' | 'HomeTab' | 'ProfileTab';
      }
    | undefined;
  Player: { episode: Episode };
  ModePicker: { input: import('../types').GenerationInput };
  Generating: { input: import('../types').GenerationInput; mode: 'podcast' | 'tts' };
  Paywall: undefined;
  FeedDetail: { feed: import('../services/rssService').RssFeed };
  ArticleDetail: {
    item: import('../services/rssService').ExtendedRssItem;
    feed: import('../services/rssService').RssFeed;
    currentIndex?: number;
  };
};

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

export function resetToAuth(): void {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: 'Auth' }] })
  );
}

export function resetToOnboarding(): void {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: 'Onboarding' }] })
  );
}

export function navigateToPlayer(episode: Episode): void {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.navigate('Player', { episode });
}

export function navigateToPaywall(): void {
  if (rootNavigationRef.isReady()) rootNavigationRef.navigate('Paywall');
}

export function navigateToTodayTab(): void {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: { screen: 'TodayTab' },
    }),
  );
}
