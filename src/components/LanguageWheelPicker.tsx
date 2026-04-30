import React, { useRef, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';

export const LANGUAGES = [
  { code: '',     label: 'Auto',               name: 'Auto (keep source language)' },
  { code: 'en-US', label: 'English (US)',      name: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)',      name: 'English (UK)' },
  { code: 'es',   label: 'Spanish',            name: 'Spanish' },
  { code: 'fr',   label: 'French',             name: 'French' },
  { code: 'de',   label: 'German',             name: 'German' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', name: 'Portuguese (Brazil)' },
];

const ITEM_HEIGHT = 56;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PAD = ITEM_HEIGHT * 2; // top/bottom padding so first/last can center

interface Props {
  visible: boolean;
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

export function LanguageWheelPicker({ visible, selectedCode, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrolling = useRef(false);

  useEffect(() => {
    if (!visible) return;
    const idx = Math.max(0, LANGUAGES.findIndex((l) => l.code === selectedCode));
    setActiveIndex(idx);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
    });
  }, [visible, selectedCode]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(Math.round(y / ITEM_HEIGHT), LANGUAGES.length - 1));
    setActiveIndex(idx);
    scrolling.current = false;
  };

  const handleConfirm = () => {
    onSelect(LANGUAGES[activeIndex].code);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Translate audio</Text>

        <View style={styles.wheelWrap}>
          {/* Selection band */}
          <View style={styles.selectionBand} pointerEvents="none" />

          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            contentContainerStyle={{ paddingVertical: PAD }}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            scrollEventThrottle={16}
            style={styles.scroll}
          >
            {LANGUAGES.map((lang, i) => {
              const distance = Math.abs(i - activeIndex);
              const opacity = distance === 0 ? 1 : distance === 1 ? 0.45 : 0.18;
              const scale = distance === 0 ? 1 : 0.9;
              const fontWeight = distance === 0 ? '700' : '400';

              return (
                <TouchableOpacity
                  key={lang.code}
                  style={styles.item}
                  activeOpacity={0.7}
                  onPress={() => {
                    setActiveIndex(i);
                    scrollRef.current?.scrollTo({ y: i * ITEM_HEIGHT, animated: true });
                  }}
                >
                  <Text
                    style={[
                      styles.itemText,
                      {
                        opacity,
                        transform: [{ scale }],
                        fontWeight,
                        color: distance === 0 ? Colors.text : Colors.textMuted,
                      },
                    ]}
                  >
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Top fade — two layers to simulate gradient */}
          <View style={[styles.fade, styles.fadeTop]} pointerEvents="none">
            <View style={styles.fadeInner} />
          </View>
          {/* Bottom fade */}
          <View style={[styles.fade, styles.fadeBottom]} pointerEvents="none">
            <View style={[styles.fadeInner, { bottom: 0, top: undefined }]} />
          </View>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.8}>
            <Text style={styles.confirmText}>Select</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  wheelWrap: {
    height: PICKER_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  scroll: {
    flex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    fontSize: FontSize.lg,
    textAlign: 'center',
  },
  selectionBand: {
    position: 'absolute',
    left: Spacing.xl,
    right: Spacing.xl,
    top: ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary + '55',
    backgroundColor: Colors.primary + '10',
    zIndex: 1,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_HEIGHT * 2,
    zIndex: 2,
  },
  fadeTop: {
    top: 0,
    backgroundColor: Colors.surface,
    opacity: 0.6,
  },
  fadeBottom: {
    bottom: 0,
    backgroundColor: Colors.surface,
    opacity: 0.6,
  },
  fadeInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: Colors.surface,
    opacity: 0.6,
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});
