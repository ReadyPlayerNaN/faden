import { atom } from "jotai";
import type { GlobalSettings } from "../ipc/settings";

export const globalSettingsAtom = atom<GlobalSettings | null>(null);
