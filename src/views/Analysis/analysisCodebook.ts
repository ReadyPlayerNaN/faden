import type { CategoryNode, ClusterNode, CodebookTree, TagNode } from "../../ipc/codebook";

const SYNTHETIC_CLUSTER_ID = 9_000_000_000_001;
const SYNTHETIC_CATEGORY_ID = 9_000_000_000_002;

const SYNTHETIC_CLUSTER_NAME = "Unclustered";
const SYNTHETIC_CATEGORY_NAME = "Uncategorized";

const cloneTag = (tag: TagNode, categoryId: number | null): TagNode => ({
  ...tag,
  categoryId,
});

const cloneCategory = (category: CategoryNode, clusterId: number | null): CategoryNode => ({
  ...category,
  clusterId,
  tags: category.tags.map((tag) => cloneTag(tag, category.id)),
});

const buildSyntheticUncategorizedCategory = (tags: TagNode[]): CategoryNode => ({
  id: SYNTHETIC_CATEGORY_ID,
  clusterId: SYNTHETIC_CLUSTER_ID,
  name: SYNTHETIC_CATEGORY_NAME,
  description: null,
  color: null,
  orderIndex: Number.MAX_SAFE_INTEGER,
  count: tags.reduce((sum, tag) => sum + tag.count, 0),
  tags: tags.map((tag) => cloneTag(tag, SYNTHETIC_CATEGORY_ID)),
});

const buildSyntheticCluster = (categories: CategoryNode[]): ClusterNode => ({
  id: SYNTHETIC_CLUSTER_ID,
  name: SYNTHETIC_CLUSTER_NAME,
  description: null,
  color: null,
  orderIndex: Number.MAX_SAFE_INTEGER,
  count: categories.reduce((sum, category) => sum + category.count, 0),
  categories,
});

export const normalizeAnalysisCodebook = (tree: CodebookTree): CodebookTree => {
  const normalizedClusters = tree.clusters.map((cluster) => ({
    ...cluster,
    categories: cluster.categories.map((category) => cloneCategory(category, cluster.id)),
  }));

  const syntheticCategories = tree.standaloneCategories.map((category) =>
    cloneCategory(category, SYNTHETIC_CLUSTER_ID),
  );

  if (tree.standaloneTags.length > 0) {
    syntheticCategories.push(buildSyntheticUncategorizedCategory(tree.standaloneTags));
  }

  if (syntheticCategories.length > 0) {
    normalizedClusters.push(buildSyntheticCluster(syntheticCategories));
  }

  return {
    clusters: normalizedClusters,
    standaloneCategories: [],
    standaloneTags: [],
  };
};
