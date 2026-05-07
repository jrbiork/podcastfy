import { useState, useCallback, useEffect } from 'react';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
  State,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';

type AudioTrackMeta = {
  title: string;
  artist?: string;
  artwork?: string | null;
  durationSeconds?: number;
  /** Called once decoded duration differs from stored metadata (e.g. script estimate vs real audio). */
  onDurationResolved?: (durationSeconds: number) => void;
};

let playerSetupPromise: Promise<void> | null = null;

export async function ensurePlayerSetup() {
  if (!playerSetupPromise) {
    playerSetupPromise = (async () => {
      await TrackPlayer.setupPlayer({
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
        iosCategoryOptions: [IOSCategoryOptions.AllowBluetooth, IOSCategoryOptions.AllowAirPlay],
      });
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.Stop,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause],
        progressUpdateEventInterval: 1,
        forwardJumpInterval: 30,
        backwardJumpInterval: 15,
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        },
      });
    })();
  }

  await playerSetupPromise;
}

export function useAudioPlayer(uri: string | null, meta?: AudioTrackMeta) {
  const [hasEnded, setHasEnded] = useState(false);
  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const positionMs = Math.floor(progress.position * 1000);
  const durationMs = Math.floor(progress.duration * 1000);
  const isPlaying = playbackState.state === State.Playing;

  useEffect(() => {
    let isCancelled = false;

    const setupTrack = async () => {
      if (!uri) return;
      await ensurePlayerSetup();
      if (isCancelled) return;

      await TrackPlayer.reset();
      const track = {
        id: uri,
        url: uri,
        title: meta?.title ?? 'Sonera',
        artist: meta?.artist ?? 'Sonera',
        artwork: meta?.artwork ?? undefined,
        duration: meta?.durationSeconds,
      };
      await TrackPlayer.load(track);
      await TrackPlayer.updateNowPlayingMetadata({
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        duration: track.duration,
      });
      if (!isCancelled) {
        setHasEnded(false);
      }
    };

    setupTrack().catch(console.error);
    return () => {
      isCancelled = true;
    };
  }, [uri, meta?.title, meta?.artist, meta?.artwork, meta?.durationSeconds]);

  useEffect(() => {
    const onResolve = meta?.onDurationResolved;
    if (!onResolve) return;
    const raw = progress.duration;
    if (!raw || raw <= 0 || !Number.isFinite(raw)) return;
    const seconds = Math.max(1, Math.floor(raw));
    const stored = meta.durationSeconds ?? 0;
    if (seconds !== stored) {
      onResolve(seconds);
    }
  }, [progress.duration, meta?.durationSeconds, meta?.onDurationResolved]);

  useEffect(() => {
    const queueEndedSub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      setHasEnded(true);
    });
    return () => {
      queueEndedSub.remove();
    };
  }, []);

  const play = useCallback(async () => {
    setHasEnded(false);
    await TrackPlayer.play();
  }, []);

  const pause = useCallback(async () => {
    await TrackPlayer.pause();
  }, []);

  const seek = useCallback(async (ms: number) => {
    setHasEnded(false);
    await TrackPlayer.seekTo(ms / 1000);
  }, []);

  const skip = useCallback(
    async (deltaMs: number) => {
      const next = Math.max(0, Math.min(durationMs || 0, positionMs + deltaMs));
      setHasEnded(false);
      await TrackPlayer.seekTo(next / 1000);
    },
    [positionMs, durationMs]
  );

  const restart = useCallback(async () => {
    setHasEnded(false);
    await TrackPlayer.seekTo(0);
    await TrackPlayer.play();
  }, []);

  const setRate = useCallback(async (rate: number) => {
    await TrackPlayer.setRate(rate);
  }, []);

  return { isPlaying, positionMs, durationMs, hasEnded, play, pause, seek, skip, restart, setRate };
}
