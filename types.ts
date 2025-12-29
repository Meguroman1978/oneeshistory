
export type ArtStyle = 'manga' | 'realistic';
export type BgmType = 'bgm1' | 'bgm2';

export interface Scene {
  imagePrompt: string;
  narrationText: string;
  duration?: number;
  imageUrl?: string;
  audioBuffer?: AudioBuffer;
  beepTimings?: number[]; // ナレーション開始からの秒数
}

export interface ScriptData {
  title: string;
  topicName: string;
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
}
