import { useEffect, useMemo } from "react";
import type { CategoryNode, ClusterNode, TagMeta } from "../../ipc/codebook";
import type { Interview } from "../../ipc/interview";
import type { AnalysisItem } from "./AnalysisData";

type CategoryOption = {
  category: CategoryNode;
  cluster: ClusterNode | null;
};

type FiltersArgs<T extends AnalysisItem> = {
  codebookClusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
  interviews: Interview[];
  items: T[];
  clusterFilter: number | null;
  setClusterFilter: (value: number | null) => void;
  categoryFilter: number | null;
  setCategoryFilter: (value: number | null) => void;
  tagFilter: number | null;
  setTagFilter: (value: number | null) => void;
  interviewFilter: number | null;
  setInterviewFilter: (value: number | null) => void;
};

const compareByName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const hasCluster = (meta: TagMeta, clusterId: number | null) =>
  clusterId === null || meta.cluster?.id === clusterId;

const hasCategory = (meta: TagMeta, categoryId: number | null) =>
  categoryId === null || meta.category?.id === categoryId;

export const useAnalysisHierarchyFilters = <T extends AnalysisItem>({
  codebookClusters,
  standaloneCategories,
  interviews,
  items,
  clusterFilter,
  setClusterFilter,
  categoryFilter,
  setCategoryFilter,
  tagFilter,
  setTagFilter,
  interviewFilter,
  setInterviewFilter,
}: FiltersArgs<T>) => {

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    return [
      ...standaloneCategories.map((category) => ({ category, cluster: null })),
      ...codebookClusters.flatMap((cluster) =>
        cluster.categories.map((category) => ({ category, cluster })),
      ),
    ].sort((a, b) => compareByName(a.category, b.category));
  }, [codebookClusters, standaloneCategories]);

  const filteredCategoryOptions = useMemo(
    () => categoryOptions.filter(({ cluster }) => clusterFilter === null || cluster?.id === clusterFilter),
    [categoryOptions, clusterFilter],
  );

  const filteredTagOptions = useMemo(() => {
    const unique = new Map<number, TagMeta>();
    for (const item of items) {
      for (const meta of item.tagMetas) {
        if (!hasCluster(meta, clusterFilter)) continue;
        if (!hasCategory(meta, categoryFilter)) continue;
        if (!unique.has(meta.tag.id)) unique.set(meta.tag.id, meta);
      }
    }
    return Array.from(unique.values()).sort((a, b) => compareByName(a.tag, b.tag));
  }, [items, clusterFilter, categoryFilter]);

  const interviewOptions = useMemo(
    () => [...interviews].sort(compareByName),
    [interviews],
  );

  useEffect(() => {
    if (categoryFilter !== null && !filteredCategoryOptions.some(({ category }) => category.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  }, [categoryFilter, filteredCategoryOptions]);

  useEffect(() => {
    if (tagFilter !== null && !filteredTagOptions.some((meta) => meta.tag.id === tagFilter)) {
      setTagFilter(null);
    }
  }, [tagFilter, filteredTagOptions]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (interviewFilter !== null && item.interview.id !== interviewFilter) return false;
      if (tagFilter !== null) return item.tagMetas.some((meta) => meta.tag.id === tagFilter);
      if (categoryFilter !== null) return item.tagMetas.some((meta) => meta.category?.id === categoryFilter);
      if (clusterFilter !== null) return item.tagMetas.some((meta) => meta.cluster?.id === clusterFilter);
      return true;
    });
  }, [items, interviewFilter, tagFilter, categoryFilter, clusterFilter]);

  const clearFilters = () => {
    setClusterFilter(null);
    setCategoryFilter(null);
    setTagFilter(null);
    setInterviewFilter(null);
  };

  return {
    clusterFilter,
    setClusterFilter,
    categoryFilter,
    setCategoryFilter,
    tagFilter,
    setTagFilter,
    interviewFilter,
    setInterviewFilter,
    filteredCategoryOptions,
    filteredTagOptions,
    interviewOptions,
    visibleItems,
    clearFilters,
  };
};
