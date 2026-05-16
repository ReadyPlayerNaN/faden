import { useState } from "react";
import { useTranslation } from "react-i18next";
import { aiProposalAccept, type ProposalDTO } from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import styles from "./CodebookProposalView.module.css";

type Props = { proposal: ProposalDTO; onDone: () => void };

type SelTagNode = {
  name: string;
  description?: string;
  accept: boolean;
};
type SelCategoryNode = {
  name: string;
  description?: string;
  accept: boolean;
  tags: SelTagNode[];
};
type SelClusterNode = {
  name: string;
  description?: string;
  accept: boolean;
  categories: SelCategoryNode[];
};

type RawTag = { name: string; description?: string };
type RawCategory = { name: string; description?: string; tags?: RawTag[] };
type RawCluster = { name: string; description?: string };
type RawProposalEntry = { cluster?: RawCluster; categories?: RawCategory[] };
type LegacyCodebookPayload = { proposals?: RawProposalEntry[] };
type FlatCodebookPayload = { proposals?: RawTag[] };

type SelectionState =
  | { mode: "flat"; tags: SelTagNode[] }
  | { mode: "legacy"; clusters: SelClusterNode[] };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const initialSelection = (payload: unknown): SelectionState => {
  const flat = (payload ?? {}) as FlatCodebookPayload;
  const flatProposals = flat.proposals ?? [];
  if (flatProposals.every((entry) => entry && typeof entry.name === "string")) {
    return {
      mode: "flat",
      tags: flatProposals.map((tag) => ({
        name: tag.name,
        description: tag.description,
        accept: true,
      })),
    };
  }

  const legacy = (payload ?? {}) as LegacyCodebookPayload;
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

export const CodebookProposalView = ({ proposal, onDone }: Props) => {
  const { t } = useTranslation();
  const [sel, setSel] = useState<SelectionState>(initialSelection(proposal.payload));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onAccept = async () => {
    setBusy(true);
    try {
      const payload = sel.mode === "flat" ? { tags: sel.tags } : { clusters: sel.clusters };
      const r = await aiProposalAccept(proposal.id, payload);
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
    setSel((prev) =>
      prev.mode !== "legacy"
        ? prev
        : {
            ...prev,
            clusters: prev.clusters.map((cluster, idx) =>
              idx === i ? { ...cluster, accept: !cluster.accept } : cluster,
            ),
          },
    );
  };

  const toggleCategory = (i: number, j: number) => {
    setSel((prev) =>
      prev.mode !== "legacy"
        ? prev
        : {
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
          },
    );
  };

  const toggleLegacyTag = (i: number, j: number, k: number) => {
    setSel((prev) =>
      prev.mode !== "legacy"
        ? prev
        : {
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
          },
    );
  };

  return (
    <div className={styles.wrap}>
      <h2>{t("ai.generateCodebook")}</h2>
      {sel.mode === "flat"
        ? sel.tags.map((tag, i) => (
            <div key={`${tag.name}-${i}`} className={styles.tag}>
              <label>
                <input
                  type="checkbox"
                  checked={tag.accept}
                  onChange={() => toggleFlatTag(i)}
                />
                {tag.name}
                {tag.description && <span className={styles.desc}> — {tag.description}</span>}
              </label>
            </div>
          ))
        : sel.clusters.map((cluster, i) => (
            <div key={i} className={styles.cluster}>
              <label>
                <input
                  type="checkbox"
                  checked={cluster.accept}
                  onChange={() => toggleCluster(i)}
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
          ))}
      <div className={styles.actions}>
        {result && <span className={styles.result}>{result}</span>}
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void onAccept()} disabled={busy}>
          {t("ai.accept")}
        </Button>
      </div>
    </div>
  );
};
