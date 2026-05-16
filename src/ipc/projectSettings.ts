import { invoke } from "@tauri-apps/api/core";

export type PromptOverrides = {
  transcriptionSystem: string | null;
  transcriptionUser: string | null;
  codebookGen: string | null;
  pretag: string | null;
  findMore: string | null;
};

export type TranscriptionParams = {
  chunkSeconds: number;
  channels: number;
  sampleRate: number;
  bitrate: string;
};

export type ProjectSettings = {
  language: string | null;
  prompts: PromptOverrides;
  transcription: TranscriptionParams;
};

type RawPrompts = {
  transcription_system: string | null;
  transcription_user: string | null;
  codebook_gen: string | null;
  pretag: string | null;
  find_more: string | null;
};
type RawTranscription = {
  chunk_seconds: number;
  channels: number;
  sample_rate: number;
  bitrate: string;
};
type RawSettings = {
  language: string | null;
  prompts: RawPrompts;
  transcription: RawTranscription;
};

const fromRaw = (r: RawSettings): ProjectSettings => ({
  language: r.language,
  prompts: {
    transcriptionSystem: r.prompts.transcription_system,
    transcriptionUser: r.prompts.transcription_user,
    codebookGen: r.prompts.codebook_gen,
    pretag: r.prompts.pretag,
    findMore: r.prompts.find_more,
  },
  transcription: {
    chunkSeconds: r.transcription.chunk_seconds,
    channels: r.transcription.channels,
    sampleRate: r.transcription.sample_rate,
    bitrate: r.transcription.bitrate,
  },
});

const toRaw = (s: ProjectSettings): RawSettings => ({
  language: s.language,
  prompts: {
    transcription_system: s.prompts.transcriptionSystem,
    transcription_user: s.prompts.transcriptionUser,
    codebook_gen: s.prompts.codebookGen,
    pretag: s.prompts.pretag,
    find_more: s.prompts.findMore,
  },
  transcription: {
    chunk_seconds: s.transcription.chunkSeconds,
    channels: s.transcription.channels,
    sample_rate: s.transcription.sampleRate,
    bitrate: s.transcription.bitrate,
  },
});

export const projectSettingsGet = async (): Promise<ProjectSettings> =>
  fromRaw(await invoke<RawSettings>("project_settings_get"));

export const projectSettingsSet = (s: ProjectSettings): Promise<void> =>
  invoke("project_settings_set", { value: toRaw(s) });
