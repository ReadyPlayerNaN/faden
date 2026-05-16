import { invoke } from "@tauri-apps/api/core";

export type RecentProject = {
  path: string;
  displayName: string;
};

export type GlobalSettings = {
  geminiApiKey: string;
  recentProjects: RecentProject[];
  uiLanguage: string | null;
  defaultTranscriptionModel: string;
  defaultAiModel: string;
};

type RawRecentProject =
  | string
  | {
      path: string;
      display_name?: string;
    };

type RawGlobalSettings = {
  gemini_api_key?: string;
  recent_projects?: RawRecentProject[];
  ui_language?: string | null;
  default_transcription_model?: string;
  default_ai_model?: string;
};

const fileName = (p: string): string => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
};

const rawRecentToTs = (r: RawRecentProject): RecentProject => {
  if (typeof r === "string") return { path: r, displayName: fileName(r) };
  return {
    path: r.path,
    displayName: r.display_name ?? fileName(r.path),
  };
};

const rsToTs = (raw: RawGlobalSettings): GlobalSettings => ({
  geminiApiKey: raw.gemini_api_key ?? "",
  recentProjects: (raw.recent_projects ?? []).map(rawRecentToTs),
  uiLanguage: raw.ui_language ?? null,
  defaultTranscriptionModel:
    raw.default_transcription_model ?? "gemini-3-flash-preview",
  defaultAiModel: raw.default_ai_model ?? "gemini-3-flash-preview",
});

const tsToRs = (s: GlobalSettings): RawGlobalSettings => ({
  gemini_api_key: s.geminiApiKey,
  recent_projects: s.recentProjects.map((r) => ({
    path: r.path,
    display_name: r.displayName,
  })),
  ui_language: s.uiLanguage,
  default_transcription_model: s.defaultTranscriptionModel,
  default_ai_model: s.defaultAiModel,
});

export const settingsGet = async (): Promise<GlobalSettings> =>
  rsToTs(await invoke<RawGlobalSettings>("settings_get"));

export const settingsSet = (s: GlobalSettings): Promise<void> =>
  invoke("settings_set", { value: tsToRs(s) });

export const settingsAddRecent = async (
  path: string,
  displayName?: string,
): Promise<GlobalSettings> =>
  rsToTs(
    await invoke<RawGlobalSettings>("settings_add_recent", {
      path,
      displayName,
    }),
  );

export const settingsRecentRename = async (
  path: string,
  displayName: string,
): Promise<GlobalSettings> =>
  rsToTs(
    await invoke<RawGlobalSettings>("settings_recent_rename", {
      path,
      displayName,
    }),
  );

export const settingsRecentRemove = async (
  path: string,
): Promise<GlobalSettings> =>
  rsToTs(
    await invoke<RawGlobalSettings>("settings_recent_remove", { path }),
  );
