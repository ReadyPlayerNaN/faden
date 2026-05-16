import { invoke } from "@tauri-apps/api/core";

const emitHistoryChanged = () => {
  window.dispatchEvent(new Event("stt:history-changed"));
};

export type SegmentDTO = {
  id: number;
  interviewId: number;
  speakerId: number | null;
  speakerLabelRaw: string | null;
  speakerDisplayName: string | null;
  startSec: number;
  endSec: number;
  text: string;
  orderIndex: number;
};

type Raw = {
  id: number;
  interview_id: number;
  speaker_id: number | null;
  speaker_label_raw: string | null;
  speaker_display_name: string | null;
  start_sec: number;
  end_sec: number;
  text: string;
  order_index: number;
};

const fromRaw = (r: Raw): SegmentDTO => ({
  id: r.id,
  interviewId: r.interview_id,
  speakerId: r.speaker_id,
  speakerLabelRaw: r.speaker_label_raw,
  speakerDisplayName: r.speaker_display_name,
  startSec: r.start_sec,
  endSec: r.end_sec,
  text: r.text,
  orderIndex: r.order_index,
});

export const segmentListForInterview = async (interviewId: number): Promise<SegmentDTO[]> =>
  (await invoke<Raw[]>("segment_list_for_interview", { interviewId })).map(fromRaw);

export const segmentUpdateText = async (segmentId: number, text: string): Promise<void> => {
  await invoke("segment_update_text", { segmentId, text });
  emitHistoryChanged();
};

export const segmentSetSpeaker = async (
  segmentId: number,
  speakerId: number | null,
): Promise<void> => {
  await invoke("segment_set_speaker", { segmentId, speakerId });
  emitHistoryChanged();
};

export const segmentDelete = (segmentId: number): Promise<void> =>
  invoke("segment_delete", { segmentId });

export const segmentSplit = (
  segmentId: number,
  splitOffset: number,
  splitAudioSec: number,
): Promise<number> => invoke("segment_split", { segmentId, splitOffset, splitAudioSec });

export const segmentMerge = (firstId: number, secondId: number): Promise<void> =>
  invoke("segment_merge", { firstId, secondId });
