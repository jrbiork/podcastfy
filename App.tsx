import React from 'react';
import { DarkTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { RootNavigator } from './src/navigation/RootNavigator';
import { rootNavigationRef } from './src/navigation/rootNavigationRef';
import { Colors } from './src/utils/theme';

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
