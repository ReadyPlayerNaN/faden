export type AnalysisSearch = {
  clusterId?: number;
  categoryId?: number;
  tagId?: number;
  interviewId?: number;
  participantKey?: string;
  memoOnly?: boolean;
  pairTagAId?: number;
  pairTagBId?: number;
};

const parsePositiveInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0) return parsed;
  }
  return undefined;
};

const parseParticipantKey = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseBooleanFlag = (value: unknown): boolean | undefined => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return undefined;
};

const normalizePair = (a: number | undefined, b: number | undefined) => {
  if (a === undefined || b === undefined || a === b) {
    return { pairTagAId: undefined, pairTagBId: undefined };
  }
  return a < b
    ? { pairTagAId: a, pairTagBId: b }
    : { pairTagAId: b, pairTagBId: a };
};

export const normalizeAnalysisSearch = (search: Record<string, unknown> | undefined | null): AnalysisSearch => {
  const pair = normalizePair(parsePositiveInt(search?.pairTagAId), parsePositiveInt(search?.pairTagBId));
  return {
    clusterId: parsePositiveInt(search?.clusterId),
    categoryId: parsePositiveInt(search?.categoryId),
    tagId: parsePositiveInt(search?.tagId),
    interviewId: parsePositiveInt(search?.interviewId),
    participantKey: parseParticipantKey(search?.participantKey),
    memoOnly: parseBooleanFlag(search?.memoOnly) ? true : undefined,
    ...pair,
  };
};

export const mergeAnalysisSearch = (
  current: AnalysisSearch,
  patch: Partial<Record<keyof AnalysisSearch, number | string | boolean | null | undefined>>,
): AnalysisSearch => {
  const next: AnalysisSearch = { ...current };

  for (const key of Object.keys(patch) as Array<keyof AnalysisSearch>) {
    const value = patch[key];
    if (key === "memoOnly") {
      if (value === true) next.memoOnly = true;
      else delete next.memoOnly;
      continue;
    }
    if (key === "participantKey") {
      if (typeof value === "string" && value.trim()) next.participantKey = value.trim();
      else delete next.participantKey;
      continue;
    }
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      next[key] = value as never;
    } else {
      delete next[key];
    }
  }

  const pair = normalizePair(next.pairTagAId, next.pairTagBId);
  next.pairTagAId = pair.pairTagAId;
  next.pairTagBId = pair.pairTagBId;
  if (pair.pairTagAId === undefined || pair.pairTagBId === undefined) {
    delete next.pairTagAId;
    delete next.pairTagBId;
  }

  return next;
};
