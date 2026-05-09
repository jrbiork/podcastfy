import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerDeviceForPush } from '../services/pushNotifications';

// Re-registers the APNs token on every app foreground and whenever iOS rotates
// the token. Re-registration is idempotent — SNS returns the existing endpoint
// ARN and we set Enabled=true, so any endpoint Apple disabled after a delivery
// failure is recovered the next time the user opens the app.
export function usePushTokenRefresh(enabled: boolean) {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  // Guard against re-entrant calls: addPushTokenListener can fire as a side
  // effect of getDevicePushTokenAsync() inside registerDeviceForPush, which
  // would cause an infinite refresh loop without this flag.
  const refreshing = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const refresh = async () => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        await registerDeviceForPush();
      } finally {
        refreshing.current = false;
      }
    };

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
