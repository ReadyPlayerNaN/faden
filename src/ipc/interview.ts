import { invoke } from "@tauri-apps/api/core";

export type TranscriptStatus = "none" | "in_progress" | "complete" | "failed";

export type Interview = {
  id: number;
  name: string;
  recordedAt: string | null;
  audioPath: string | null;
  notes: string | null;
  transcriptStatus: TranscriptStatus;
  createdAt: string;
  updatedAt: string;
};

type RawInterview = {
  id: number;
  name: string;
  recorded_at: string | null;
  audio_path: string | null;
  notes: string | null;
  transcript_status: TranscriptStatus;
  created_at: string;
  updated_at: string;
};

const fromRaw = (r: RawInterview): Interview => ({
  id: r.id,
  name: r.name,
  recordedAt: r.recorded_at,
  audioPath: r.audio_path,
  notes: r.notes,
  transcriptStatus: r.transcript_status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const interviewCreate = async (name: string): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_create", { name }));

export const interviewList = async (): Promise<Interview[]> =>
  (await invoke<RawInterview[]>("interview_list")).map(fromRaw);

export const interviewGet = async (id: number): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_get", { id }));

export const interviewRename = (id: number, name: string): Promise<void> =>
  invoke("interview_rename", { id, name });

export const interviewDelete = (id: number): Promise<void> =>
  invoke("interview_delete", { id });

export const interviewCreateWithAudio = async (name: string, sourceAudioPath: string): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_create_with_audio", { name, sourceAudioPath }));
