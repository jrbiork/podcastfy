import React from 'react';
import { DarkTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigateToTodayTab, rootNavigationRef } from './src/navigation/rootNavigationRef';
import { Colors } from './src/utils/theme';
import {
  notificationTargetsToday,
  registerDeviceForPush,
} from './src/services/pushNotifications';
import { Analytics } from './src/services/analytics';

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.bg,
    card: Colors.bg,
    border: Colors.border,
    primary: Colors.primary,
    text: Colors.text,
  },
};

export default function App() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font });

  React.useEffect(() => {
    let mounted = true;

    void Analytics.appOpen();
    void registerDeviceForPush().catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (notificationTargetsToday(response)) {
        navigateToTodayTab();
      }
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!mounted || !response) return;
        if (notificationTargetsToday(response)) {
          navigateToTodayTab();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <NavigationContainer ref={rootNavigationRef} theme={navigationTheme}>
        <RootNavigator />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
});
