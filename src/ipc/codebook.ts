import { invoke } from "@tauri-apps/api/core";

export type Cluster = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
};

export type Category = {
  id: number;
  clusterId: number | null;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
};

export type Tag = {
  id: number;
  categoryId: number | null;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
};

export type TagNode = {
  id: number;
  categoryId: number | null;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
  count: number;
};

export type CategoryNode = {
  id: number;
  clusterId: number | null;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
  count: number;
  tags: TagNode[];
};

export type ClusterNode = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
  count: number;
  categories: CategoryNode[];
};

export type CodebookTree = {
  clusters: ClusterNode[];
  standaloneCategories: CategoryNode[];
  standaloneTags: TagNode[];
};

type RawCluster = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  order_index: number;
};
type RawCategory = RawCluster & { cluster_id: number | null };
type RawTag = RawCluster & { category_id: number | null };
type RawTagNode = RawTag & { count: number };
type RawCategoryNode = RawCategory & { count: number; tags: RawTagNode[] };
type RawClusterNode = RawCluster & {
  count: number;
  categories: RawCategoryNode[];
};
type RawCodebookTree = {
  clusters: RawClusterNode[];
  standalone_categories: RawCategoryNode[];
  standalone_tags: RawTagNode[];
};

const tagFromRaw = (r: RawTag): Tag => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  description: r.description,
  color: r.color,
  orderIndex: r.order_index,
});

const tagNodeFromRaw = (r: RawTagNode): TagNode => ({
  ...tagFromRaw(r),
  count: r.count,
});

const categoryFromRaw = (r: RawCategory): Category => ({
  id: r.id,
  clusterId: r.cluster_id,
  name: r.name,
  description: r.description,
  color: r.color,
  orderIndex: r.order_index,
});

const categoryNodeFromRaw = (r: RawCategoryNode): CategoryNode => ({
  ...categoryFromRaw(r),
  count: r.count,
  tags: r.tags.map(tagNodeFromRaw),
});

const clusterFromRaw = (r: RawCluster): Cluster => ({
  id: r.id,
  name: r.name,
  description: r.description,
  color: r.color,
  orderIndex: r.order_index,
});

const clusterNodeFromRaw = (r: RawClusterNode): ClusterNode => ({
  ...clusterFromRaw(r),
  count: r.count,
  categories: r.categories.map(categoryNodeFromRaw),
});

const treeFromRaw = (r: RawCodebookTree): CodebookTree => ({
  clusters: r.clusters.map(clusterNodeFromRaw),
  standaloneCategories: r.standalone_categories.map(categoryNodeFromRaw),
  standaloneTags: r.standalone_tags.map(tagNodeFromRaw),
});

export const codebookTree = async (): Promise<CodebookTree> =>
  treeFromRaw(await invoke<RawCodebookTree>("codebook_tree"));

export const clusterCreate = async (
  name: string,
  description?: string | null,
  color?: string | null,
): Promise<Cluster> =>
  clusterFromRaw(
    await invoke<RawCluster>("cluster_create", {
      name,
      description: description ?? null,
      color: color ?? null,
    }),
  );
export const clusterRename = (id: number, name: string): Promise<void> =>
  invoke("cluster_rename", { id, name });
export const clusterSetDescription = (
  id: number,
  description: string | null,
): Promise<void> => invoke("cluster_set_description", { id, description });
export const clusterSetColor = (
  id: number,
  color: string | null,
): Promise<void> => invoke("cluster_set_color", { id, color });
export const clusterDelete = (id: number): Promise<void> =>
  invoke("cluster_delete", { id });
export const clusterReorder = (ids: number[]): Promise<void> =>
  invoke("cluster_reorder", { ids });

export const categoryCreate = async (
  clusterId: number | null,
  name: string,
  description?: string | null,
  color?: string | null,
): Promise<Category> =>
  categoryFromRaw(
    await invoke<RawCategory>("category_create", {
      clusterId,
      name,
      description: description ?? null,
      color: color ?? null,
    }),
  );
export const categoryRename = (id: number, name: string): Promise<void> =>
  invoke("category_rename", { id, name });
export const categorySetDescription = (
  id: number,
  description: string | null,
): Promise<void> => invoke("category_set_description", { id, description });
export const categorySetColor = (
  id: number,
  color: string | null,
): Promise<void> => invoke("category_set_color", { id, color });
export const categoryDelete = (id: number): Promise<void> =>
  invoke("category_delete", { id });
export const categoryReorder = (
  clusterId: number | null,
  ids: number[],
): Promise<void> => invoke("category_reorder", { clusterId, ids });
export const categoryMoveToCluster = (
  id: number,
  newClusterId: number | null,
): Promise<void> => invoke("category_move_to_cluster", { id, newClusterId });

export const tagCreate = async (
  categoryId: number | null,
  name: string,
  description?: string | null,
  color?: string | null,
): Promise<Tag> =>
  tagFromRaw(
    await invoke<RawTag>("tag_create", {
      categoryId,
      name,
      description: description ?? null,
      color: color ?? null,
    }),
  );
export const tagRename = (id: number, name: string): Promise<void> =>
  invoke("tag_rename", { id, name });
export const tagSetDescription = (
  id: number,
  description: string | null,
): Promise<void> => invoke("tag_set_description", { id, description });
export const tagSetColor = (id: number, color: string | null): Promise<void> =>
  invoke("tag_set_color", { id, color });
export const tagDelete = (id: number): Promise<void> =>
  invoke("tag_delete", { id });
export const tagReorder = (
  categoryId: number,
  ids: number[],
): Promise<void> => invoke("tag_reorder", { categoryId, ids });
export const tagMoveToCategory = (
  id: number,
  newCategoryId: number | null,
): Promise<void> => invoke("tag_move_to_category", { id, newCategoryId });
