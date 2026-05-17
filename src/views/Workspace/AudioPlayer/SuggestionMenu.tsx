import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { aiProposalList, type ProposalDTO } from "../../../ipc/ai";
import { Button } from "../../../components/Button/Button";
import { ErrorBanner } from "../../../components/ErrorBanner";
import {
  StatusMenu,
  StatusMenuEmpty,
  StatusMenuFooter,
  StatusMenuHeader,
} from "../../../components/StatusMenu/StatusMenu";
import { activeProposalIdAtom } from "../../../state/ai";
import { currentProjectAtom } from "../../../state/project";
import styles from "./SuggestionMenu.module.css";

const MAX_OVERVIEW_ITEMS = 5;

export const SuggestionMenu = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const project = useAtomValue(currentProjectAtom);
  const setActiveProposalId = useSetAtom(activeProposalIdAtom);
  const [open, setOpen] = useState(false);
  const [pendingProposals, setPendingProposals] = useState<ProposalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refreshProposals = async () => {
    try {
      setError(null);
      setPendingProposals(await aiProposalList(["pending"]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProposals();
    const interval = window.setInterval(() => {
      void refreshProposals();
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const unresolvedCount = pendingProposals.length;
  const overview = useMemo(
    () => pendingProposals.slice(0, MAX_OVERVIEW_ITEMS),
    [pendingProposals],
  );

  const openSuggestionsCenter = (proposalId?: number) => {
    setOpen(false);
    setActiveProposalId(proposalId ?? null);
    if (!project) return;
    void navigate({
      to: "/workspace/$projectPath/suggestions",
      params: { projectPath: encodeURIComponent(project.path) },
    });
  };

  const triggerTitle = t("ai.suggestionsTriggerTitle", {
    defaultValue: "Suggestions",
  });

  return (
    <div className={styles.root} ref={containerRef}>
      <Button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${triggerTitle} (${unresolvedCount})`}
        title={triggerTitle}
        className={styles.trigger}
      >
        <span className={styles.triggerContent}>
          <span className={styles.triggerIcon} aria-hidden="true">💡</span>
          <span className={styles.triggerCount}>{unresolvedCount}</span>
        </span>
      </Button>
      {open && (
        <StatusMenu role="menu">
          <StatusMenuHeader>
            {t("ai.unresolvedSuggestions", {
              count: unresolvedCount,
              defaultValue: "Unresolved suggestions ({{count}})",
            })}
          </StatusMenuHeader>
          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
          {loading && overview.length === 0 ? (
            <StatusMenuEmpty>
              {t("ai.loadingSuggestions", {
                defaultValue: "Loading suggestions…",
              })}
            </StatusMenuEmpty>
          ) : error && overview.length === 0 ? (
            <StatusMenuEmpty>
              {t("ai.suggestionsLoadFailed", {
                defaultValue: "Couldn’t load suggestions right now.",
              })}
            </StatusMenuEmpty>
          ) : overview.length === 0 ? (
            <StatusMenuEmpty>
              {t("ai.noUnresolvedSuggestions", {
                defaultValue: "No unresolved suggestions.",
              })}
            </StatusMenuEmpty>
          ) : (
            <ul className={styles.list}>
              {overview.map((proposal) => (
                <li key={proposal.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => openSuggestionsCenter(proposal.id)}
                  >
                    <span className={styles.kind}>{t(`ai.kinds.${proposal.kind}`)}</span>
                    <span className={styles.badge}>
                      {t("ai.proposalStatus.new", { defaultValue: "New" })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <StatusMenuFooter>
            {pendingProposals.length > overview.length && (
              <button
                type="button"
                onClick={() => openSuggestionsCenter()}
                disabled={!project}
              >
                {t("ai.moreSuggestionsCount", {
                  count: pendingProposals.length - overview.length,
                  defaultValue: "+{{count}} more",
                })}
              </button>
            )}
            <button
              type="button"
              onClick={() => openSuggestionsCenter()}
              disabled={!project}
            >
              {t("ai.openSuggestionsCenter", {
                defaultValue: "Open suggestions center",
              })}
            </button>
          </StatusMenuFooter>
        </StatusMenu>
      )}
    </div>
  );
};
