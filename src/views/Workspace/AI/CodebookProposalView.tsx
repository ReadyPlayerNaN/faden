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
type CodebookPayload = { proposals?: RawProposalEntry[] };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

const initialSelection = (payload: unknown): SelClusterNode[] => {
  const p = (payload ?? {}) as CodebookPayload;
  const proposals = p.proposals ?? [];
  return proposals.map((entry) => ({
    name: entry.cluster?.name ?? "",
    description: entry.cluster?.description,
    accept: true,
    categories: (entry.categories ?? []).map((c) => ({
      name: c.name,
      description: c.description,
      accept: true,
      tags: (c.tags ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        accept: true,
      })),
    })),
  }));
};

export const CodebookProposalView = ({ proposal, onDone }: Props) => {
  const { t } = useTranslation();
  const [sel, setSel] = useState<SelClusterNode[]>(
    initialSelection(proposal.payload),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onAccept = async () => {
    setBusy(true);
    try {
      const r = await aiProposalAccept(proposal.id, { clusters: sel });
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

  const toggleCluster = (i: number) => {
    setSel((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, accept: !c.accept } : c)),
    );
  };
  const toggleCategory = (i: number, j: number) => {
    setSel((prev) =>
      prev.map((c, idx) =>
        idx === i
          ? {
              ...c,
              categories: c.categories.map((cat, jdx) =>
                jdx === j ? { ...cat, accept: !cat.accept } : cat,
              ),
            }
          : c,
      ),
    );
  };
  const toggleTag = (i: number, j: number, k: number) => {
    setSel((prev) =>
      prev.map((c, idx) =>
        idx === i
          ? {
              ...c,
              categories: c.categories.map((cat, jdx) =>
                jdx === j
                  ? {
                      ...cat,
                      tags: cat.tags.map((tg, kdx) =>
                        kdx === k ? { ...tg, accept: !tg.accept } : tg,
                      ),
                    }
                  : cat,
              ),
            }
          : c,
      ),
    );
  };

  return (
    <div className={styles.wrap}>
      <h2>{t("ai.generateCodebook")}</h2>
      {sel.map((c, i) => (
        <div key={i} className={styles.cluster}>
          <label>
            <input
              type="checkbox"
              checked={c.accept}
              onChange={() => toggleCluster(i)}
            />
            <strong>{c.name}</strong>
            {c.description && (
              <span className={styles.desc}> — {c.description}</span>
            )}
          </label>
          <div className={styles.indent}>
            {c.categories.map((cat, j) => (
              <div key={j} className={styles.category}>
                <label>
                  <input
                    type="checkbox"
                    checked={cat.accept}
                    onChange={() => toggleCategory(i, j)}
                  />
                  {cat.name}
                  {cat.description && (
                    <span className={styles.desc}> — {cat.description}</span>
                  )}
                </label>
                <div className={styles.indent}>
                  {cat.tags.map((tg, k) => (
                    <div key={k} className={styles.tag}>
                      <label>
                        <input
                          type="checkbox"
                          checked={tg.accept}
                          onChange={() => toggleTag(i, j, k)}
                        />
                        {tg.name}
                        {tg.description && (
                          <span className={styles.desc}>
                            {" "}
                            — {tg.description}
                          </span>
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
        <Button
          variant="primary"
          onClick={() => void onAccept()}
          disabled={busy}
        >
          {t("ai.accept")}
        </Button>
      </div>
    </div>
  );
};
