import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import {
  settingsGet,
  settingsProviderTest,
  settingsSet,
  type GlobalSettings,
  type LlmProvider,
  type ProviderConnectionTestResult,
  type TaskModelSelection,
} from "../../ipc/settings";
import { globalSettingsAtom } from "../../state/settings";
import { currentProjectAtom } from "../../state/project";
import { PROVIDERS, modelsForTask, providerById, type TaskKind } from "../../llm/catalog";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { ErrorBanner } from "../../components/ErrorBanner";
import { PromptEditors } from "./PromptEditors";
import styles from "./Settings.module.css";

type LangChoice = "auto" | "en" | "cs";

type ProviderState = GlobalSettings["providers"];

const firstModelForTask = (provider: LlmProvider, task: TaskKind): string => {
  const option = providerById(provider);
  return option.models.find((model) => model.tasks.includes(task))?.id ?? "";
};

const normalizeSelection = (
  selection: TaskModelSelection,
  task: TaskKind,
): TaskModelSelection => {
  const provider = providerById(selection.provider);
  const supported = provider.models.some(
    (model) => model.id === selection.model && model.tasks.includes(task),
  );
  if (supported || selection.model.trim()) return selection;
  return { ...selection, model: firstModelForTask(selection.provider, task) };
};

const TaskSelector = ({
  task,
  label,
  value,
  onChange,
}: {
  task: TaskKind;
  label: string;
  value: TaskModelSelection;
  onChange: (next: TaskModelSelection) => void;
}) => {
  const { t } = useTranslation();
  const providers = useMemo(() => modelsForTask(task), [task]);
  const activeProvider = providerById(value.provider);
  const modelOptions = activeProvider.models.filter((model) => model.tasks.includes(task));

  return (
    <section className={styles.providerCard}>
      <h3 className={styles.providerTitle}>{label}</h3>
      <div className={styles.fieldRow}>
        <label className={styles.label}>
          {t("settings.provider")}
          <select
            className={styles.select}
            value={value.provider}
            onChange={(e) => {
              const provider = e.target.value as LlmProvider;
              onChange({ provider, model: firstModelForTask(provider, task) });
            }}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          {t("settings.recommendedModel")}
          <select
            className={styles.select}
            value={modelOptions.some((model) => model.id === value.model) ? value.model : ""}
            onChange={(e) => {
              const nextModel = e.target.value;
              if (!nextModel) return;
              onChange({ ...value, model: nextModel });
            }}
          >
            <option value="">{t("settings.keepCustomModel")}</option>
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
                {model.recommended ? ` — ${t("settings.recommended")}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.field}>
        <TextField
          label={t("settings.customModel")}
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        />
      </div>
      <p className={styles.helpText}>{activeProvider.description}</p>
    </section>
  );
};

export const Settings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath: backProjectPath } = useParams({ strict: false }) as {
    projectPath?: string;
  };
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [project, setProject] = useAtom(currentProjectAtom);
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const [transcription, setTranscription] = useState<TaskModelSelection>({
    provider: "gemini",
    model: "gemini-3-flash-preview",
  });
  const [generalAi, setGeneralAi] = useState<TaskModelSelection>({
    provider: "gemini",
    model: "gemini-3-flash-preview",
  });
  const [uiLanguage, setUiLanguage] = useState<LangChoice>("auto");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<LlmProvider | null>(null);
  const [testResults, setTestResults] = useState<
    Partial<Record<LlmProvider, ProviderConnectionTestResult>>
  >({});

  const applySettings = (next: NonNullable<typeof settings>) => {
    setSettings(next);
    setProviders(next.providers);
    setTranscription(normalizeSelection(next.transcription, "transcription"));
    setGeneralAi(normalizeSelection(next.generalAi, "general"));
    setUiLanguage((next.uiLanguage as LangChoice | null) ?? "auto");
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setSaveError(null);
    void settingsGet()
      .then((s) => {
        if (cancelled) return;
        applySettings(s);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSaveError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  const onSave = async () => {
    if (!settings || !providers || isLoading || isSaving) return;
    const next: GlobalSettings = {
      ...settings,
      providers,
      transcription,
      generalAi,
      uiLanguage: uiLanguage === "auto" ? null : uiLanguage,
    };
    setIsSaving(true);
    setSaveError(null);
    try {
      await settingsSet(next);
      const confirmed = await settingsGet();
      applySettings(confirmed);
      setSavedAt(Date.now());
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const runProviderTest = async (provider: LlmProvider) => {
    setTestingProvider(provider);
    try {
      const model =
        transcription.provider === provider
          ? transcription.model
          : generalAi.provider === provider
            ? generalAi.model
            : undefined;
      const result = await settingsProviderTest(provider, model);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
    } catch (error: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          provider,
          baseUrl: null,
          checkedModel: null,
          reachable: false,
          authenticated: false,
          modelAvailable: null,
          pricingKnown: false,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          steps: [],
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const onRenameProject = async () => {
    if (!project) return;
    const next = window.prompt(t("settings.projectName"), project.name);
    if (!next || next === project.name) return;
    await invoke("project_rename", { name: next });
    setProject({ ...project, name: next });
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("settings.title")}</h1>
        <Button
          onClick={() =>
            void navigate(
              backProjectPath
                ? {
                    to: "/workspace/$projectPath",
                    params: { projectPath: backProjectPath },
                  }
                : { to: "/" },
            )
          }
        >
          ← {t("settings.back")}
        </Button>
      </header>

      <section className={styles.section}>
        {saveError ? (
          <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
        ) : null}

        <h2 className={styles.sectionTitle}>{t("settings.providersTitle")}</h2>
        {providers &&
          PROVIDERS.map((provider) => (
            <div key={provider.id} className={styles.providerCard}>
              <h3 className={styles.providerTitle}>{provider.label}</h3>
              <p className={styles.helpText}>{provider.description}</p>
              {provider.id === "gemini" && (
                <div className={styles.field}>
                  <TextField
                    label={t("settings.apiKey")}
                    type="password"
                    value={providers.gemini.apiKey}
                    onChange={(e) =>
                      setProviders({
                        ...providers,
                        gemini: {
                          ...providers.gemini,
                          apiKey: e.target.value,
                        },
                      })
                    }
                    disabled={isLoading || isSaving}
                  />
                </div>
              )}
              {provider.id === "openai" && (
                <>
                  <div className={styles.field}>
                    <TextField
                      label={t("settings.apiKey")}
                      type="password"
                      value={providers.openai.apiKey}
                      onChange={(e) =>
                        setProviders({
                          ...providers,
                          openai: {
                            ...providers.openai,
                            apiKey: e.target.value,
                          },
                        })
                      }
                      disabled={isLoading || isSaving}
                    />
                  </div>
                  <div className={styles.field}>
                    <TextField
                      label={t("settings.baseUrl")}
                      value={providers.openai.baseUrl}
                      onChange={(e) =>
                        setProviders({
                          ...providers,
                          openai: {
                            ...providers.openai,
                            baseUrl: e.target.value,
                          },
                        })
                      }
                      disabled={isLoading || isSaving}
                    />
                  </div>
                </>
              )}
              {provider.id === "anthropic" && (
                <>
                  <div className={styles.field}>
                    <TextField
                      label={t("settings.apiKey")}
                      type="password"
                      value={providers.anthropic.apiKey}
                      onChange={(e) =>
                        setProviders({
                          ...providers,
                          anthropic: {
                            ...providers.anthropic,
                            apiKey: e.target.value,
                          },
                        })
                      }
                      disabled={isLoading || isSaving}
                    />
                  </div>
                  <div className={styles.field}>
                    <TextField
                      label={t("settings.baseUrl")}
                      value={providers.anthropic.baseUrl}
                      onChange={(e) =>
                        setProviders({
                          ...providers,
                          anthropic: {
                            ...providers.anthropic,
                            baseUrl: e.target.value,
                          },
                        })
                      }
                      disabled={isLoading || isSaving}
                    />
                  </div>
                </>
              )}
              {provider.id === "ollama" && (
                <div className={styles.field}>
                  <TextField
                    label={t("settings.baseUrl")}
                    value={providers.ollama.baseUrl}
                    onChange={(e) =>
                      setProviders({
                        ...providers,
                        ollama: {
                          ...providers.ollama,
                          baseUrl: e.target.value,
                        },
                      })
                    }
                    disabled={isLoading || isSaving}
                  />
                </div>
              )}
              <div className={styles.providerActions}>
                <Button
                  onClick={() => void runProviderTest(provider.id)}
                  disabled={isLoading || isSaving || testingProvider === provider.id}
                >
                  {testingProvider === provider.id
                    ? t("common.loading")
                    : t("settings.testConnection")}
                </Button>
              </div>
              {testResults[provider.id] && (
                <div className={styles.testResult}>
                  <div className={styles.testResultHeader}>
                    <strong>{testResults[provider.id]?.message}</strong>
                    <span
                      className={`${styles.testStatus} ${
                        testResults[provider.id]?.ok ? styles.testStatusOk : styles.testStatusError
                      }`}
                    >
                      {testResults[provider.id]?.ok
                        ? t("settings.testOk")
                        : t("settings.testFailed")}
                    </span>
                  </div>
                  {testResults[provider.id]?.baseUrl && (
                    <div className={styles.helpText}>
                      {t("settings.baseUrl")}: {testResults[provider.id]?.baseUrl}
                    </div>
                  )}
                  {testResults[provider.id]?.checkedModel && (
                    <div className={styles.helpText}>
                      {t("ai.model")}: {testResults[provider.id]?.checkedModel}
                    </div>
                  )}
                  <ul className={styles.testSteps}>
                    {testResults[provider.id]?.steps.map((step, index) => (
                      <li key={`${provider.id}-${index}`} className={styles.testStep}>
                        <span
                          className={`${styles.testPill} ${styles[`testPill${step.status[0]!.toUpperCase()}${step.status.slice(1)}` as const]}`}
                        >
                          {step.status}
                        </span>
                        <span>
                          <strong>{step.label}:</strong> {step.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

        <h2 className={styles.sectionTitle}>{t("settings.taskRoutingTitle")}</h2>
        <TaskSelector
          task="transcription"
          label={t("settings.transcriptionTask")}
          value={transcription}
          onChange={setTranscription}
        />
        <TaskSelector
          task="general"
          label={t("settings.generalTask")}
          value={generalAi}
          onChange={setGeneralAi}
        />

        <div className={styles.field}>
          <label className={styles.label}>
            {t("settings.uiLanguage")}
            <select
              className={styles.select}
              value={uiLanguage}
              onChange={(e) => setUiLanguage(e.target.value as LangChoice)}
              disabled={isLoading || isSaving}
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              <option value="en">{t("settings.languageEn")}</option>
              <option value="cs">{t("settings.languageCs")}</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => void onSave()}
            disabled={isLoading || isSaving || !settings || !providers}
          >
            {isSaving ? t("common.loading") : t("settings.save")}
          </Button>
          {savedAt && <span className={styles.saved}>{t("settings.saved")}</span>}
        </div>
      </section>

      {project && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("settings.projectSection")}</h2>
          <div className={styles.projectRow}>
            <span className={styles.projectName}>{project.name}</span>
            <Button onClick={() => void onRenameProject()}>
              {t("settings.rename")}
            </Button>
          </div>
        </section>
      )}

      <PromptEditors />
    </div>
  );
};
