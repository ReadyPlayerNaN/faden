export type AnalysisSearch = {
  clusterId?: number;
  categoryId?: number;
  tagId?: number;
  interviewId?: number;
};

const parsePositiveInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0) return parsed;
  }
  return undefined;
};

export const normalizeAnalysisSearch = (search: Record<string, unknown> | undefined | null): AnalysisSearch => ({
  clusterId: parsePositiveInt(search?.clusterId),
  categoryId: parsePositiveInt(search?.categoryId),
  tagId: parsePositiveInt(search?.tagId),
  interviewId: parsePositiveInt(search?.interviewId),
});

export const mergeAnalysisSearch = (
  current: AnalysisSearch,
  patch: Partial<Record<keyof AnalysisSearch, number | null | undefined>>,
): AnalysisSearch => {
  const next: AnalysisSearch = { ...current };
  for (const key of Object.keys(patch) as Array<keyof AnalysisSearch>) {
    const value = patch[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      next[key] = value;
    } else {
      delete next[key];
    }
  }
  return next;
};
