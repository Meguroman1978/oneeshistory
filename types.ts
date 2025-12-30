
export type ArtStyle = 'manga' | 'realistic';
export type BgmType = 'bgm1' | 'bgm2' | 'energy';
export type AspectRatio = '9:16' | '16:9';
export type VeoMode = 'none' | 'first' | 'all';

export interface StudioProfile {
  id: string;
  name: string;
  youtubeClientId: string;
  youtubeClientSecret: string;
}

export interface Scene {
  imagePrompt: string;
  narrationText: string;
  displayText: string;
  duration?: number;
  imageUrl?: string;
  videoUrl?: string; 
  audioBuffer?: AudioBuffer;
}

export interface ScriptData {
  title: string;
  titleNarrationText: string; // タイトル読み上げ用
  topicName: string;
  description: string;
  scenes: Scene[];
}

export enum GenerationStatus {
  IDLE = 'IDLE',
  SCRIPTING = 'SCRIPTING',
  GENERATING_ASSETS = 'GENERATING_ASSETS',
  RECORDING = 'RECORDING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface LogEntry {
  message: string;
  timestamp: string;
  type: 'info' | 'success' | 'error';
}

export interface GeneratorSettings {
  numScenes: number;
  sceneDuration: number;
  artStyle: ArtStyle;
  bgmType: BgmType;
  bgmVolume: number;
  aspectRatio: AspectRatio;
  veoMode: VeoMode;
  profiles: StudioProfile[];
  activeProfileId: string;
}

export interface SuggestionResult {
  name: string;
  reason: string;
  type: 'person' | 'event';
  sourceUrl?: string;
}

export interface VideoHistoryItem {
  id: string;
  topic: string;
  blob?: Blob; // IndexedDBから復元される動画本体
  url?: string; // 再生用のObject URL
  script: ScriptData;
  timestamp: string;
}
