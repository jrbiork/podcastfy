import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { close, openHostApp, type InitialProps, Text, View } from 'expo-share-extension';
import { Colors, FontSize, Spacing, Radius } from '../utils/theme';

function pickUrl(props: InitialProps): string | null {
  const extractHttpUrl = (value?: string | null): string | null => {
    if (!value) return null;
    const direct = value.trim();
    if (/^https?:\/\//i.test(direct)) return direct;
    const match = value.match(/https?:\/\/[^\s"'<>]+/i);
    return match?.[0] ?? null;
  };

  const fromUrl = extractHttpUrl(props.url);
  if (fromUrl) return fromUrl;
  const fromText = extractHttpUrl(props.text);
  if (fromText) return fromText;
  return null;
}

function pickPdf(props: InitialProps): string | null {
  const files = (props as any).files as unknown[] | undefined;
  if (!files?.length) return null;

  for (const file of files) {
    const uri = typeof file === 'string'
      ? file
      : file && typeof file === 'object' && 'uri' in (file as Record<string, unknown>)
        ? ((file as Record<string, unknown>).uri as string | undefined)
        : undefined;

    if (!uri) continue;
    const lower = uri.toLowerCase();
    if (lower.endsWith('.pdf') || lower.includes('.pdf')) return uri;
  }

  return null;
}

export default function ShareExtension(props: InitialProps) {
  const url = pickUrl(props);
  const pdf = !url ? pickPdf(props) : null;
  const [dispatched, setDispatched] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const targetPath = url
    ? `generate?url=${url}`
    : pdf
      ? `generate?pdf=${pdf}`
      : null;

  const openApp = () => {
    if (!targetPath) return;
    try {
      openHostApp(targetPath);
      setOpenError(null);
    } catch (e) {
      setOpenError((e as { message?: string }).message ?? 'Could not open Sonera.');
    }
  };

  useEffect(() => {
    if (dispatched || !targetPath) return;
    setDispatched(true);
    openApp();
  }, [dispatched, targetPath]);

  const status = url
    ? 'Opening Sonera…'
    : pdf
    ? 'Opening PDF in Sonera…'
    : 'Share a web page URL or PDF to create audio.';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} allowFontScaling={false}>
        Sonera
      </Text>
      <Text style={styles.body} allowFontScaling={false}>
        {status}
      </Text>
      {targetPath ? (
        <TouchableOpacity style={styles.btnPrimary} onPress={openApp} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText} allowFontScaling={false}>
            Open Sonera
          </Text>
        </TouchableOpacity>
      ) : null}
      {openError ? (
        <Text style={styles.error} allowFontScaling={false}>
          {openError}
        </Text>
      ) : null}
      {!url && !pdf ? (
        <TouchableOpacity style={styles.btn} onPress={() => close()} activeOpacity={0.85}>
          <Text style={styles.btnText} allowFontScaling={false}>
            Close
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  body: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
  },
  btn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnText: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  btnPrimary: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.text,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
  },
  btnPrimaryText: {
    color: Colors.bg,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  error: {
    color: '#FF8888',
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
