import { atom } from "jotai";
import type { AppearanceMode, GlobalSettings } from "../ipc/settings";

export const globalSettingsAtom = atom<GlobalSettings | null>(null);
export const themePreviewAtom = atom<AppearanceMode | null>(null);
