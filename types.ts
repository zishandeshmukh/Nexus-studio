export enum AppMode {
  CHAT = 'CHAT',
  VISION = 'VISION',
  TTS = 'TTS',
  REPO = 'REPO'
}

export type ActiveView = 'agent' | 'report' | 'diagrams' | 'roadmap' | 'readme' | 'commits';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isError?: boolean;
}

export interface VisionResult {
  text: string;
  images: string[]; // Base64 strings
}

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr'
}