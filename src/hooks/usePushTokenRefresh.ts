import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerDeviceForPush } from '../services/pushNotifications';

async function refresh(): Promise<void> {
  await registerDeviceForPush();
}

// Re-registers the APNs token on every app foreground and whenever iOS rotates
// the token. Re-registration is idempotent — SNS returns the existing endpoint
// ARN and we set Enabled=true, so any endpoint Apple disabled after a delivery
// failure is recovered the next time the user opens the app.
export function usePushTokenRefresh(enabled: boolean) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    void refresh();

    const tokenSub = Notifications.addPushTokenListener(() => {
      void refresh();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (appState.current !== 'active' && next === 'active') {
        void refresh();
      }
      appState.current = next;
    });

    return () => {
      tokenSub.remove();
      appStateSub.remove();
    };
  }, [enabled]);
}
