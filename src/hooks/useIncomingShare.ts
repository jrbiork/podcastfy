import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

function urlFromIncomingLink(link: string): string | null {
  const idx = link.indexOf('/generate');
  if (idx === -1) return null;
  const q = link.indexOf('?', idx);
  if (q === -1) return null;
  const params = new URLSearchParams(link.slice(q + 1));
  return params.get('url');
}

export function useIncomingShare(onUrl: (url: string) => void) {
  const onUrlRef = useRef(onUrl);
  onUrlRef.current = onUrl;

  useEffect(() => {
    const handle = (raw: string | null) => {
      if (!raw) return;
      const url = urlFromIncomingLink(raw);
      if (url) onUrlRef.current(url);
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
}
