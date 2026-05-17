import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useParams } from "@tanstack/react-router";
import {
  buildTagMetaMap,
  codebookTree as fetchCodebookTree,
  type CodebookTree,
  type TagMeta,
} from "../../ipc/codebook";
import { interviewList as fetchInterviews, type Interview } from "../../ipc/interview";
import { projectOpen } from "../../ipc/project";
import { spanListForInterview, type SpanDTO } from "../../ipc/tagging";
import { codebookTreeAtom } from "../../state/codebook";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";

type SpanGroup = {
  interview: Interview;
  spans: SpanDTO[];
};

export type AnalysisItem = {
  span: SpanDTO;
  interview: Interview;
  tagMetas: TagMeta[];
};

export type MemoItem = AnalysisItem & {
  memo: string;
};

type AnalysisDataValue = {
  codebook: CodebookTree | null;
  interviews: Interview[];
  spanGroups: SpanGroup[];
  evidenceItems: AnalysisItem[];
  memoItems: MemoItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

type CacheEntry = Omit<AnalysisDataValue, "loading" | "error" | "refresh">;

const analysisCache = new Map<string, CacheEntry>();
const analysisRefreshInFlight = new Map<string, Promise<void>>();

const AnalysisDataContext = createContext<AnalysisDataValue | null>(null);

const buildDerivedItems = (codebook: CodebookTree, spanGroups: SpanGroup[]) => {
  const tagMetaById = buildTagMetaMap(codebook);
  const evidenceItems: AnalysisItem[] = [];
  const memoItems: MemoItem[] = [];

  for (const { interview, spans } of spanGroups) {
    for (const span of spans) {
      const tagMetas = span.tags
        .map((tagRef) => tagMetaById.get(tagRef.tagId))
        .filter((meta): meta is TagMeta => meta !== undefined);
      if (tagMetas.length === 0) continue;
      const item = { span, interview, tagMetas } satisfies AnalysisItem;
      evidenceItems.push(item);
      const memo = span.memo?.trim();
      if (memo) {
        memoItems.push({ ...item, memo });
      }
    }
  }

  return { evidenceItems, memoItems };
};

const snapshotToCache = (
  codebook: CodebookTree,
  interviews: Interview[],
  spanGroups: SpanGroup[],
): CacheEntry => {
  const derived = buildDerivedItems(codebook, spanGroups);
  return {
    codebook,
    interviews,
    spanGroups,
    evidenceItems: derived.evidenceItems,
    memoItems: derived.memoItems,
  };
};

export const AnalysisDataProvider = ({ children }: { children: ReactNode }) => {
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const cached = analysisCache.get(decodedProjectPath) ?? null;
  const [project, setProject] = useAtom(currentProjectAtom);
  const setCodebookTree = useSetAtom(codebookTreeAtom);
  const setInterviewList = useSetAtom(interviewListAtom);
  const [codebook, setCodebook] = useState<CodebookTree | null>(cached?.codebook ?? null);
  const [interviews, setInterviews] = useState<Interview[]>(cached?.interviews ?? []);
  const [spanGroups, setSpanGroups] = useState<SpanGroup[]>(cached?.spanGroups ?? []);
  const [evidenceItems, setEvidenceItems] = useState<AnalysisItem[]>(cached?.evidenceItems ?? []);
  const [memoItems, setMemoItems] = useState<MemoItem[]>(cached?.memoItems ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = (snapshot: CacheEntry) => {
    setCodebook(snapshot.codebook);
    setInterviews(snapshot.interviews);
    setSpanGroups(snapshot.spanGroups);
    setEvidenceItems(snapshot.evidenceItems);
    setMemoItems(snapshot.memoItems);
    setCodebookTree(snapshot.codebook);
    setInterviewList(snapshot.interviews);
    analysisCache.set(decodedProjectPath, snapshot);
  };

  const refresh = async (showSpinner = false) => {
    const existing = analysisRefreshInFlight.get(decodedProjectPath);
    if (existing) {
      if (showSpinner) setLoading(true);
      await existing.finally(() => setLoading(false));
      return;
    }

    const run = (async () => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const nextCodebook = await fetchCodebookTree();
        const nextInterviews = await fetchInterviews();
        const nextSpanGroups = await Promise.all(
          nextInterviews.map(async (interview) => ({
            interview,
            spans: await spanListForInterview(interview.id),
          })),
        );
        applySnapshot(snapshotToCache(nextCodebook, nextInterviews, nextSpanGroups));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        analysisRefreshInFlight.delete(decodedProjectPath);
      }
    })();

    analysisRefreshInFlight.set(decodedProjectPath, run);
    await run;
  };

  useEffect(() => {
    const cachedEntry = analysisCache.get(decodedProjectPath);
    if (cachedEntry) {
      applySnapshot(cachedEntry);
      setLoading(false);
    }
  }, [decodedProjectPath]);

  useEffect(() => {
    if (!project || project.path !== decodedProjectPath) {
      void projectOpen(decodedProjectPath)
        .then(setProject)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }
  }, [decodedProjectPath, project, setProject]);

  useEffect(() => {
    if (!project || project.path !== decodedProjectPath) return;
    if (analysisCache.has(decodedProjectPath)) return;
    void refresh(true);
  }, [decodedProjectPath, project]);

  useEffect(() => {
    const onHistoryChanged = () => {
      if (!project || project.path !== decodedProjectPath) return;
      void refresh(false);
    };
    window.addEventListener("stt:history-changed", onHistoryChanged);
    return () => window.removeEventListener("stt:history-changed", onHistoryChanged);
  }, [decodedProjectPath, project]);

  const value = useMemo<AnalysisDataValue>(
    () => ({
      codebook,
      interviews,
      spanGroups,
      evidenceItems,
      memoItems,
      loading,
      error,
      refresh: () => refresh(false),
    }),
    [codebook, interviews, spanGroups, evidenceItems, memoItems, loading, error],
  );

  return <AnalysisDataContext.Provider value={value}>{children}</AnalysisDataContext.Provider>;
};

export const useAnalysisData = () => {
  const value = useContext(AnalysisDataContext);
  if (!value) {
    throw new Error("useAnalysisData must be used within AnalysisDataProvider");
  }
  return value;
};
