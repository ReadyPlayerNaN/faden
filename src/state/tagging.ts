import { atom } from "jotai";
import type { SpanDTO } from "../ipc/tagging";

export const spansForCurrentInterviewAtom = atom<SpanDTO[]>([]);
export const selectedSpanIdAtom = atom<number | null>(null);

export const selectedSpanAtom = atom((get) => {
  const id = get(selectedSpanIdAtom);
  if (id === null) return null;
  return get(spansForCurrentInterviewAtom).find((s) => s.id === id) ?? null;
});

export const activeTagForFindMoreAtom = atom<number | null>((get) => {
  const span = get(selectedSpanAtom);
  if (!span || span.tags.length === 0) return null;
  return span.tags[0].tagId;
});

export type ActiveSelection = {
  segmentId: number;
  startOffset: number;
  endOffset: number;
  text: string;
  anchorRect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null;
} | null;

export const activeTextSelectionAtom = atom<ActiveSelection>(null);
