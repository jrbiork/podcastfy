import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import { playbackService } from './src/services/playbackService';
import { ensurePlayerSetup } from './src/hooks/useAudioPlayer';

TrackPlayer.registerPlaybackService(() => playbackService);
ensurePlayerSetup();
registerRootComponent(App);
