import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

interface IncomingShare {
  url?: string;
  pdf?: string;
}

function decodeIfEncoded(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9a-f]{2}/i.test(current)) break;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function parseIncomingLink(link: string): IncomingShare | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'podcastify:') return null;

  const route = `${parsed.host}${parsed.pathname}`.replace(/^\/+/, '');
  if (!route.startsWith('generate')) return null;

  const params = parsed.searchParams;
  const url = params.get('url');
  const pdf = params.get('pdf');
  if (url) return { url: decodeIfEncoded(url) };
  if (pdf) return { pdf: decodeIfEncoded(pdf) };
  return null;
}

export function useIncomingShare(onUrl: (url: string) => void, onPdf?: (fileUri: string) => void) {
  const onUrlRef = useRef(onUrl);
  onUrlRef.current = onUrl;
  const onPdfRef = useRef(onPdf);
  onPdfRef.current = onPdf;

  useEffect(() => {
    const handle = (raw: string | null) => {
      if (!raw) return;
      const share = parseIncomingLink(raw);
      if (!share) return;
      if (share.url) onUrlRef.current(share.url);
      else if (share.pdf) onPdfRef.current?.(share.pdf);
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
}
