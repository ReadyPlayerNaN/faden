import { invoke } from "@tauri-apps/api/core";

export type GlobalSettings = {
  geminiApiKey: string;
  recentProjects: string[];
  uiLanguage: string | null;
};

type RawGlobalSettings = {
  gemini_api_key?: string;
  recent_projects?: string[];
  ui_language?: string | null;
};

const rsToTs = (raw: RawGlobalSettings): GlobalSettings => ({
  geminiApiKey: raw.gemini_api_key ?? "",
  recentProjects: raw.recent_projects ?? [],
  uiLanguage: raw.ui_language ?? null,
});

const tsToRs = (s: GlobalSettings): RawGlobalSettings => ({
  gemini_api_key: s.geminiApiKey,
  recent_projects: s.recentProjects,
  ui_language: s.uiLanguage,
});

export const settingsGet = async (): Promise<GlobalSettings> =>
  rsToTs(await invoke<RawGlobalSettings>("settings_get"));

export const settingsSet = (s: GlobalSettings): Promise<void> =>
  invoke("settings_set", { value: tsToRs(s) });

export const settingsAddRecent = async (path: string): Promise<GlobalSettings> =>
  rsToTs(await invoke<RawGlobalSettings>("settings_add_recent", { path }));
