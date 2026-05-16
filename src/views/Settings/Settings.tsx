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
import { PROVIDERS, providerById, type TaskKind } from "../../llm/catalog";
import { Button } from "../../components/Button/Button";
import { TextField } from "../../components/TextField/TextField";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Modal } from "../../components/Modal/Modal";
import { PromptEditors } from "./PromptEditors";
import styles from "./Settings.module.css";

type LangChoice = "auto" | "en" | "cs";
type ProviderState = GlobalSettings["providers"];

type TaskSelectorProps = {
  task: TaskKind;
  label: string;
  value: TaskModelSelection;
  onChange: (next: TaskModelSelection) => void;
};

const CUSTOM_MODEL = "__custom__";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

const firstModelForTask = (provider: LlmProvider, task: TaskKind): string => {
  const option = providerById(provider);
  return option.models.find((model) => model.tasks.includes(task))?.id ?? "";
};

const normalizeSelection = (
  selection: TaskModelSelection,
  task: TaskKind,
): TaskModelSelection => {
  const option = providerById(selection.provider);
  const supports = option.models.some(
    (model) => model.id === selection.model && model.tasks.includes(task),
  );
  if (supports || selection.model.trim()) return selection;
  return { ...selection, model: firstModelForTask(selection.provider, task) };
};

const providerHasConfig = (provider: LlmProvider, providers: ProviderState): boolean => {
  switch (provider) {
    case "gemini":
      return providers.gemini.apiKey.trim().length > 0;
    case "openai":
      return (
        providers.openai.apiKey.trim().length > 0 ||
        providers.openai.baseUrl.trim() !== DEFAULT_OPENAI_BASE_URL
      );
    case "anthropic":
      return (
        providers.anthropic.apiKey.trim().length > 0 ||
        providers.anthropic.baseUrl.trim() !== DEFAULT_ANTHROPIC_BASE_URL
      );
    case "ollama":
      return (
        providers.ollama.baseUrl.trim() !== DEFAULT_OLLAMA_BASE_URL ||
        providers.ollama.username.trim().length > 0 ||
        providers.ollama.password.trim().length > 0
      );
  }
};

const deriveConfiguredProviders = (
  providers: ProviderState,
  transcription: TaskModelSelection,
  generalAi: TaskModelSelection,
): LlmProvider[] => {
  const selected = new Set<LlmProvider>([transcription.provider, generalAi.provider]);
  for (const provider of PROVIDERS) {
    if (providerHasConfig(provider.id, providers)) selected.add(provider.id);
  }
  return PROVIDERS.map((provider) => provider.id).filter((id) => selected.has(id));
};

const TaskSelector = ({ task, label, value, onChange }: TaskSelectorProps) => {
  const { t } = useTranslation();
  const activeProvider = providerById(value.provider);
  const modelOptions = activeProvider.models.filter((model) => model.tasks.includes(task));
  const usesPreset = modelOptions.some((model) => model.id === value.model);
  const selectValue = usesPreset ? value.model : CUSTOM_MODEL;

  return (
    <section className={styles.taskCard}>
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
            {PROVIDERS.filter((provider) =>
              provider.models.some((model) => model.tasks.includes(task)),
            ).map((provider) => (
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
            value={selectValue}
            onChange={(e) => {
              const nextValue = e.target.value;
              if (nextValue === CUSTOM_MODEL) {
                onChange({ ...value, model: usesPreset ? "" : value.model });
                return;
              }
              onChange({ ...value, model: nextValue });
            }}
          >
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
                {model.recommended ? ` — ${t("settings.recommended")}` : ""}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>{t("settings.customModel")}</option>
          </select>
        </label>
      </div>

      {selectValue === CUSTOM_MODEL && (
        <div className={styles.field}>
          <TextField
            label={t("settings.customModel")}
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
        </div>
      )}
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
  const [configuredProviders, setConfiguredProviders] = useState<LlmProvider[]>([]);
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
  const [editorProvider, setEditorProvider] = useState<LlmProvider | null>(null);
  const [editorChoice, setEditorChoice] = useState<LlmProvider | "">("");
  const [providerDrafts, setProviderDrafts] = useState<ProviderState | null>(null);

  const applySettings = (next: NonNullable<typeof settings>) => {
    const normalizedTranscription = normalizeSelection(next.transcription, "transcription");
    const normalizedGeneral = normalizeSelection(next.generalAi, "general");
    setSettings(next);
    setProviders(next.providers);
    setConfiguredProviders(
      deriveConfiguredProviders(next.providers, normalizedTranscription, normalizedGeneral),
    );
    setTranscription(normalizedTranscription);
    setGeneralAi(normalizedGeneral);
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

  const unconfiguredProviders = useMemo(
    () => PROVIDERS.map((provider) => provider.id).filter((id) => !configuredProviders.includes(id)),
    [configuredProviders],
  );

  const openProviderEditor = (provider: LlmProvider) => {
    if (!providers) return;
    setProviderDrafts(structuredClone(providers));
    setEditorChoice(provider);
    setEditorProvider(provider);
  };

  const startProviderAddFlow = () => {
    if (!providers) return;
    setProviderDrafts(structuredClone(providers));
    setEditorChoice(unconfiguredProviders[0] ?? "");
    setEditorProvider(null);
  };

  const commitProviderChoice = () => {
    if (!editorChoice) return;
    setEditorProvider(editorChoice);
  };

  const closeEditor = () => {
    setEditorProvider(null);
    setEditorChoice("");
    setProviderDrafts(null);
  };

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

        <div className={styles.sectionHeaderRow}>
          <h2 className={styles.sectionTitle}>{t("settings.providersTitle")}</h2>
          <Button
            onClick={startProviderAddFlow}
            disabled={isLoading || isSaving || unconfiguredProviders.length === 0}
          >
            {t("settings.configureProvider")}
          </Button>
        </div>

        {providers && configuredProviders.length > 0 ? (
          <div className={styles.providerList}>
            {configuredProviders.map((providerId) => {
              const provider = providerById(providerId);
              const testResult = testResults[providerId];
              return (
                <div key={providerId} className={styles.providerListItem}>
                  <div>
                    <h3 className={styles.providerTitle}>{provider.label}</h3>
                    <p className={styles.helpText}>{provider.description}</p>
                    {testResult && <p className={styles.helpText}>{testResult.message}</p>}
                  </div>
                  <div className={styles.providerListActions}>
                    <Button onClick={() => openProviderEditor(providerId)}>
                      {t("settings.configure")}
                    </Button>
                    <Button
                      onClick={() => void runProviderTest(providerId)}
                      disabled={testingProvider === providerId}
                    >
                      {testingProvider === providerId
                        ? t("common.loading")
                        : t("settings.testConnection")}
                    </Button>
                  </div>
                  {testResult && (
                    <div className={styles.testResult}>
                      <ul className={styles.testSteps}>
                        {testResult.steps.map((step, index) => (
                          <li key={`${providerId}-${index}`} className={styles.testStep}>
                            <span
                              className={`${styles.testPill} ${
                                step.status === "ok"
                                  ? styles.testPillOk
                                  : step.status === "warn"
                                    ? styles.testPillWarn
                                    : styles.testPillError
                              }`}
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
              );
            })}
          </div>
        ) : (
          <p className={styles.helpText}>{t("settings.noConfiguredProviders")}</p>
        )}

        <h2 className={styles.sectionTitle}>{t("settings.taskRoutingTitle")}</h2>
        <TaskSelector
          task="transcription"
          label={t("settings.transcriptionTask")}
          value={transcription}
          onChange={(next) => {
            setTranscription(next);
            if (!configuredProviders.includes(next.provider)) {
              setConfiguredProviders((prev) => [...prev, next.provider]);
            }
          }}
        />
        <TaskSelector
          task="general"
          label={t("settings.generalTask")}
          value={generalAi}
          onChange={(next) => {
            setGeneralAi(next);
            if (!configuredProviders.includes(next.provider)) {
              setConfiguredProviders((prev) => [...prev, next.provider]);
            }
          }}
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
            <Button onClick={() => void onRenameProject()}>{t("settings.rename")}</Button>
          </div>
        </section>
      )}

      <PromptEditors />

      <Modal
        open={!!providers && (!!editorProvider || (!editorProvider && !!editorChoice))}
        onClose={closeEditor}
        title={
          editorProvider
            ? t("settings.configureProviderTitle", {
                provider: providerById(editorProvider).label,
              })
            : t("settings.configureProvider")
        }
        footer={
          editorProvider ? (
            <>
              <Button onClick={closeEditor}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!editorProvider || !providerDrafts) return;
                  setProviders(providerDrafts);
                  setConfiguredProviders((prev) =>
                    prev.includes(editorProvider) ? prev : [...prev, editorProvider],
                  );
                  closeEditor();
                }}
              >
                {t("common.save")}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={closeEditor}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={commitProviderChoice} disabled={!editorChoice}>
                {t("common.continue", { defaultValue: "Continue" })}
              </Button>
            </>
          )
        }
      >
        {!editorProvider ? (
          <label className={styles.label}>
            {t("settings.provider")}
            <select
              className={styles.select}
              value={editorChoice}
              onChange={(e) => setEditorChoice(e.target.value as LlmProvider)}
            >
              <option value="">{t("settings.selectProvider")}</option>
              {unconfiguredProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {providerById(provider).label}
                </option>
              ))}
            </select>
          </label>
        ) : providerDrafts && editorProvider ? (
          <div className={styles.modalFields}>
            {editorProvider === "gemini" && (
              <div className={styles.field}>
                <TextField
                  label={t("settings.apiKey")}
                  type="password"
                  value={providerDrafts.gemini.apiKey}
                  onChange={(e) =>
                    setProviderDrafts({
                      ...providerDrafts,
                      gemini: { ...providerDrafts.gemini, apiKey: e.target.value },
                    })
                  }
                />
              </div>
            )}
            {editorProvider === "openai" && (
              <>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.apiKey")}
                    type="password"
                    value={providerDrafts.openai.apiKey}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        openai: { ...providerDrafts.openai, apiKey: e.target.value },
                      })
                    }
                  />
                </div>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.baseUrl")}
                    value={providerDrafts.openai.baseUrl}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        openai: { ...providerDrafts.openai, baseUrl: e.target.value },
                      })
                    }
                  />
                </div>
              </>
            )}
            {editorProvider === "anthropic" && (
              <>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.apiKey")}
                    type="password"
                    value={providerDrafts.anthropic.apiKey}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        anthropic: { ...providerDrafts.anthropic, apiKey: e.target.value },
                      })
                    }
                  />
                </div>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.baseUrl")}
                    value={providerDrafts.anthropic.baseUrl}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        anthropic: { ...providerDrafts.anthropic, baseUrl: e.target.value },
                      })
                    }
                  />
                </div>
              </>
            )}
            {editorProvider === "ollama" && (
              <>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.baseUrl")}
                    value={providerDrafts.ollama.baseUrl}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        ollama: { ...providerDrafts.ollama, baseUrl: e.target.value },
                      })
                    }
                  />
                </div>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.username")}
                    value={providerDrafts.ollama.username}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        ollama: { ...providerDrafts.ollama, username: e.target.value },
                      })
                    }
                  />
                </div>
                <div className={styles.field}>
                  <TextField
                    label={t("settings.password")}
                    type="password"
                    value={providerDrafts.ollama.password}
                    onChange={(e) =>
                      setProviderDrafts({
                        ...providerDrafts,
                        ollama: { ...providerDrafts.ollama, password: e.target.value },
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
