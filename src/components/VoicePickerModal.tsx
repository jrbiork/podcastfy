import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';

const VOICE_PREVIEWS_BASE = 'https://podcastify-jobs-445241615553.s3.us-east-1.amazonaws.com/voice-previews';

const VOICE_PREVIEW_URLS: Record<string, string> = {
  alloy:   `${VOICE_PREVIEWS_BASE}/alloy.mp3`,
  echo:    `${VOICE_PREVIEWS_BASE}/echo.mp3`,
  fable:   `${VOICE_PREVIEWS_BASE}/fable.mp3`,
  nova:    `${VOICE_PREVIEWS_BASE}/nova.mp3`,
  onyx:    `${VOICE_PREVIEWS_BASE}/onyx.mp3`,
  shimmer: `${VOICE_PREVIEWS_BASE}/shimmer.mp3`,
};

const VOICES = [
  { id: 'alloy',   label: 'Alloy',   description: 'Neutral & versatile' },
  { id: 'echo',    label: 'Echo',    description: 'Warm & casual' },
  { id: 'fable',   label: 'Fable',   description: 'Expressive & storytelling' },
  { id: 'nova',    label: 'Nova',    description: 'Bright & energetic' },
  { id: 'onyx',    label: 'Onyx',    description: 'Deep & authoritative' },
  { id: 'shimmer', label: 'Shimmer', description: 'Clear & gentle' },
];

interface Props {
  visible: boolean;
  selectedVoice: string;
  onSelect: (voice: string) => void;
  onClose: () => void;
}

export function VoicePickerModal({ visible, selectedVoice, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(selectedVoice);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (visible) setCurrent(selectedVoice);
  }, [visible, selectedVoice]);

  useEffect(() => {
    if (!visible) stopSound();
  }, [visible]);

  const stopSound = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlayingVoice(null);
    setLoadingVoice(null);
    if (s) {
      try { await s.stopAsync(); } catch {}
      try { await s.unloadAsync(); } catch {}
    }
  };

  const togglePreview = async (voiceId: string) => {
    if (playingVoice === voiceId) {
      await stopSound();
      return;
    }
    await stopSound();
    setLoadingVoice(voiceId);
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
      });

      const { sound, status } = await Audio.Sound.createAsync(
        { uri: VOICE_PREVIEW_URLS[voiceId] },
        { shouldPlay: true, volume: 1.0 },
      );

      if (!status.isLoaded) {
        await sound.unloadAsync();
        return;
      }

      soundRef.current = sound;
      setPlayingVoice(voiceId);

      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setPlayingVoice(null);
          soundRef.current = null;
          sound.unloadAsync().catch(() => {});
        }
      });
    } catch (e) {
      console.error('[VoicePickerModal] preview error:', e);
      setPlayingVoice(null);
    } finally {
      setLoadingVoice(null);
    }
  };

  const handleConfirm = async () => {
    await stopSound();
    onSelect(current);
    onClose();
  };

  const handleClose = async () => {
    await stopSound();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Choose Voice</Text>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.list}>
          {VOICES.map((v) => {
            const isSelected = current === v.id;
            const isPlaying = playingVoice === v.id;
            const isLoading = loadingVoice === v.id;

            return (
              <TouchableOpacity
                key={v.id}
                style={[styles.row, isSelected && styles.rowSelected]}
                onPress={() => setCurrent(v.id)}
                activeOpacity={0.75}
              >
                <View style={[styles.iconWrap, isSelected && { backgroundColor: Colors.primary + '22', borderColor: Colors.primary + '55' }]}>
                  <Ionicons
                    name="mic-outline"
                    size={18}
                    color={isSelected ? Colors.primary : Colors.textMuted}
                  />
                </View>

                <View style={styles.labelGroup}>
                  <Text style={[styles.voiceLabel, isSelected && { color: Colors.primary }]}>
                    {v.label}
                  </Text>
                  <Text style={styles.voiceDesc}>{v.description}</Text>
                </View>

                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() => togglePreview(v.id)}
                  hitSlop={8}
                  activeOpacity={0.7}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Ionicons
                      name={isPlaying ? 'stop-circle-outline' : 'play-circle-outline'}
                      size={26}
                      color={isPlaying ? Colors.primary : Colors.textMuted}
                    />
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
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
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  rowSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelGroup: {
    flex: 1,
    gap: 2,
  },
  voiceLabel: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  voiceDesc: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '500',
    opacity: 0.8,
  },
  playBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
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
