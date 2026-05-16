import { invoke } from "@tauri-apps/api/core";

export type HistoryStatus = {
  canUndo: boolean;
  canRedo: boolean;
};

type RawHistoryStatus = {
  can_undo: boolean;
  can_redo: boolean;
};

const fromRaw = (raw: RawHistoryStatus): HistoryStatus => ({
  canUndo: raw.can_undo,
  canRedo: raw.can_redo,
});

const emitHistoryChanged = () => {
  window.dispatchEvent(new Event("stt:history-changed"));
};

export const historyUndo = async (): Promise<void> => {
  await invoke("history_undo");
  emitHistoryChanged();
};

export const historyRedo = async (): Promise<void> => {
  await invoke("history_redo");
  emitHistoryChanged();
};

export const historyStatus = async (): Promise<HistoryStatus> =>
  fromRaw(await invoke<RawHistoryStatus>("history_status"));
