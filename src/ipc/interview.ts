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

export const interviewImportText = async (name: string, rawText: string): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_import_text", { name, rawText }));

export const interviewImportJson = async (name: string, rawJson: string): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_import_json", { name, rawJson }));

export const interviewImportAudioText = async (
  name: string,
  audioPath: string,
  rawText: string,
): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_import_audio_text", { name, audioPath, rawText }));

export const interviewImportAudioJson = async (
  name: string,
  audioPath: string,
  rawJson: string,
): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_import_audio_json", { name, audioPath, rawJson }));

export const interviewSetAudio = async (
  id: number,
  sourceAudioPath: string,
): Promise<Interview> =>
  fromRaw(
    await invoke<RawInterview>("interview_set_audio", { interviewId: id, sourceAudioPath }),
  );

export const interviewClearAudio = async (id: number): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_clear_audio", { interviewId: id }));

export const interviewReplaceTranscriptText = async (
  id: number,
  rawText: string,
): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_replace_transcript_text", { interviewId: id, rawText }));

export const interviewReplaceTranscriptJson = async (
  id: number,
  rawJson: string,
): Promise<Interview> =>
  fromRaw(await invoke<RawInterview>("interview_replace_transcript_json", { interviewId: id, rawJson }));

export const interviewAudioStreamUrl = (id: number): Promise<string> =>
  invoke("interview_audio_stream_url", { interviewId: id });
