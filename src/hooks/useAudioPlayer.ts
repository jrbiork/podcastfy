import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio, AVPlaybackStatus, InterruptionModeIOS } from 'expo-av';

export function useAudioPlayer(uri: string | null) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [hasEnded, setHasEnded] = useState(false);

  const onPlaybackStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis);
    setDurationMs(status.durationMillis ?? 0);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMs(0);
      setHasEnded(true);
    }
  }, []);

  useEffect(() => {
    let sound: Audio.Sound | null = null;
    setHasEnded(false);
    setPositionMs(0);
    setDurationMs(0);

    const load = async () => {
      if (!uri) return;
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      });
      const { sound: s } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatus
      );
      sound = s;
      soundRef.current = s;
    };

    load().catch(console.error);

    return () => {
      sound?.unloadAsync().catch(() => {});
    };
  }, [uri, onPlaybackStatus]);

  const play = useCallback(async () => {
    setHasEnded(false);
    await soundRef.current?.playAsync();
  }, []);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
  }, []);

  const seek = useCallback(async (ms: number) => {
    setHasEnded(false);
    await soundRef.current?.setPositionAsync(ms);
  }, []);

  const skip = useCallback(
    async (deltaMs: number) => {
      const next = Math.max(0, Math.min(durationMs, positionMs + deltaMs));
      setHasEnded(false);
      await soundRef.current?.setPositionAsync(next);
    },
    [positionMs, durationMs]
  );

  const restart = useCallback(async () => {
    setHasEnded(false);
    await soundRef.current?.setPositionAsync(0);
    await soundRef.current?.playAsync();
  }, []);

  const setRate = useCallback(async (rate: number) => {
    await soundRef.current?.setRateAsync(rate, true);
  }, []);

  return { isPlaying, positionMs, durationMs, hasEnded, play, pause, seek, skip, restart, setRate };
}
