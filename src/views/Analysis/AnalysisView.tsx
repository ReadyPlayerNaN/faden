import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../../components/Button/Button";
import { PageContainer } from "../../components/PageContainer/PageContainer";
import { ProjectHeader } from "../../components/ProjectHeader/ProjectHeader";
import { AnalysisDataProvider } from "./AnalysisData";
import { CooccurrenceView } from "./CooccurrenceView";
import { EvidenceBrowserContent } from "./EvidenceBrowserView";
import { MemoLayerView } from "./MemoLayerView";
import { ThemeMapView } from "./ThemeMapView";
import styles from "./AnalysisView.module.css";

type Section = "theme-map" | "evidence" | "cooccurrence" | "memos";

type Props = {
  section: Section;
};

export const AnalysisView = ({ section }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectPath } = useParams({ strict: false }) as { projectPath: string };

  const tabs = useMemo(
    () => [
      {
        key: "theme-map" as const,
        label: t("analysis.themeMap.title", { defaultValue: "Theme map" }),
        to: "/workspace/$projectPath/analysis" as const,
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

  return (
    <div className={styles.shell}>
      <ProjectHeader
        activeView="analysis"
        viewAccessory={
          <div className={styles.tabBar} role="tablist" aria-label={t("analysis.title", { defaultValue: "Analysis" })}>
            {tabs.map((tab) => {
              const active = tab.key === section;
              return (
                <Button
                  key={tab.key}
                  onClick={() =>
                    void navigate({
                      to: tab.to,
                      params: { projectPath },
                    })
                  }
                  className={`${styles.tabButton} ${active ? styles.tabButtonActive : ""}`.trim()}
                  aria-pressed={active}
                >
                  {tab.label}
                </Button>
              );
            })}
          </div>
        }
      />

      <PageContainer className={styles.wrap} size="xwide">
        <AnalysisDataProvider>
          {section === "theme-map" ? (
            <ThemeMapView />
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
