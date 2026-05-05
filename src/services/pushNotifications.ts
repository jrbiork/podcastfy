import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function notificationTargetsToday(
  response: Notifications.NotificationResponse,
): boolean {
  const target = response.notification.request.content.data?.target;
  return target === 'today';
}

export async function registerDeviceForPush(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  const permissions = await Notifications.getPermissionsAsync();
  let status = permissions.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  const tokenResponse = await Notifications.getDevicePushTokenAsync();
  const apnsToken = typeof tokenResponse.data === 'string' ? tokenResponse.data : '';
  if (!apnsToken) return;

  await registerPushToken(apnsToken);
}
