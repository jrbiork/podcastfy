import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { OnboardingConfigScreen } from '../screens/OnboardingConfigScreen';
// import { DigestPreviewScreen } from '../screens/DigestPreviewScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { MainTabs } from './MainTabs';
import { ModePickerScreen } from '../screens/ModePickerScreen';
import { GeneratingScreen } from '../screens/GeneratingScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { FeedDetailScreen } from '../screens/FeedDetailScreen';
import { ArticleDetailScreen } from '../screens/ArticleDetailScreen';
import { hasCompletedOnboarding } from '../services/onboarding';
import { loadSession } from '../services/auth';
import { initPurchases } from '../services/subscription';
import { Colors } from '../utils/theme';
import type { RootStackParamList } from './rootNavigationRef';

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('Main');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initPurchases().catch(() => {});
      const onboard = await hasCompletedOnboarding();
      const session = await loadSession();
      if (cancelled) return;
      if (!onboard) setInitialRoute('Onboarding');
      else if (!session) setInitialRoute('Auth');
      else setInitialRoute('Main');
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding">
        {(props) => (
          <OnboardingConfigScreen
            onComplete={(prefs) =>
              props.navigation.replace('Auth', { pendingOnboardingPrefs: prefs })
            }
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen
        name="ModePicker"
        component={ModePickerScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="Generating"
        component={GeneratingScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: false }}
      />
      <Stack.Screen name="Player" component={PlayerScreen} />
      <Stack.Screen name="FeedDetail" component={FeedDetailScreen} />
      <Stack.Screen name="ArticleDetail" component={ArticleDetailScreen} />
      <Stack.Screen
        name="Paywall"
        component={PaywallScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: Colors.bg, justifyContent: 'center', alignItems: 'center' },
});
