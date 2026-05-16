import type { LlmProvider } from "../ipc/settings";

export type TaskKind = "transcription" | "general";

export type ModelOption = {
  id: string;
  label: string;
  recommended?: boolean;
  tasks: TaskKind[];
  note?: string;
};

export type ProviderOption = {
  id: LlmProvider;
  label: string;
  description: string;
  supportsApiKey: boolean;
  models: ModelOption[];
};

export const PROVIDERS: ProviderOption[] = [
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini Developer API",
    supportsApiKey: true,
    models: [
      {
        id: "gemini-3-flash-preview",
        label: "Gemini 3 Flash Preview",
        recommended: true,
        tasks: ["transcription", "general"],
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        tasks: ["transcription", "general"],
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        tasks: ["general"],
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI cloud API",
    supportsApiKey: true,
    models: [
      {
        id: "gpt-4o-transcribe-diarize",
        label: "GPT-4o Transcribe Diarize",
        recommended: true,
        tasks: ["transcription"],
        note: "Speaker-aware transcription",
      },
      {
        id: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        recommended: true,
        tasks: ["general"],
      },
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        tasks: ["general"],
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude via Anthropic API",
    supportsApiKey: true,
    models: [
      {
        id: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        recommended: true,
        tasks: ["general"],
      },
      {
        id: "claude-opus-4-20250514",
        label: "Claude Opus 4",
        tasks: ["general"],
      },
    ],
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Local Ollama server",
    supportsApiKey: false,
    models: [
      {
        id: "qwen3:14b",
        label: "Qwen3 14B",
        recommended: true,
        tasks: ["general"],
      },
      {
        id: "llama3.1:8b",
        label: "Llama 3.1 8B",
        tasks: ["general"],
      },
    ],
  },
];

export const providerById = (id: LlmProvider): ProviderOption =>
  PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0]!;

export const modelsForTask = (task: TaskKind): ProviderOption[] =>
  PROVIDERS.map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => model.tasks.includes(task)),
  })).filter((provider) => provider.models.length > 0);
