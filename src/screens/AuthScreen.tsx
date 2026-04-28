import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { createGuestSession, saveSession } from '../services/auth';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

GoogleSignin.configure({
  // Native iOS sign-in should work with the iOS OAuth client alone.
  // Providing an invalid/unconfigured server audience (webClientId) causes:
  // invalid_audience: "Audience is not a valid client ID."
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

type Nav = StackNavigationProp<RootStackParamList, 'Auth'>;

export function AuthScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      // Support both v13 (response.data) and older SDK shapes
      const idToken = (response as any).data?.idToken ?? (response as any).idToken;
      const user = (response as any).data?.user ?? (response as any).user;

      if (!idToken) throw new Error('Google did not return an ID token.');

      await saveSession({
        provider: 'google',
        userId: String(user.id),
        email: user.email ?? undefined,
        displayName: user.name ?? undefined,
        photoUrl: user.photo ?? undefined,
        oidcIdToken: idToken,
      });

      navigation.replace('Main');
    } catch (e: any) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) {
        // user dismissed — not an error
      } else if (e.code === statusCodes.IN_PROGRESS) {
        // sign-in already in progress
      } else {
        setError(e.message ?? 'Google Sign-In failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const onGuest = async () => {
    setError(null);
    setLoading(true);
    try {
      const session = await createGuestSession();
      await saveSession(session);
      navigation.replace('Main');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not continue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <Ionicons name="headset" size={56} color={Colors.primary} />
        </View>
        <Text style={styles.title}>Podcastify</Text>
        <Text style={styles.subtitle}>Turn articles into audio</Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={onGoogle}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={Colors.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={22} color={Colors.text} />
                <Text style={styles.btnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.skipBtn, loading && styles.btnDisabled]}
            onPress={onGuest}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Continue without signing in</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  logoWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primary + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  buttons: { width: '100%', gap: Spacing.md },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 52,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: Colors.text, fontSize: FontSize.md, fontWeight: '600' },
  error: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  skipBtn: { paddingVertical: Spacing.md, alignItems: 'center' },
  skipText: { color: Colors.textDim, fontSize: FontSize.sm, fontWeight: '500' },
});
