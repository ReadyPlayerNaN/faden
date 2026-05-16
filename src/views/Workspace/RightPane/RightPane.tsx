import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { selectedSpanAtom } from "../../../state/tagging";
import { SpanDetail } from "./SpanDetail";
import { StagingPanel } from "../AI/StagingPanel";
import styles from "./RightPane.module.css";

export const RightPane = () => {
  const { t } = useTranslation();
  const span = useAtomValue(selectedSpanAtom);
  return (
    <aside className={styles.pane}>
      <div className={styles.detail}>
        {span === null ? (
          <p className={styles.empty}>{t("workspace.rightPaneEmpty")}</p>
        ) : (
          <SpanDetail span={span} />
        )}
      </div>
      <StagingPanel />
    </aside>
  );
};
