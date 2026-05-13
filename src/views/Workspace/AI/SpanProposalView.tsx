import { useState } from "react";
import { useTranslation } from "react-i18next";
import { aiProposalAccept, type ProposalDTO } from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import styles from "./SpanProposalView.module.css";

type Props = { proposal: ProposalDTO; onDone: () => void };

type Suggestion = {
  segment_id: number;
  start_offset: number;
  end_offset: number;
  tag_names: string[];
  rationale?: string | null;
};

type SpanPayload = { suggestions?: Suggestion[] };

const errorMessage = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
};

export const SpanProposalView = ({ proposal, onDone }: Props) => {
  const { t } = useTranslation();
  const payload = (proposal.payload ?? {}) as SpanPayload;
  const suggestions: Suggestion[] = payload.suggestions ?? [];
  const [selected, setSelected] = useState<boolean[]>(
    suggestions.map(() => true),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };
  const setAll = (v: boolean) => setSelected(suggestions.map(() => v));

  const onAccept = async () => {
    setBusy(true);
    const indices = selected
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    try {
      const r = await aiProposalAccept(proposal.id, { span_indices: indices });
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

  return (
    <div className={styles.wrap}>
      <h2>
        {proposal.kind === "pretag" ? t("ai.preTag") : t("ai.findMore")}
      </h2>
      <div className={styles.bulk}>
        <Button onClick={() => setAll(true)}>{t("ai.acceptAll")}</Button>
        <Button onClick={() => setAll(false)}>{t("ai.rejectAll")}</Button>
      </div>
      <ul className={styles.list}>
        {suggestions.map((s, i) => (
          <li key={i} className={styles.item}>
            <label className={styles.row}>
              <input
                type="checkbox"
                checked={selected[i] ?? false}
                onChange={() => toggle(i)}
              />
              <span className={styles.tags}>
                {s.tag_names.map((n) => (
                  <span key={n} className={styles.tag}>
                    {n}
                  </span>
                ))}
              </span>
              <span className={styles.location}>
                seg {s.segment_id} [{s.start_offset}–{s.end_offset}]
              </span>
            </label>
            {s.rationale && <p className={styles.rationale}>{s.rationale}</p>}
          </li>
        ))}
      </ul>
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
