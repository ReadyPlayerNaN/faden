import { atom } from "jotai";
import type { HistoryStatus } from "../ipc/history";

export const historyStatusAtom = atom<HistoryStatus>({
  canUndo: false,
  canRedo: false,
});
