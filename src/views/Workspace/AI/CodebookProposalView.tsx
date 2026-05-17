import { useState } from "react";
import { useTranslation } from "react-i18next";
import { aiProposalAccept, type ProposalDTO } from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import styles from "./CodebookProposalView.module.css";

type Props = {
  proposal: ProposalDTO;
  onAccepted?: () => Promise<void> | void;
  onReject?: () => Promise<void> | void;
  onDone: () => void;
};

type SelTagNode = {
  id?: number;
  name: string;
  description?: string;
  accept: boolean;
};

type SelCategoryNode = {
  id?: number;
  existingCategoryId?: number | null;
  name: string;
  description?: string;
  accept: boolean;
  tags: SelTagNode[];
  rationale?: string | null;
};

type SelClusterNode = {
  existingClusterId?: number | null;
  name: string;
  description?: string;
  accept: boolean;
  categories: SelCategoryNode[];
  rationale?: string | null;
};

type RawTag = { id?: number; name: string; description?: string };
type RawCategory = {
  id?: number;
  existing_category_id?: number | null;
  name: string;
  description?: string;
  tags?: RawTag[];
  rationale?: string | null;
};
type RawCluster = {
  existing_cluster_id?: number | null;
  name: string;
  description?: string;
};
type RawProposalEntry = { cluster?: RawCluster; categories?: RawCategory[] };
type LegacyCodebookPayload = { proposals?: RawProposalEntry[] };
type FlatCodebookPayload = { proposals?: RawTag[] };
type CategorizePayload = {
  proposals?: Array<{
    category: RawCategory;
    tags?: RawTag[];
    rationale?: string | null;
  }>;
};
type ClusterPayload = {
  proposals?: Array<{
    cluster: RawCluster;
    categories?: Array<RawCategory>;
    rationale?: string | null;
  }>;
};

type SelectionState =
  | { mode: "flat"; tags: SelTagNode[] }
  | { mode: "legacy"; clusters: SelClusterNode[] }
  | { mode: "categorize"; proposals: SelCategoryNode[] }
  | { mode: "cluster"; proposals: SelClusterNode[] };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const initialSelection = (proposal: ProposalDTO): SelectionState => {
  if (proposal.kind === "categorize") {
    const payload = (proposal.payload ?? {}) as CategorizePayload;
    return {
      mode: "categorize",
      proposals: (payload.proposals ?? []).map((entry) => ({
        id: entry.category.id,
        existingCategoryId: entry.category.existing_category_id,
        name: entry.category.name,
        description: entry.category.description,
        accept: true,
        rationale: entry.rationale,
        tags: (entry.tags ?? []).map((tag) => ({
          id: tag.id,
          name: tag.name,
          description: tag.description,
          accept: true,
        })),
      })),
    };
  }

  if (proposal.kind === "cluster") {
    const payload = (proposal.payload ?? {}) as ClusterPayload;
    return {
      mode: "cluster",
      proposals: (payload.proposals ?? []).map((entry) => ({
        existingClusterId: entry.cluster.existing_cluster_id,
        name: entry.cluster.name,
        description: entry.cluster.description,
        accept: true,
        rationale: entry.rationale,
        categories: (entry.categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          accept: true,
          tags: [],
        })),
      })),
    };
  }

  const flat = (proposal.payload ?? {}) as FlatCodebookPayload;
  const flatProposals = flat.proposals ?? [];
  if (flatProposals.every((entry) => entry && typeof entry.name === "string" && entry.id === undefined)) {
    return {
      mode: "flat",
      tags: flatProposals.map((tag) => ({
        name: tag.name,
        description: tag.description,
        accept: true,
      })),
    };
  }

  const legacy = (proposal.payload ?? {}) as LegacyCodebookPayload;
  return {
    mode: "legacy",
    clusters: (legacy.proposals ?? []).map((entry) => ({
      name: entry.cluster?.name ?? "",
      description: entry.cluster?.description,
      accept: true,
      categories: (entry.categories ?? []).map((category) => ({
        name: category.name,
        description: category.description,
        accept: true,
        tags: (category.tags ?? []).map((tag) => ({
          name: tag.name,
          description: tag.description,
          accept: true,
        })),
      })),
    })),
  };
};

const proposalTitle = (proposal: ProposalDTO, t: ReturnType<typeof useTranslation>["t"]) => {
  switch (proposal.kind) {
    case "categorize":
      return t("ai.categorize", { defaultValue: "Categorize tags" });
    case "cluster":
      return t("ai.cluster", { defaultValue: "Cluster categories" });
    default:
      return t("ai.generateCodebook");
  }
};

export const CodebookProposalView = ({
  proposal,
  onAccepted,
  onReject,
  onDone,
}: Props) => {
  const { t } = useTranslation();
  const [sel, setSel] = useState<SelectionState>(initialSelection(proposal));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const isPending = proposal.status === "pending";

  const onAccept = async () => {
    setBusy(true);
    try {
      const payload =
        sel.mode === "flat"
          ? { tags: sel.tags }
          : sel.mode === "legacy"
            ? { clusters: sel.clusters }
            : sel.mode === "categorize"
              ? {
                  proposals: sel.proposals.map((proposal) => ({
                    category: {
                      existing_category_id: proposal.existingCategoryId ?? null,
                      name: proposal.name,
                      description: proposal.description,
                      accept: proposal.accept,
                    },
                    tags: proposal.tags.map((tag) => ({
                      id: tag.id,
                      name: tag.name,
                      description: tag.description,
                      accept: tag.accept,
                    })),
                  })),
                }
              : {
                  proposals: sel.proposals.map((proposal) => ({
                    cluster: {
                      existing_cluster_id: proposal.existingClusterId ?? null,
                      name: proposal.name,
                      description: proposal.description,
                      accept: proposal.accept,
                    },
                    categories: proposal.categories.map((category) => ({
                      id: category.id,
                      name: category.name,
                      description: category.description,
                      accept: category.accept,
                    })),
                  })),
                };
      const r = await aiProposalAccept(proposal.id, payload);
      await onAccepted?.();
      setResult(
        t("ai.accepted", {
          created: r.created_count,
          skipped: r.skipped.length,
        }),
      );
      setTimeout(onDone, 1500);
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    setBusy(true);
    try {
      await onReject?.();
      setResult(t("ai.rejected"));
      setTimeout(onDone, 1000);
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleFlatTag = (i: number) => {
    setSel((prev) =>
      prev.mode !== "flat"
        ? prev
        : {
            ...prev,
            tags: prev.tags.map((tag, idx) =>
              idx === i ? { ...tag, accept: !tag.accept } : tag,
            ),
          },
    );
  };

  const toggleCluster = (i: number) => {
    setSel((prev) => {
      if (prev.mode === "legacy") {
        return {
          ...prev,
          clusters: prev.clusters.map((cluster, idx) =>
            idx === i ? { ...cluster, accept: !cluster.accept } : cluster,
          ),
        };
      }
      if (prev.mode === "cluster") {
        return {
          ...prev,
          proposals: prev.proposals.map((cluster, idx) =>
            idx === i ? { ...cluster, accept: !cluster.accept } : cluster,
          ),
        };
      }
      return prev;
    });
  };

  const toggleCategory = (i: number, j: number) => {
    setSel((prev) => {
      if (prev.mode === "legacy") {
        return {
          ...prev,
          clusters: prev.clusters.map((cluster, idx) =>
            idx !== i
              ? cluster
              : {
                  ...cluster,
                  categories: cluster.categories.map((category, jdx) =>
                    jdx === j ? { ...category, accept: !category.accept } : category,
                  ),
                },
          ),
        };
      }
      if (prev.mode === "cluster") {
        return {
          ...prev,
          proposals: prev.proposals.map((cluster, idx) =>
            idx !== i
              ? cluster
              : {
                  ...cluster,
                  categories: cluster.categories.map((category, jdx) =>
                    jdx === j ? { ...category, accept: !category.accept } : category,
                  ),
                },
          ),
        };
      }
      if (prev.mode === "categorize") {
        return {
          ...prev,
          proposals: prev.proposals.map((category, idx) =>
            idx === i ? { ...category, accept: !category.accept } : category,
          ),
        };
      }
      return prev;
    });
  };

  const toggleLegacyTag = (i: number, j: number, k: number) => {
    setSel((prev) => {
      if (prev.mode === "legacy") {
        return {
          ...prev,
          clusters: prev.clusters.map((cluster, idx) =>
            idx !== i
              ? cluster
              : {
                  ...cluster,
                  categories: cluster.categories.map((category, jdx) =>
                    jdx !== j
                      ? category
                      : {
                          ...category,
                          tags: category.tags.map((tag, kdx) =>
                            kdx === k ? { ...tag, accept: !tag.accept } : tag,
                          ),
                        },
                  ),
                },
          ),
        };
      }
      if (prev.mode === "categorize") {
        return {
          ...prev,
          proposals: prev.proposals.map((category, idx) =>
            idx !== i
              ? category
              : {
                  ...category,
                  tags: category.tags.map((tag, kdx) =>
                    kdx === j ? { ...tag, accept: !tag.accept } : tag,
                  ),
                },
          ),
        };
      }
      return prev;
    });
  };

  return (
    <div className={styles.wrap}>
      <h2>{proposalTitle(proposal, t)}</h2>
      <p>{t(`ai.proposalStatus.${proposal.status === "pending" ? "new" : proposal.status}`)}</p>
      {sel.mode === "flat"
        ? sel.tags.map((tag, i) => (
            <div key={`${tag.name}-${i}`} className={styles.tag}>
              <label>
                <input
                  type="checkbox"
                  checked={tag.accept}
                  onChange={() => toggleFlatTag(i)}
                  disabled={!isPending}
                />
                {tag.name}
                {tag.description && <span className={styles.desc}> — {tag.description}</span>}
              </label>
            </div>
          ))
        : sel.mode === "legacy"
          ? sel.clusters.map((cluster, i) => (
              <div key={i} className={styles.cluster}>
                <label>
                  <input
                    type="checkbox"
                    checked={cluster.accept}
                    onChange={() => toggleCluster(i)}
                    disabled={!isPending}
                  />
                  <strong>{cluster.name}</strong>
                  {cluster.description && (
                    <span className={styles.desc}> — {cluster.description}</span>
                  )}
                </label>
                <div className={styles.indent}>
                  {cluster.categories.map((category, j) => (
                    <div key={j} className={styles.category}>
                      <label>
                        <input
                          type="checkbox"
                          checked={category.accept}
                          onChange={() => toggleCategory(i, j)}
                          disabled={!isPending}
                        />
                        {category.name}
                        {category.description && (
                          <span className={styles.desc}> — {category.description}</span>
                        )}
                      </label>
                      <div className={styles.indent}>
                        {category.tags.map((tag, k) => (
                          <div key={k} className={styles.tag}>
                            <label>
                              <input
                                type="checkbox"
                                checked={tag.accept}
                                onChange={() => toggleLegacyTag(i, j, k)}
                                disabled={!isPending}
                              />
                              {tag.name}
                              {tag.description && (
                                <span className={styles.desc}> — {tag.description}</span>
                              )}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          : sel.mode === "categorize"
            ? sel.proposals.map((category, i) => (
                <div key={`${category.name}-${i}`} className={styles.category}>
                  <label>
                    <input
                      type="checkbox"
                      checked={category.accept}
                      onChange={() => toggleCategory(i, 0)}
                      disabled={!isPending}
                    />
                    <strong>{category.name}</strong>
                    {category.existingCategoryId ? (
                      <span className={styles.desc}>
                        {t("ai.useExistingCategory", {
                          defaultValue: " — use existing category #{{id}}",
                          id: category.existingCategoryId,
                        })}
                      </span>
                    ) : null}
                    {!category.existingCategoryId && category.description ? (
                      <span className={styles.desc}> — {category.description}</span>
                    ) : null}
                  </label>
                  {category.rationale ? <p className={styles.desc}>{category.rationale}</p> : null}
                  <div className={styles.indent}>
                    {category.tags.map((tag, j) => (
                      <div key={`${tag.id ?? tag.name}-${j}`} className={styles.tag}>
                        <label>
                          <input
                            type="checkbox"
                            checked={tag.accept}
                            onChange={() => toggleLegacyTag(i, j, 0)}
                            disabled={!isPending}
                          />
                          {tag.name}
                          {tag.description && (
                            <span className={styles.desc}> — {tag.description}</span>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : sel.proposals.map((cluster, i) => (
                <div key={`${cluster.name}-${i}`} className={styles.cluster}>
                  <label>
                    <input
                      type="checkbox"
                      checked={cluster.accept}
                      onChange={() => toggleCluster(i)}
                      disabled={!isPending}
                    />
                    <strong>{cluster.name}</strong>
                    {cluster.existingClusterId ? (
                      <span className={styles.desc}>
                        {t("ai.useExistingCluster", {
                          defaultValue: " — use existing cluster #{{id}}",
                          id: cluster.existingClusterId,
                        })}
                      </span>
                    ) : null}
                    {!cluster.existingClusterId && cluster.description ? (
                      <span className={styles.desc}> — {cluster.description}</span>
                    ) : null}
                  </label>
                  {cluster.rationale ? <p className={styles.desc}>{cluster.rationale}</p> : null}
                  <div className={styles.indent}>
                    {cluster.categories.map((category, j) => (
                      <div key={`${category.id ?? category.name}-${j}`} className={styles.category}>
                        <label>
                          <input
                            type="checkbox"
                            checked={category.accept}
                            onChange={() => toggleCategory(i, j)}
                            disabled={!isPending}
                          />
                          {category.name}
                          {category.description && (
                            <span className={styles.desc}> — {category.description}</span>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
      <div className={styles.actions}>
        {result && <span className={styles.result}>{result}</span>}
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        {isPending && (
          <Button variant="danger" onClick={() => void onDecline()} disabled={busy}>
            {t("ai.reject")}
          </Button>
        )}
        {isPending && (
          <Button variant="primary" onClick={() => void onAccept()} disabled={busy}>
            {t("ai.accept")}
          </Button>
        )}
      </div>
    </div>
  );
};
