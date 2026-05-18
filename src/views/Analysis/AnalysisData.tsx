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
import { type Person, personList as fetchPeople } from "../../ipc/person";
import { projectOpen } from "../../ipc/project";
import { segmentListForInterview, type SegmentDTO } from "../../ipc/segment";
import { speakerListForInterview, type Speaker } from "../../ipc/speaker";
import { spanListForInterview, type SpanDTO } from "../../ipc/tagging";
import { interviewListAtom } from "../../state/interview";
import { currentProjectAtom } from "../../state/project";
import { normalizeAnalysisCodebook } from "./analysisCodebook";

type SpanGroup = {
  interview: Interview;
  spans: SpanDTO[];
};

type SegmentGroup = {
  interview: Interview;
  segments: SegmentDTO[];
};

type SpeakerGroup = {
  interview: Interview;
  speakers: Speaker[];
};

export type ParticipantRef = {
  key: string;
  name: string;
  kind: "person" | "speaker" | "unknown";
  linked: boolean;
  person: Person | null;
  speakerId: number | null;
  interviewId: number;
  hasContact: boolean;
};

export type AnalysisItem = {
  span: SpanDTO;
  interview: Interview;
  tagMetas: TagMeta[];
  memo: string | null;
  participant: ParticipantRef;
};

export type MemoItem = AnalysisItem & {
  memo: string;
};

type AnalysisDataValue = {
  codebook: CodebookTree | null;
  interviews: Interview[];
  people: Person[];
  spanGroups: SpanGroup[];
  segmentGroups: SegmentGroup[];
  speakerGroups: SpeakerGroup[];
  segmentsByInterview: Map<number, Map<number, SegmentDTO>>;
  speakersByInterview: Map<number, Map<number, Speaker>>;
  evidenceItems: AnalysisItem[];
  memoItems: MemoItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

type CacheEntry = Omit<AnalysisDataValue, "loading" | "error" | "refresh" | "segmentsByInterview" | "speakersByInterview">;

const analysisCache = new Map<string, CacheEntry>();
const analysisRefreshInFlight = new Map<string, Promise<void>>();

const AnalysisDataContext = createContext<AnalysisDataValue | null>(null);

const buildSegmentLookup = (segmentGroups: SegmentGroup[]) =>
  new Map(
    segmentGroups.map(({ interview, segments }) => [
      interview.id,
      new Map(segments.map((segment) => [segment.id, segment])),
    ]),
  );

const buildSpeakerLookup = (speakerGroups: SpeakerGroup[]) =>
  new Map(
    speakerGroups.map(({ interview, speakers }) => [
      interview.id,
      new Map(speakers.map((speaker) => [speaker.id, speaker])),
    ]),
  );

const buildParticipantRef = (args: {
  interview: Interview;
  span: SpanDTO;
  segmentsByInterview: Map<number, Map<number, SegmentDTO>>;
  speakersByInterview: Map<number, Map<number, Speaker>>;
  peopleById: Map<number, Person>;
}): ParticipantRef => {
  const segment = args.segmentsByInterview.get(args.interview.id)?.get(args.span.segmentId) ?? null;
  const speaker = segment?.speakerId
    ? (args.speakersByInterview.get(args.interview.id)?.get(segment.speakerId) ?? null)
    : null;
  const person = speaker?.personId ? (args.peopleById.get(speaker.personId) ?? null) : null;

  const fallbackSpeakerName =
    speaker?.effectiveName?.trim() ||
    segment?.speakerDisplayName?.trim() ||
    segment?.speakerLabelRaw?.trim() ||
    "Unknown speaker";

  return person
    ? {
        key: `person:${person.id}`,
        name: person.name,
        kind: "person",
        linked: true,
        person,
        speakerId: speaker?.id ?? null,
        interviewId: args.interview.id,
        hasContact: Boolean(person.email || person.phone),
      }
    : speaker
      ? {
          key: `speaker:${args.interview.id}:${speaker.id}`,
          name: fallbackSpeakerName,
          kind: "speaker",
          linked: false,
          person: null,
          speakerId: speaker.id,
          interviewId: args.interview.id,
          hasContact: false,
        }
      : {
          key: `unknown:${args.interview.id}:${fallbackSpeakerName}`,
          name: fallbackSpeakerName,
          kind: "unknown",
          linked: false,
          person: null,
          speakerId: null,
          interviewId: args.interview.id,
          hasContact: false,
        };
};

const buildDerivedItems = (
  codebook: CodebookTree,
  spanGroups: SpanGroup[],
  segmentGroups: SegmentGroup[],
  speakerGroups: SpeakerGroup[],
  people: Person[],
) => {
  const tagMetaById = buildTagMetaMap(codebook);
  const evidenceItems: AnalysisItem[] = [];
  const memoItems: MemoItem[] = [];
  const segmentsByInterview = buildSegmentLookup(segmentGroups);
  const speakersByInterview = buildSpeakerLookup(speakerGroups);
  const peopleById = new Map(people.map((person) => [person.id, person]));

  for (const { interview, spans } of spanGroups) {
    for (const span of spans) {
      const tagMetas = span.tags
        .map((tagRef) => tagMetaById.get(tagRef.tagId))
        .filter((meta): meta is TagMeta => meta !== undefined);
      if (tagMetas.length === 0) continue;
      const memo = span.memo?.trim() || null;
      const participant = buildParticipantRef({
        interview,
        span,
        segmentsByInterview,
        speakersByInterview,
        peopleById,
      });
      const item = { span, interview, tagMetas, memo, participant } satisfies AnalysisItem;
      evidenceItems.push(item);
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
  people: Person[],
  spanGroups: SpanGroup[],
  segmentGroups: SegmentGroup[],
  speakerGroups: SpeakerGroup[],
): CacheEntry => {
  const derived = buildDerivedItems(codebook, spanGroups, segmentGroups, speakerGroups, people);
  return {
    codebook,
    interviews,
    people,
    spanGroups,
    segmentGroups,
    speakerGroups,
    evidenceItems: derived.evidenceItems,
    memoItems: derived.memoItems,
  };
};

const warnOptionalAnalysisLoad = (label: string, err: unknown) => {
  console.warn(`[analysis] optional ${label} load failed`, err);
};

export const AnalysisDataProvider = ({ children }: { children: ReactNode }) => {
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const decodedProjectPath = decodeURIComponent(projectPath);
  const cached = analysisCache.get(decodedProjectPath) ?? null;
  const [project, setProject] = useAtom(currentProjectAtom);
  const setInterviewList = useSetAtom(interviewListAtom);
  const [codebook, setCodebook] = useState<CodebookTree | null>(cached?.codebook ?? null);
  const [interviews, setInterviews] = useState<Interview[]>(cached?.interviews ?? []);
  const [people, setPeople] = useState<Person[]>(cached?.people ?? []);
  const [spanGroups, setSpanGroups] = useState<SpanGroup[]>(cached?.spanGroups ?? []);
  const [segmentGroups, setSegmentGroups] = useState<SegmentGroup[]>(cached?.segmentGroups ?? []);
  const [speakerGroups, setSpeakerGroups] = useState<SpeakerGroup[]>(cached?.speakerGroups ?? []);
  const [evidenceItems, setEvidenceItems] = useState<AnalysisItem[]>(cached?.evidenceItems ?? []);
  const [memoItems, setMemoItems] = useState<MemoItem[]>(cached?.memoItems ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = (snapshot: CacheEntry) => {
    setCodebook(snapshot.codebook);
    setInterviews(snapshot.interviews);
    setPeople(snapshot.people);
    setSpanGroups(snapshot.spanGroups);
    setSegmentGroups(snapshot.segmentGroups);
    setSpeakerGroups(snapshot.speakerGroups);
    setEvidenceItems(snapshot.evidenceItems);
    setMemoItems(snapshot.memoItems);
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
        const rawCodebook = await fetchCodebookTree();
        const nextCodebook = normalizeAnalysisCodebook(rawCodebook);
        const nextInterviews = await fetchInterviews();
        const [nextPeople, nextSpanGroups, nextSegmentGroups, nextSpeakerGroups] = await Promise.all([
          fetchPeople().catch((err: unknown) => {
            warnOptionalAnalysisLoad("people", err);
            return [] as Person[];
          }),
          Promise.all(
            nextInterviews.map(async (interview) => ({
              interview,
              spans: await spanListForInterview(interview.id),
            })),
          ),
          Promise.all(
            nextInterviews.map(async (interview) => ({
              interview,
              segments: await segmentListForInterview(interview.id).catch((err: unknown) => {
                warnOptionalAnalysisLoad(`segments for interview ${interview.id}`, err);
                return [] as SegmentDTO[];
              }),
            })),
          ),
          Promise.all(
            nextInterviews.map(async (interview) => ({
              interview,
              speakers: await speakerListForInterview(interview.id).catch((err: unknown) => {
                warnOptionalAnalysisLoad(`speakers for interview ${interview.id}`, err);
                return [] as Speaker[];
              }),
            })),
          ),
        ]);
        applySnapshot(
          snapshotToCache(
            nextCodebook,
            nextInterviews,
            nextPeople,
            nextSpanGroups,
            nextSegmentGroups,
            nextSpeakerGroups,
          ),
        );
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

  const segmentsByInterview = useMemo(() => buildSegmentLookup(segmentGroups), [segmentGroups]);
  const speakersByInterview = useMemo(() => buildSpeakerLookup(speakerGroups), [speakerGroups]);

  const value = useMemo<AnalysisDataValue>(
    () => ({
      codebook,
      interviews,
      people,
      spanGroups,
      segmentGroups,
      speakerGroups,
      segmentsByInterview,
      speakersByInterview,
      evidenceItems,
      memoItems,
      loading,
      error,
      refresh: () => refresh(false),
    }),
    [
      codebook,
      interviews,
      people,
      spanGroups,
      segmentGroups,
      speakerGroups,
      segmentsByInterview,
      speakersByInterview,
      evidenceItems,
      memoItems,
      loading,
      error,
    ],
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
