import { atom } from "jotai";

export type SegmentPlaybackRequest = {
  requestId: number;
  interviewId: number;
  segmentId: number;
  startSec: number;
  endSec: number;
  loop: boolean;
  autoplay: boolean;
};

export type SegmentPlaybackState = {
  activeSegmentId: number | null;
  startSec: number | null;
  endSec: number | null;
  loop: boolean;
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
  playing: false,
  currentTime: 0,
  duration: 0,
});
