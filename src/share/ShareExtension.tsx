import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { close, openHostApp, type InitialProps, Text, View } from 'expo-share-extension';
import { Colors, FontSize, Spacing, Radius } from '../utils/theme';

function pickUrl(props: InitialProps): string | null {
  if (props.url && props.url.startsWith('http')) return props.url;
  // Some apps pass the URL in the text field
  if (props.text && props.text.startsWith('http')) return props.text.split(/\s/)[0] ?? null;
  return null;
}

export default function ShareExtension(props: InitialProps) {
  const url = pickUrl(props);
  const [dispatched, setDispatched] = useState(false);

  useEffect(() => {
    if (!url || dispatched) return;
    setDispatched(true);
    openHostApp(`generate?url=${encodeURIComponent(url)}`);
  }, [url, dispatched]);

  const status = url ? 'Opening Podcastify…' : 'Share a web page URL to create a podcast.';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} allowFontScaling={false}>
        Podcastify
      </Text>
      <Text style={styles.body} allowFontScaling={false}>
        {status}
      </Text>
      {!url ? (
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
});
