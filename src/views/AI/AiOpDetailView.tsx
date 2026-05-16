import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useSetAtom } from "jotai";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import {
  aiProposalList,
  aiRunGet,
  type AiRunDTO,
  type ProposalDTO,
} from "../../ipc/ai";
import { interviewList as fetchInterviews, type Interview } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import { formatTimestamp } from "./aiOperations";
import styles from "./AiOpDetailView.module.css";

type CodebookTag = {
  name: string;
  description?: string | null;
  evidence_quotes?: string[];
};

type SpanSuggestion = {
  segment_id: number;
  start_offset: number;
  end_offset: number;
  tag_names: string[];
  rationale?: string | null;
};

type ModelInputPart = {
  text?: string;
  fileData?: {
    fileUri?: string;
    mimeType?: string;
  };
};

type ModelInputMessage = {
  role?: string;
  parts?: ModelInputPart[];
};

type StructuredModelInput = {
  mode?: string;
  note?: string;
  userPromptTemplate?: string;
  systemInstruction?: ModelInputMessage;
  contents?: ModelInputMessage[];
  generationConfig?: unknown;
  responseSchema?: unknown;
  chunkSeconds?: number;
  maxOutputTokens?: number;
};

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);
const tryParseJson = <T,>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const formatMessageParts = (parts: ModelInputPart[] | undefined): string => {
  if (!parts?.length) return "";
  return parts
    .map((part) => {
      if (part.text) return part.text;
      if (part.fileData?.fileUri || part.fileData?.mimeType) {
        return `[file: ${part.fileData.fileUri ?? "(no uri)"}${part.fileData.mimeType ? `, ${part.fileData.mimeType}` : ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
};

const interviewNameOf = (interviews: Interview[], interviewId: number | null) =>
  interviewId === null ? null : interviews.find((interview) => interview.id === interviewId)?.name ?? null;

const ProposalSection = ({ proposal }: { proposal: ProposalDTO }) => {
  const { t } = useTranslation();
  const payload = proposal.payload as {
    proposals?: CodebookTag[];
    suggestions?: SpanSuggestion[];
  };

  return (
    <section className={styles.card}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>
          {t(`ai.kinds.${proposal.kind}`)} #{proposal.id}
        </h3>
        <span className={`${styles.statusBadge} ${styles[`status_${proposal.status}`]}`}>
          {t(`ai.proposalStatus.${proposal.status === "pending" ? "new" : proposal.status}`)}
        </span>
      </div>
      <div className={styles.metaGrid}>
        <div>
          <span className={styles.metaLabel}>{t("ai.createdAt", { defaultValue: "Created" })}</span>
          <div>{formatTimestamp(proposal.createdAt)}</div>
        </div>
        <div>
          <span className={styles.metaLabel}>{t("ai.decidedAt", { defaultValue: "Decided" })}</span>
          <div>{formatTimestamp(proposal.decidedAt) ?? "—"}</div>
        </div>
      </div>

      {Array.isArray(payload.suggestions) && payload.suggestions.length > 0 && (
        <div className={styles.subsection}>
          <h4 className={styles.subsectionTitle}>
            {t("ai.linkedSuggestions", { defaultValue: "Linked suggestions" })}
          </h4>
          <ul className={styles.suggestionList}>
            {payload.suggestions.map((suggestion, index) => (
              <li key={`${proposal.id}-${index}`} className={styles.suggestionItem}>
                <div className={styles.suggestionTags}>
                  {suggestion.tag_names.map((tagName) => (
                    <span key={tagName} className={styles.tag}>
                      {tagName}
                    </span>
                  ))}
                </div>
                <div className={styles.suggestionMeta}>
                  seg {suggestion.segment_id} [{suggestion.start_offset}–{suggestion.end_offset}]
                </div>
                {suggestion.rationale && <p className={styles.rationale}>{suggestion.rationale}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(payload.proposals) && payload.proposals.length > 0 && (
        <div className={styles.subsection}>
          <h4 className={styles.subsectionTitle}>
            {t("ai.linkedSuggestions", { defaultValue: "Linked suggestions" })}
          </h4>
          <ul className={styles.suggestionList}>
            {payload.proposals.map((tag, index) => (
              <li key={`${proposal.id}-tag-${index}`} className={styles.suggestionItem}>
                <div className={styles.suggestionTags}>
                  <span className={styles.tag}>{tag.name}</span>
                </div>
                {tag.description && <p className={styles.rationale}>{tag.description}</p>}
                {tag.evidence_quotes?.length ? (
                  <ul className={styles.quoteList}>
                    {tag.evidence_quotes.map((quote, quoteIndex) => (
                      <li key={quoteIndex} className={styles.quoteItem}>
                        {quote}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.subsection}>
        <h4 className={styles.subsectionTitle}>{t("ai.payload", { defaultValue: "Stored payload" })}</h4>
        <pre className={styles.pre}>{prettyJson(proposal.payload)}</pre>
      </div>
    </section>
  );
};

export const AiOpDetailView = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath, runId } = useParams({ strict: false }) as {
    projectPath: string;
    runId: string;
  };
  const [project, setProject] = useAtom(currentProjectAtom);
  const [run, setRun] = useState<AiRunDTO | null>(null);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const setInterviews = useSetAtom(interviewListAtom);
  const [interviewsLocal, setInterviewsLocal] = useState<Interview[]>([]);

  useEffect(() => {
    const path = decodeURIComponent(projectPath);
    if (!project || project.path !== path) {
      void projectOpen(path).then(setProject);
    }
  }, [projectPath, project, setProject]);

  useEffect(() => {
    let cancelled = false;
    const numericRunId = Number(runId);
    setLoading(true);
    setError(null);
    void Promise.all([
      aiRunGet(numericRunId),
      aiProposalList(undefined, numericRunId),
      fetchInterviews(),
    ])
      .then(([nextRun, nextProposals, nextInterviews]) => {
        if (cancelled) return;
        setRun(nextRun);
        setProposals(nextProposals);
        setInterviews(nextInterviews);
        setInterviewsLocal(nextInterviews);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, setInterviews]);

  const interviewName = useMemo(
    () => interviewNameOf(interviewsLocal, run?.interviewId ?? null),
    [interviewsLocal, run?.interviewId],
  );
  const structuredInput = useMemo(
    () => tryParseJson<StructuredModelInput>(run?.inputJson),
    [run?.inputJson],
  );
  const systemPrompt = structuredInput
    ? formatMessageParts(structuredInput.systemInstruction?.parts)
    : "";
  const inputMessages = structuredInput?.contents ?? [];

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("ai.opDetailTitle", { defaultValue: "AI operation detail" })}</h1>
          <p className={styles.subtitle}>{project?.name ?? t("common.loading")}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            onClick={() =>
              void navigate({
                to: "/workspace/$projectPath/ai-ops",
                params: { projectPath },
              })
            }
          >
            ← {t("ai.opsTitle")}
          </Button>
        </div>
      </header>

      {loading ? (
        <p className={styles.empty}>{t("common.loading")}</p>
      ) : error ? (
        <p className={styles.empty}>{error}</p>
      ) : !run ? (
        <p className={styles.empty}>{t("errors.notFound")}</p>
      ) : (
        <div className={styles.layout}>
          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                {t(`ai.kinds.${run.kind}`)} #{run.id}
              </h2>
              <span className={`${styles.statusBadge} ${styles[`status_${run.status}`]}`}>
                {t(`ai.status.${run.status}`)}
              </span>
            </div>
            <div className={styles.metaGrid}>
              <div>
                <span className={styles.metaLabel}>{t("ai.startedAt")}</span>
                <div>{formatTimestamp(run.startedAt)}</div>
              </div>
              <div>
                <span className={styles.metaLabel}>{t("ai.completedAt")}</span>
                <div>{formatTimestamp(run.completedAt) ?? "—"}</div>
              </div>
              <div>
                <span className={styles.metaLabel}>{t("ai.model")}</span>
                <div>{run.model}</div>
              </div>
              <div>
                <span className={styles.metaLabel}>{t("workspace.interviews")}</span>
                <div>{interviewName ?? "—"}</div>
              </div>
            </div>
            {run.resultSummary && (
              <div className={styles.subsection}>
                <h3 className={styles.subsectionTitle}>{t("ai.resultSummary", { defaultValue: "Result summary" })}</h3>
                <p className={styles.textBlock}>{run.resultSummary}</p>
              </div>
            )}
            {run.error && (
              <div className={styles.subsection}>
                <h3 className={styles.subsectionTitle}>{t("common.error")}</h3>
                <pre className={`${styles.pre} ${styles.errorPre}`}>{run.error}</pre>
              </div>
            )}
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>
                {t("ai.structuredInput", { defaultValue: "Structured model input" })}
              </h3>
              {structuredInput ? (
                <>
                  {systemPrompt && (
                    <div className={styles.subsection}>
                      <h4 className={styles.subsectionTitle}>
                        {t("ai.systemPrompt", { defaultValue: "System prompt" })}
                      </h4>
                      <pre className={styles.pre}>{systemPrompt}</pre>
                    </div>
                  )}
                  {structuredInput.userPromptTemplate && (
                    <div className={styles.subsection}>
                      <h4 className={styles.subsectionTitle}>
                        {t("ai.userPromptTemplate", { defaultValue: "User prompt template" })}
                      </h4>
                      <pre className={styles.pre}>{structuredInput.userPromptTemplate}</pre>
                    </div>
                  )}
                  {inputMessages.length > 0 && (
                    <div className={styles.subsection}>
                      <h4 className={styles.subsectionTitle}>
                        {t("ai.inputMessages", { defaultValue: "Messages / contents" })}
                      </h4>
                      {inputMessages.map((message, index) => (
                        <div key={`${message.role ?? "message"}-${index}`} className={styles.subsection}>
                          <h5 className={styles.metaLabel}>
                            {message.role ?? t("ai.message", { defaultValue: "Message" })} #{index + 1}
                          </h5>
                          <pre className={styles.pre}>{formatMessageParts(message.parts)}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                  {(structuredInput.generationConfig || structuredInput.responseSchema) && (
                    <div className={styles.subsection}>
                      <h4 className={styles.subsectionTitle}>
                        {t("ai.requestSettings", { defaultValue: "Request settings" })}
                      </h4>
                      <pre className={styles.pre}>
                        {prettyJson({
                          generationConfig: structuredInput.generationConfig,
                          responseSchema: structuredInput.responseSchema,
                          chunkSeconds: structuredInput.chunkSeconds,
                          maxOutputTokens: structuredInput.maxOutputTokens,
                          mode: structuredInput.mode,
                          note: structuredInput.note,
                        })}
                      </pre>
                    </div>
                  )}
                  <div className={styles.subsection}>
                    <h4 className={styles.subsectionTitle}>
                      {t("ai.storedRequestJson", { defaultValue: "Stored request JSON" })}
                    </h4>
                    <pre className={styles.pre}>{run.inputJson}</pre>
                  </div>
                </>
              ) : (
                <p className={styles.emptyInline}>
                  {t("ai.noStructuredInput", {
                    defaultValue: "No structured model input was stored for this run.",
                  })}
                </p>
              )}
            </div>
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>{t("ai.fullInput", { defaultValue: "Full input prompt" })}</h3>
              <pre className={styles.pre}>{run.prompt}</pre>
            </div>
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>{t("ai.fullOutput", { defaultValue: "Full output" })}</h3>
              <pre className={styles.pre}>{run.rawOutput ?? t("ai.noStoredOutput", { defaultValue: "No raw output was stored for this operation." })}</pre>
            </div>
            {run.tokenUsageJson && (
              <div className={styles.subsection}>
                <h3 className={styles.subsectionTitle}>{t("ai.tokenUsage", { defaultValue: "Token usage" })}</h3>
                <pre className={styles.pre}>{run.tokenUsageJson}</pre>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                {t("ai.linkedSuggestions", { defaultValue: "Linked suggestions" })}
              </h2>
              <span className={styles.countBadge}>{proposals.length}</span>
            </div>
            {proposals.length === 0 ? (
              <p className={styles.emptyInline}>
                {t("ai.noLinkedSuggestions", { defaultValue: "No linked suggestions for this run." })}
              </p>
            ) : (
              <div className={styles.proposalStack}>
                {proposals.map((proposal) => (
                  <ProposalSection key={proposal.id} proposal={proposal} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
