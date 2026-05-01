import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../utils/theme';
import { useIncomingShare } from '../hooks/useIncomingShare';
import { MAX_PDF_UPLOAD_BYTES } from '../services/api';
import { hasReachedFreeLimit } from '../services/subscription';
import { navigateToPaywall } from '../navigation/rootNavigationRef';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GenerationInput } from '../types';
import { VoicePickerModal } from '../components/VoicePickerModal';
import { LanguageWheelPicker, LANGUAGES } from '../components/LanguageWheelPicker';
import type { RootStackParamList } from '../navigation/rootNavigationRef';

const TTS_VOICE_KEY = 'podcastify_tts_voice';

type Nav = StackNavigationProp<RootStackParamList>;

function detectIsUrl(str: string): boolean {
  const s = str.trim().toLowerCase();
  if (s.includes(' ') || s.includes('\n')) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try { new URL(s); return true; } catch { return false; }
  }
  if (s.startsWith('www.')) {
    try { new URL(`https://${s}`); return true; } catch { return false; }
  }
  return false;
}

function normalizeUrl(s: string): string {
  const t = s.trim().toLowerCase();
  return t.startsWith('http://') || t.startsWith('https://') ? t : `https://${t}`;
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const [inputText, setInputText] = useState('');
  const [pdfInput, setPdfInput] = useState<{ uri: string; name: string } | null>(null);
  const [mode, setMode] = useState<'podcast' | 'tts'>('tts');
  const [summarize, setSummarize] = useState(true);
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsLanguage, setTtsLanguage] = useState('');
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [langPickerVisible, setLangPickerVisible] = useState(false);

  // Load persisted voice on mount
  useEffect(() => {
    AsyncStorage.getItem(TTS_VOICE_KEY).then((v) => { if (v) setTtsVoice(v); }).catch(() => {});
  }, []);

  const handleVoiceSelect = useCallback((voice: string) => {
    setTtsVoice(voice);
    AsyncStorage.setItem(TTS_VOICE_KEY, voice).catch(() => {});
  }, []);
  const [checking, setChecking] = useState(false);
  const [cfBanner, setCfBanner] = useState(false);
  const [clipboardBanner, setClipboardBanner] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const isUrl = detectIsUrl(inputText);
  const canGenerate = pdfInput !== null || inputText.trim().length > 0;

  const onPickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_PDF_UPLOAD_BYTES) {
        Alert.alert(
          'PDF too large',
          `Please choose a PDF under ${Math.floor(MAX_PDF_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        );
        return;
      }
      setPdfInput({ uri: asset.uri, name: asset.name });
      setInputText('');
      setClipboardBanner(null);
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  useIncomingShare(
    (url) => {
      setInputText(url);
      setPdfInput(null);
      setClipboardBanner(null);
    },
    (fileUri) => {
      const name = fileUri.split('/').pop() ?? 'document.pdf';
      setPdfInput({ uri: fileUri, name });
      setInputText('');
      setClipboardBanner(null);
    },
  );

  const onInputFocus = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && detectIsUrl(text) && text !== inputText) {
        setClipboardBanner(text);
      }
    } catch {
      /* clipboard access may be denied */
    }
  };

  const onGenerate = async () => {
    if (!canGenerate) return;

    setChecking(true);
    try {
      const limited = await hasReachedFreeLimit();
      if (limited) {
        navigateToPaywall();
        return;
      }

      const voiceOpts = mode === 'tts'
        ? { voice: ttsVoice, language: ttsLanguage || undefined }
        : {};
      let input: GenerationInput;
      if (pdfInput) {
        input = { type: 'pdf', uri: pdfInput.uri, title: pdfInput.name, summarize, ...voiceOpts };
      } else {
        const text = inputText.trim();
        input = isUrl
          ? { type: 'url', url: normalizeUrl(text), summarize, ...voiceOpts }
          : { type: 'text', text, summarize, ...voiceOpts };
      }

      navigation.navigate('Generating', { input, mode });
    } finally {
      setChecking(false);
    }
  };

  // Bottom offset accounts for the tab bar (which handles its own safe area)
  const floatingBottom = insets.bottom + 72;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: floatingBottom + 72 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {cfBanner && (
          <View style={styles.cfBanner}>
            <Ionicons name="shield-outline" size={16} color={Colors.danger} />
            <Text style={styles.cfBannerText}>
              This site uses bot protection. Paste the article text instead.
            </Text>
            <TouchableOpacity onPress={() => setCfBanner(false)}>
              <Ionicons name="close" size={16} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.appTitle}>Sonera</Text>
          </View>
          <Text style={styles.subtitle}>Turn any content into audio</Text>
        </View>

        {/* Input card */}
        <View style={styles.card}>

          {/* Single smart input */}
          <View style={styles.inputWrap}>
            {pdfInput ? (
              <View style={styles.pdfPill}>
                <Ionicons name="document-attach-outline" size={16} color={Colors.primary} />
                <Text style={styles.pdfPillText} numberOfLines={1}>{pdfInput.name}</Text>
                <TouchableOpacity onPress={() => setPdfInput(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={Colors.textDim} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  style={styles.textInput}
                  value={inputText}
                  onChangeText={(v) => { setInputText(v); setClipboardBanner(null); }}
                  onFocus={onInputFocus}
                  placeholder="Paste a URL or article text…"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                />
                <TouchableOpacity style={styles.attachBtn} onPress={onPickPdf} hitSlop={6}>
                  <Ionicons name="attach-outline" size={22} color={Colors.textMuted} />
                  <View style={styles.attachPdfBadge}>
                    <Text style={styles.attachPdfBadgeText}>PDF</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* Detected type indicator */}
            {!pdfInput && inputText.trim().length > 0 && (
              <View style={styles.detectedRow}>
                <Ionicons
                  name={isUrl ? 'link-outline' : 'document-text-outline'}
                  size={13}
                  color={Colors.textDim}
                />
                <Text style={styles.detectedText}>
                  {isUrl ? 'URL detected' : 'Article text'}
                </Text>
                <TouchableOpacity
                  onPress={() => { setInputText(''); setClipboardBanner(null); }}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={15} color={Colors.textDim} />
                </TouchableOpacity>
              </View>
            )}

            {/* Clipboard suggestion */}
            {!pdfInput && clipboardBanner && (
              <TouchableOpacity
                style={styles.clipboardBanner}
                onPress={() => { setInputText(clipboardBanner); setClipboardBanner(null); }}
              >
                <Ionicons name="clipboard-outline" size={13} color={Colors.primary} />
                <Text style={styles.clipboardText} numberOfLines={1}>
                  Paste: {clipboardBanner}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Format selector */}
          <View style={styles.optionSection}>
            <View style={styles.segmented}>
              <TouchableOpacity
                style={[styles.segment, mode === 'tts' && styles.segmentActive]}
                onPress={() => setMode('tts')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="document-text"
                  size={14}
                  color={Colors.primary}
                />
                <Text style={[styles.segmentText, mode === 'tts' && styles.segmentTextActive]}>
                  Text to Speech
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segment, mode === 'podcast' && styles.segmentActive]}
                onPress={() => setMode('podcast')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="mic"
                  size={14}
                  color={Colors.primary}
                />
                <Text style={[styles.segmentText, mode === 'podcast' && styles.segmentTextActive]}>
                  Podcast
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Summarize toggle */}
          <View style={styles.switchRow}>
            <View style={styles.switchLabelGroup}>
              <Ionicons name="sparkles-outline" size={16} color={Colors.primary} />
              <View>
                <Text style={styles.switchLabel}>Summarize content</Text>
              </View>
            </View>
            <Switch
              value={summarize}
              onValueChange={setSummarize}
              trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
              thumbColor={summarize ? Colors.primary : Colors.textDim}
              ios_backgroundColor={Colors.border}
            />
          </View>

          {/* TTS-only: voice + language */}
          {mode === 'tts' && (
            <>
              <View style={styles.divider} />

              <View style={styles.switchRow}>
                <View style={styles.switchLabelGroup}>
                  <Ionicons name="mic-outline" size={16} color={Colors.primary} />
                  <Text style={styles.switchLabel}>Voice</Text>
                </View>
                <TouchableOpacity
                  style={styles.voiceChip}
                  onPress={() => setVoicePickerVisible(true)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.voiceChipText}>
                    {ttsVoice.charAt(0).toUpperCase() + ttsVoice.slice(1)}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={styles.divider} />

              <View style={styles.switchRow}>
                <View style={styles.switchLabelGroup}>
                  <Ionicons name="language-outline" size={16} color={Colors.primary} />
                  <Text style={styles.switchLabel}>Translate audio</Text>
                </View>
                <TouchableOpacity
                  style={styles.voiceChip}
                  onPress={() => setLangPickerVisible(true)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.voiceChipText}>
                    {LANGUAGES.find((l) => l.code === ttsLanguage)?.label ?? 'Auto'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </>
          )}

        </View>
      </ScrollView>

      {/* Floating Generate button */}
      <View style={[styles.floatingContainer, { bottom: floatingBottom }]}>
        <TouchableOpacity
          style={[styles.generateBtn, (checking || !canGenerate) && styles.generateBtnDisabled]}
          onPress={onGenerate}
          activeOpacity={0.85}
          disabled={checking || !canGenerate}
        >
          {checking ? (
            <ActivityIndicator color={Colors.bg} size="small" />
          ) : (
            <>
              <Ionicons name="sparkles" size={17} color={Colors.bg} />
              <Text style={styles.generateBtnText}>Generate</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <VoicePickerModal
        visible={voicePickerVisible}
        selectedVoice={ttsVoice}
        onSelect={handleVoiceSelect}
        onClose={() => setVoicePickerVisible(false)}
      />
      <LanguageWheelPicker
        visible={langPickerVisible}
        selectedCode={ttsLanguage}
        onSelect={setTtsLanguage}
        onClose={() => setLangPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingBottom: 32 },

  cfBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.danger + '22',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  cfBannerText: { flex: 1, color: Colors.danger, fontSize: FontSize.xs },

  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  appTitle: { color: Colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '500', opacity: 0.8 },

  card: {
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },

  inputWrap: { padding: Spacing.md, gap: Spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  textInput: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.sm,
    minHeight: 100,
    maxHeight: 200,
  },
  attachBtn: {
    paddingTop: 2,
    paddingLeft: Spacing.xs,
    alignItems: 'center',
    gap: 4,
  },
  attachPdfBadge: {
    backgroundColor: Colors.primary + '20',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '45',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  attachPdfBadgeText: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pdfPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  pdfPillText: {
    flex: 1,
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detectedText: {
    flex: 1,
    color: Colors.textDim,
    fontSize: FontSize.xs,
  },
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  clipboardText: { flex: 1, color: Colors.primary, fontSize: FontSize.xs },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },

  optionSection: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.bg,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: Radius.sm,
  },
  segmentActive: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  segmentText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '500' },
  segmentTextActive: { color: Colors.text, fontWeight: '600' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    gap: Spacing.md,
  },
  switchLabelGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  switchLabel: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  voiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  voiceChipText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  floatingContainer: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 16,
    shadowColor: Colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { color: Colors.bg, fontSize: FontSize.md, fontWeight: '700' },
});
