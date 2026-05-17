import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { AnalysisDataProvider } from "./AnalysisData";
import { CooccurrenceView } from "./CooccurrenceView";
import { EvidenceBrowserContent } from "./EvidenceBrowserView";
import { MemoLayerView } from "./MemoLayerView";
import { PeopleLensView } from "./PeopleLensView";
import { ThemeMapView } from "./ThemeMapView";
import { type AnalysisSearch } from "./analysisSearch";
import styles from "./AnalysisView.module.css";

type Section = "theme-map" | "people" | "evidence" | "cooccurrence" | "memos";

type Props = {
  section: Section;
};

export const AnalysisView = ({ section }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };
  const search = useSearch({ strict: false }) as AnalysisSearch;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const tabs = useMemo(
    () => [
      {
        key: "theme-map" as const,
        label: t("analysis.themeMap.title", { defaultValue: "Theme map" }),
        to: "/workspace/$projectPath/analysis" as const,
      },
      {
        key: "people" as const,
        label: t("analysis.peopleLens.title", { defaultValue: "People lens" }),
        to: "/workspace/$projectPath/analysis/people" as const,
      },
      {
        key: "evidence" as const,
        label: t("analysis.evidence.title", { defaultValue: "Evidence browser" }),
        to: "/workspace/$projectPath/analysis/evidence" as const,
      },
      {
        key: "cooccurrence" as const,
        label: t("analysis.cooccurrence.title", { defaultValue: "Co-occurrence" }),
        to: "/workspace/$projectPath/analysis/cooccurrence" as const,
      },
      {
        key: "memos" as const,
        label: t("analysis.memos.title", { defaultValue: "Memos" }),
        to: "/workspace/$projectPath/analysis/memos" as const,
      },
    ],
    [t],
  );

  const activeTab = tabs.find((tab) => tab.key === section) ?? tabs[0];

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className={styles.shell}>
      <ProjectHeader
        activeView="analysis"
        viewAccessory={
          <div className={styles.subviewMenuWrap} ref={menuRef}>
            <Button
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={styles.subviewMenuTrigger}
            >
              <span className={styles.subviewMenuTriggerContent}>
                <span className={styles.subviewMenuLabel}>{activeTab.label}</span>
                <span aria-hidden="true">▾</span>
              </span>
            </Button>
            {menuOpen && (
              <div className={styles.subviewMenuDropdown} role="menu" aria-label={t("analysis.title", { defaultValue: "Analysis" })}>
                {tabs.map((tab) => {
                  const active = tab.key === section;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      aria-current={active ? "page" : undefined}
                      className={`${styles.subviewMenuItem} ${active ? styles.subviewMenuItemActive : ""}`.trim()}
                      onClick={() => {
                        setMenuOpen(false);
                        if (active) return;
                        void navigate({
                          to: tab.to,
                          params: { projectPath },
                          search: (prev) => ({ ...prev, ...search }),
                        });
                      }}
                    >
                      <span>{tab.label}</span>
                      {active ? <span className={styles.subviewMenuItemMark} aria-hidden="true">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        }
      />

      <PageContainer className={styles.wrap}>
        <AnalysisDataProvider>
          {section === "theme-map" ? (
            <ThemeMapView />
          ) : section === "people" ? (
            <PeopleLensView />
          ) : section === "evidence" ? (
            <EvidenceBrowserContent />
          ) : section === "cooccurrence" ? (
            <CooccurrenceView />
          ) : (
            <MemoLayerView />
          )}
        </AnalysisDataProvider>
      </PageContainer>
    </div>
  );
};
