import React, { useEffect, type ReactNode } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StyleSheet, View, Text, TouchableOpacity, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { Colors, FontSize } from '../utils/theme';

type TabParamList = {
  HomeTab: undefined;
  LibraryTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const TAB_SPRING = { damping: 20, stiffness: 260, mass: 0.55 };

function TabBarButton({
  active,
  onPress,
  style,
  children,
}: {
  active: boolean;
  onPress: () => void;
  style?: ViewStyle | ViewStyle[];
  children: ReactNode;
}) {
  const scale = useSharedValue(active ? 1 : 0.94);
  const dim = useSharedValue(active ? 1 : 0.72);

  useEffect(() => {
    scale.value = withSpring(active ? 1 : 0.94, TAB_SPRING);
    dim.value = withSpring(active ? 1 : 0.72, TAB_SPRING);
  }, [active]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: dim.value,
  }));

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={1} style={style}>
      <Animated.View style={[animatedStyle, styles.tabBarBtnInner]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isHomeActive = state.index === 0;
  const isLibraryActive = state.index === 1;
  const isProfileActive = state.index === 2;

  const blurProps = Platform.select({
    web: { experimentalBlurMethod: 'none' as const },
    default: {},
  });

  return (
    <View style={[tabStyles.wrapper, { paddingBottom: insets.bottom + 8 }]}>
      <View style={tabStyles.outerRow}>
        <View style={tabStyles.glassPill}>
          <BlurView intensity={52} tint="dark" style={StyleSheet.absoluteFill} {...blurProps} />
          <View style={tabStyles.glassPillInner}>
            <TabBarButton
              active={isHomeActive}
              onPress={() => navigation.navigate('HomeTab')}
              style={[tabStyles.tab, isHomeActive && tabStyles.tabActive]}
            >
              <Ionicons
                name={isHomeActive ? 'home' : 'home-outline'}
                size={22}
                color={isHomeActive ? Colors.primary : Colors.textDim}
              />
              <Text style={[tabStyles.label, isHomeActive && tabStyles.labelActive]}>Home</Text>
            </TabBarButton>

            <View style={tabStyles.tabDivider} />

            <TabBarButton
              active={isLibraryActive}
              onPress={() => navigation.navigate('LibraryTab')}
              style={[tabStyles.tab, isLibraryActive && tabStyles.tabActive]}
            >
              <Ionicons
                name={isLibraryActive ? 'albums' : 'albums-outline'}
                size={22}
                color={isLibraryActive ? Colors.primary : Colors.textDim}
              />
              <Text style={[tabStyles.label, isLibraryActive && tabStyles.labelActive]}>Library</Text>
            </TabBarButton>
          </View>
        </View>

        <View style={tabStyles.glassCircle}>
          <BlurView intensity={52} tint="dark" style={StyleSheet.absoluteFill} {...blurProps} />
          <TabBarButton
            active={isProfileActive}
            onPress={() => navigation.navigate('ProfileTab')}
            style={[tabStyles.profileBtn, isProfileActive && tabStyles.profileBtnActive]}
          >
            <Ionicons
              name={isProfileActive ? 'person' : 'person-outline'}
              size={22}
              color={isProfileActive ? Colors.primary : Colors.textDim}
            />
          </TabBarButton>
        </View>
      </View>
    </View>
  );
}

export function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
      initialRouteName="HomeTab"
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="LibraryTab" component={LibraryScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
  },
});

const tabStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  outerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  glassPill: {
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(20, 20, 28, 0.65)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  glassPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tabDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: 2,
  },
  glassCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(20, 20, 28, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 22,
    minHeight: 44,
  },
  tabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textDim,
  },
  labelActive: {
    color: Colors.primary,
  },
  profileBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
});
