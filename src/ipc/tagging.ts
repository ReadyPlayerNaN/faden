import { invoke } from "@tauri-apps/api/core";

const emitHistoryChanged = () => {
  window.dispatchEvent(new Event("stt:history-changed"));
};

export type TagOnSpan = {
  tagId: number;
  source: "manual" | "ai_suggested" | "ai_accepted";
};

export type SpanDTO = {
  id: number;
  interviewId: number;
  segmentId: number;
  startOffset: number;
  endOffset: number;
  textSnapshot: string;
  audioStartSec: number;
  audioEndSec: number;
  createdAt: string;
  tags: TagOnSpan[];
  memo: string | null;
};

type RawTagOnSpan = {
  tag_id: number;
  source: "manual" | "ai_suggested" | "ai_accepted";
};
type RawSpan = {
  id: number;
  interview_id: number;
  segment_id: number;
  start_offset: number;
  end_offset: number;
  text_snapshot: string;
  audio_start_sec: number;
  audio_end_sec: number;
  created_at: string;
  tags: RawTagOnSpan[];
  memo: string | null;
};

const fromRaw = (r: RawSpan): SpanDTO => ({
  id: r.id,
  interviewId: r.interview_id,
  segmentId: r.segment_id,
  startOffset: r.start_offset,
  endOffset: r.end_offset,
  textSnapshot: r.text_snapshot,
  audioStartSec: r.audio_start_sec,
  audioEndSec: r.audio_end_sec,
  createdAt: r.created_at,
  tags: r.tags.map((t) => ({ tagId: t.tag_id, source: t.source })),
  memo: r.memo,
});

export const spanCreate = async (args: {
  interviewId: number;
  segmentId: number;
  startOffset: number;
  endOffset: number;
  tagIds: number[];
}): Promise<SpanDTO> => {
  const result = fromRaw(
    await invoke<RawSpan>("span_create", {
      args: {
        interview_id: args.interviewId,
        segment_id: args.segmentId,
        start_offset: args.startOffset,
        end_offset: args.endOffset,
        tag_ids: args.tagIds,
      },
    }),
  );
  emitHistoryChanged();
  return result;
};

export const spanUpdateTags = async (
  spanId: number,
  tagIds: number[],
): Promise<SpanDTO> => {
  const result = fromRaw(
    await invoke<RawSpan>("span_update_tags", { spanId, tagIds }),
  );
  emitHistoryChanged();
  return result;
};

export const spanUpdateOffsets = async (
  spanId: number,
  startOffset: number,
  endOffset: number,
): Promise<SpanDTO> => {
  const result = fromRaw(
    await invoke<RawSpan>("span_update_offsets", {
      spanId,
      startOffset,
      endOffset,
    }),
  );
  emitHistoryChanged();
  return result;
};

export const spanDelete = async (spanId: number): Promise<void> => {
  await invoke("span_delete", { spanId });
  emitHistoryChanged();
};

export const spanGet = async (spanId: number): Promise<SpanDTO> =>
  fromRaw(await invoke<RawSpan>("span_get", { spanId }));

export const spanListForInterview = async (
  interviewId: number,
): Promise<SpanDTO[]> =>
  (await invoke<RawSpan[]>("span_list_for_interview", { interviewId })).map(
    fromRaw,
  );

export const memoUpsert = async (spanId: number, body: string): Promise<void> => {
  await invoke("memo_upsert", { spanId, body });
  emitHistoryChanged();
};
