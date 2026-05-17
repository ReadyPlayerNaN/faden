import { invoke } from "@tauri-apps/api/core";

export type RecentProject = {
  path: string;
  displayName: string;
};

export type LlmProvider = "gemini" | "openai" | "anthropic" | "ollama";
export type AppearanceMode = "system" | "light" | "dark";

export type TaskModelSelection = {
  provider: LlmProvider;
  model: string;
};

export type ProviderSettings = {
  gemini: { apiKey: string };
  openai: { apiKey: string; baseUrl: string };
  anthropic: { apiKey: string; baseUrl: string };
  ollama: { baseUrl: string; username: string; password: string };
};

export type GlobalSettings = {
  recentProjects: RecentProject[];
  uiLanguage: string | null;
  appearance: AppearanceMode;
  transcription: TaskModelSelection;
  generalAi: TaskModelSelection;
  providers: ProviderSettings;
};

export type ProviderConnectionStep = {
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
};

export type ProviderConnectionTestResult = {
  provider: LlmProvider;
  baseUrl: string | null;
  checkedModel: string | null;
  reachable: boolean;
  authenticated: boolean;
  modelAvailable: boolean | null;
  pricingKnown: boolean;
  ok: boolean;
  message: string;
  steps: ProviderConnectionStep[];
};

type RawRecentProject =
  | string
  | {
      path: string;
      display_name?: string;
    };

type RawTaskModelSelection = {
  provider?: LlmProvider;
  model?: string;
};

type RawGlobalSettings = {
  recent_projects?: RawRecentProject[];
  ui_language?: string | null;
  appearance?: AppearanceMode;
  transcription?: RawTaskModelSelection;
  general_ai?: RawTaskModelSelection;
  providers?: {
    gemini?: { api_key?: string };
    openai?: { api_key?: string; base_url?: string };
    anthropic?: { api_key?: string; base_url?: string };
    ollama?: { base_url?: string; username?: string; password?: string };
  };
};

const DEFAULT_TRANSCRIPTION: TaskModelSelection = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
};

const DEFAULT_GENERAL: TaskModelSelection = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
};

const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  gemini: { apiKey: "" },
  openai: { apiKey: "", baseUrl: "https://api.openai.com/v1" },
  anthropic: { apiKey: "", baseUrl: "https://api.anthropic.com" },
  ollama: { baseUrl: "http://127.0.0.1:11434", username: "", password: "" },
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

const selectionFromRaw = (
  raw: RawTaskModelSelection | undefined,
  fallback: TaskModelSelection,
): TaskModelSelection => ({
  provider: raw?.provider ?? fallback.provider,
  model: raw?.model ?? fallback.model,
});

const rsToTs = (raw: RawGlobalSettings): GlobalSettings => ({
  recentProjects: (raw.recent_projects ?? []).map(rawRecentToTs),
  uiLanguage: raw.ui_language ?? null,
  appearance: raw.appearance ?? "system",
  transcription: selectionFromRaw(raw.transcription, DEFAULT_TRANSCRIPTION),
  generalAi: selectionFromRaw(raw.general_ai, DEFAULT_GENERAL),
  providers: {
    gemini: {
      apiKey: raw.providers?.gemini?.api_key ?? DEFAULT_PROVIDER_SETTINGS.gemini.apiKey,
    },
    openai: {
      apiKey: raw.providers?.openai?.api_key ?? DEFAULT_PROVIDER_SETTINGS.openai.apiKey,
      baseUrl:
        raw.providers?.openai?.base_url ?? DEFAULT_PROVIDER_SETTINGS.openai.baseUrl,
    },
    anthropic: {
      apiKey:
        raw.providers?.anthropic?.api_key ?? DEFAULT_PROVIDER_SETTINGS.anthropic.apiKey,
      baseUrl:
        raw.providers?.anthropic?.base_url ??
        DEFAULT_PROVIDER_SETTINGS.anthropic.baseUrl,
    },
    ollama: {
      baseUrl:
        raw.providers?.ollama?.base_url ?? DEFAULT_PROVIDER_SETTINGS.ollama.baseUrl,
      username:
        raw.providers?.ollama?.username ?? DEFAULT_PROVIDER_SETTINGS.ollama.username,
      password:
        raw.providers?.ollama?.password ?? DEFAULT_PROVIDER_SETTINGS.ollama.password,
    },
  },
});

const tsToRs = (s: GlobalSettings): RawGlobalSettings => ({
  recent_projects: s.recentProjects.map((r) => ({
    path: r.path,
    display_name: r.displayName,
  })),
  ui_language: s.uiLanguage,
  appearance: s.appearance,
  transcription: s.transcription,
  general_ai: s.generalAi,
  providers: {
    gemini: { api_key: s.providers.gemini.apiKey },
    openai: {
      api_key: s.providers.openai.apiKey,
      base_url: s.providers.openai.baseUrl,
    },
    anthropic: {
      api_key: s.providers.anthropic.apiKey,
      base_url: s.providers.anthropic.baseUrl,
    },
    ollama: {
      base_url: s.providers.ollama.baseUrl,
      username: s.providers.ollama.username,
      password: s.providers.ollama.password,
    },
  },
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

export const settingsProviderTest = (
  provider: LlmProvider,
  model?: string,
): Promise<ProviderConnectionTestResult> =>
  invoke<ProviderConnectionTestResult>("settings_provider_test", {
    provider,
    model,
  });

export const settingsSystemAppearance = (): Promise<Extract<AppearanceMode, "light" | "dark">> =>
  invoke<Extract<AppearanceMode, "light" | "dark">>("settings_system_appearance");
