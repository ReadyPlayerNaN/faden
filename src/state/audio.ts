import { atom } from "jotai";

export type SegmentPlaybackRequest = {
  requestId: number;
  interviewId: number;
  segmentId: number;
  startSec: number;
  endSec: number;
  loop: boolean;
  action: "play" | "pause" | "set-loop";
};

export type SegmentPlaybackState = {
  activeSegmentId: number | null;
  startSec: number | null;
  endSec: number | null;
  loop: boolean;
  loopBySegmentId: Record<number, boolean>;
  playing: boolean;
  currentTime: number;
  duration: number;
};

export const segmentPlaybackRequestAtom = atom<SegmentPlaybackRequest | null>(null);

export const segmentPlaybackStateAtom = atom<SegmentPlaybackState>({
  activeSegmentId: null,
  startSec: null,
  endSec: null,
  loop: false,
  loopBySegmentId: {},
  playing: false,
  currentTime: 0,
  duration: 0,
});
