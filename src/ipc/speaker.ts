import { invoke } from "@tauri-apps/api/core";

export type Speaker = {
  id: number;
  interviewId: number;
  labelRaw: string;
  displayName: string | null;
};

type Raw = {
  id: number;
  interview_id: number;
  label_raw: string;
  display_name: string | null;
};

const fromRaw = (r: Raw): Speaker => ({
  id: r.id,
  interviewId: r.interview_id,
  labelRaw: r.label_raw,
  displayName: r.display_name,
});

export const speakerListForInterview = async (interviewId: number): Promise<Speaker[]> =>
  (await invoke<Raw[]>("speaker_list_for_interview", { interviewId })).map(fromRaw);

export const speakerSetDisplayName = (
  speakerId: number,
  displayName: string | null,
): Promise<void> => invoke("speaker_set_display_name", { speakerId, displayName });

export const speakerCreate = async (
  interviewId: number,
  labelRaw: string,
  displayName: string | null,
): Promise<Speaker> =>
  fromRaw(
    await invoke<Raw>("speaker_create", { interviewId, labelRaw, displayName }),
  );

export const speakerMerge = (
  sourceSpeakerId: number,
  targetSpeakerId: number,
): Promise<void> =>
  invoke("speaker_merge", { sourceSpeakerId, targetSpeakerId });

export const speakerDelete = (speakerId: number): Promise<void> =>
  invoke("speaker_delete", { speakerId });
