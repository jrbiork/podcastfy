import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import type { Episode } from '../types';

export type RootStackParamList = {
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
  Player: { episode: Episode };
  ModePicker: { input: import('../types').GenerationInput };
  Generating: { input: import('../types').GenerationInput; mode: 'podcast' | 'tts' };
  Paywall: undefined;
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
