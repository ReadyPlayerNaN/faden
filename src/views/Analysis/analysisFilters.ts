import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type CategoryNode, type ClusterNode, type TagMeta } from "../../ipc/codebook";
import type { Interview } from "../../ipc/interview";
import type { AnalysisItem } from "./AnalysisData";
import type { AnalysisSearch } from "./analysisSearch";

type CategoryOption = {
  category: CategoryNode;
  cluster: ClusterNode | null;
};

type ScopeChip = {
  key: string;
  label: string;
  clearPatch: Partial<Record<keyof AnalysisSearch, number | string | boolean | null | undefined>>;
};

type FiltersArgs<T extends AnalysisItem> = {
  codebookClusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
  interviews: Interview[];
  items: T[];
  search: AnalysisSearch;
};

const compareByName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const hasCluster = (meta: TagMeta, clusterId: number | undefined) =>
  clusterId === undefined || meta.cluster?.id === clusterId;

const hasCategory = (meta: TagMeta, categoryId: number | undefined) =>
  categoryId === undefined || meta.category?.id === categoryId;

const tagDisplayLabel = (meta: TagMeta, t: TFunction) => {
  const parts = [
    meta.cluster?.name,
    meta.category?.name,
    meta.tag.name,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" › ");
  return t("analysis.evidence.noCategory", { defaultValue: "No category" });
};

const participantLabelFromKey = (participantKey: string | undefined, items: AnalysisItem[]) => {
  if (!participantKey) return null;
  const match = items.find((item) => item.participant.key === participantKey)?.participant;
  if (match) return match.name;
  const [, , rawLabel] = participantKey.split(":");
  return rawLabel || participantKey;
};

export const matchesAnalysisSearch = (
  item: AnalysisItem,
  search: AnalysisSearch,
  options?: {
    ignoreParticipant?: boolean;
    ignorePair?: boolean;
    ignoreMemoOnly?: boolean;
  },
) => {
  if (search.interviewId !== undefined && item.interview.id !== search.interviewId) return false;
  if (!options?.ignoreParticipant && search.participantKey && item.participant.key !== search.participantKey) return false;
  if (!options?.ignoreMemoOnly && search.memoOnly && !item.memo) return false;
  if (search.clusterId !== undefined && !item.tagMetas.some((meta) => meta.cluster?.id === search.clusterId)) return false;
  if (search.categoryId !== undefined && !item.tagMetas.some((meta) => meta.category?.id === search.categoryId)) return false;
  if (search.tagId !== undefined && !item.tagMetas.some((meta) => meta.tag.id === search.tagId)) return false;
  if (!options?.ignorePair && search.pairTagAId !== undefined && search.pairTagBId !== undefined) {
    const tagIds = new Set(item.tagMetas.map((meta) => meta.tag.id));
    if (!tagIds.has(search.pairTagAId) || !tagIds.has(search.pairTagBId)) return false;
  }
  return true;
};

export const filterAnalysisItems = <T extends AnalysisItem>(
  items: T[],
  search: AnalysisSearch,
  options?: {
    ignoreParticipant?: boolean;
    ignorePair?: boolean;
    ignoreMemoOnly?: boolean;
  },
) => items.filter((item) => matchesAnalysisSearch(item, search, options));

export const buildAnalysisScopeChips = (args: {
  search: AnalysisSearch;
  codebookClusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
  interviews: Interview[];
  items: AnalysisItem[];
  t: TFunction;
}) => {
  const { search, codebookClusters, standaloneCategories, interviews, items, t } = args;
  const chips: ScopeChip[] = [];
  const allCategories = [
    ...standaloneCategories,
    ...codebookClusters.flatMap((cluster) => cluster.categories),
  ];
  const tagMetaById = new Map<number, TagMeta>();
  for (const item of items) {
    for (const meta of item.tagMetas) {
      if (!tagMetaById.has(meta.tag.id)) tagMetaById.set(meta.tag.id, meta);
    }
  }
  for (const category of standaloneCategories) {
    for (const tag of category.tags) {
      if (!tagMetaById.has(tag.id)) {
        tagMetaById.set(tag.id, { tag, category, cluster: null, effectiveColor: tag.color ?? category.color });
      }
    }
  }
  for (const cluster of codebookClusters) {
    for (const category of cluster.categories) {
      for (const tag of category.tags) {
        if (!tagMetaById.has(tag.id)) {
          tagMetaById.set(tag.id, { tag, category, cluster, effectiveColor: tag.color ?? category.color ?? cluster.color });
        }
      }
    }
  }

  const cluster = codebookClusters.find((item) => item.id === search.clusterId);
  if (cluster) {
    chips.push({
      key: `cluster-${cluster.id}`,
      label: `${t("analysis.evidence.cluster", { defaultValue: "Cluster" })}: ${cluster.name}`,
      clearPatch: { clusterId: undefined, categoryId: undefined, tagId: undefined },
    });
  }

  const category = allCategories.find((item) => item.id === search.categoryId);
  if (category) {
    chips.push({
      key: `category-${category.id}`,
      label: `${t("analysis.evidence.category", { defaultValue: "Category" })}: ${category.name}`,
      clearPatch: { categoryId: undefined, tagId: undefined },
    });
  }

  const tagMeta = search.tagId !== undefined ? tagMetaById.get(search.tagId) : undefined;
  if (tagMeta) {
    chips.push({
      key: `tag-${tagMeta.tag.id}`,
      label: `${t("analysis.evidence.tag", { defaultValue: "Tag" })}: ${tagMeta.tag.name}`,
      clearPatch: { tagId: undefined },
    });
  }

  const interview = interviews.find((item) => item.id === search.interviewId);
  if (interview) {
    chips.push({
      key: `interview-${interview.id}`,
      label: `${t("analysis.evidence.interview", { defaultValue: "Interview" })}: ${interview.name}`,
      clearPatch: { interviewId: undefined },
    });
  }

  const participantLabel = participantLabelFromKey(search.participantKey, items);
  if (search.participantKey && participantLabel) {
    chips.push({
      key: `participant-${search.participantKey}`,
      label: `${t("analysis.filters.participant", { defaultValue: "Participant" })}: ${participantLabel}`,
      clearPatch: { participantKey: undefined },
    });
  }

  if (search.memoOnly) {
    chips.push({
      key: "memo-only",
      label: t("analysis.filters.memoOnly", { defaultValue: "Only memo-backed evidence" }),
      clearPatch: { memoOnly: undefined },
    });
  }

  if (search.pairTagAId !== undefined && search.pairTagBId !== undefined) {
    const left = tagMetaById.get(search.pairTagAId);
    const right = tagMetaById.get(search.pairTagBId);
    const label = left && right
      ? `${tagDisplayLabel(left, t)} + ${tagDisplayLabel(right, t)}`
      : `${search.pairTagAId} + ${search.pairTagBId}`;
    chips.push({
      key: `pair-${search.pairTagAId}-${search.pairTagBId}`,
      label: `${t("analysis.filters.pair", { defaultValue: "Tag pair" })}: ${label}`,
      clearPatch: { pairTagAId: undefined, pairTagBId: undefined },
    });
  }

  return chips;
};

export const useAnalysisScopeChips = (args: {
  search: AnalysisSearch;
  codebookClusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
  interviews: Interview[];
  items: AnalysisItem[];
  onClearPatch: (patch: Partial<Record<keyof AnalysisSearch, number | string | boolean | null | undefined>>) => void;
}) => {
  const { t } = useTranslation();
  const chips = useMemo(
    () => buildAnalysisScopeChips({ ...args, t }),
    [args, t],
  );

  return useMemo(
    () => chips.map((chip) => ({ ...chip, onClear: () => args.onClearPatch(chip.clearPatch) })),
    [args, chips],
  );
};

export const useAnalysisHierarchyFilters = <T extends AnalysisItem>({
  codebookClusters,
  standaloneCategories,
  interviews,
  items,
  search,
}: FiltersArgs<T>) => {
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    return [
      ...standaloneCategories.map((category) => ({ category, cluster: null })),
      ...codebookClusters.flatMap((cluster) =>
        cluster.categories.map((category) => ({ category, cluster })),
      ),
    ].sort((a, b) => compareByName(a.category, b.category));
  }, [codebookClusters, standaloneCategories]);

  const categoryScopeItems = useMemo(
    () => filterAnalysisItems(items, search, { ignorePair: false }),
    [items, search],
  );

  const filteredCategoryOptions = useMemo(() => {
    const availableCategoryIds = new Set<number>();
    for (const item of categoryScopeItems) {
      for (const meta of item.tagMetas) {
        if (!hasCluster(meta, search.clusterId)) continue;
        if (meta.category) availableCategoryIds.add(meta.category.id);
      }
    }
    return categoryOptions.filter(({ category, cluster }) => {
      if (search.clusterId !== undefined && cluster?.id !== search.clusterId) return false;
      return availableCategoryIds.has(category.id);
    });
  }, [categoryOptions, categoryScopeItems, search.clusterId]);

  const filteredTagOptions = useMemo(() => {
    const unique = new Map<number, TagMeta>();
    for (const item of filterAnalysisItems(items, search, { ignorePair: false })) {
      for (const meta of item.tagMetas) {
        if (!hasCluster(meta, search.clusterId)) continue;
        if (!hasCategory(meta, search.categoryId)) continue;
        if (!unique.has(meta.tag.id)) unique.set(meta.tag.id, meta);
      }
    }
    return Array.from(unique.values()).sort((a, b) => compareByName(a.tag, b.tag));
  }, [items, search]);

  const interviewOptions = useMemo(
    () => [...interviews].sort(compareByName),
    [interviews],
  );

  const visibleItems = useMemo(
    () => filterAnalysisItems(items, search),
    [items, search],
  );

  return {
    filteredCategoryOptions,
    filteredTagOptions,
    interviewOptions,
    visibleItems,
  };
};
