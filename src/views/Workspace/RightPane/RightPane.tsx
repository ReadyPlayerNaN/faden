import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { selectedSpanAtom } from "../../../state/tagging";
import { SpanDetail } from "./SpanDetail";
import styles from "./RightPane.module.css";

export const RightPane = () => {
  const { t } = useTranslation();
  const span = useAtomValue(selectedSpanAtom);
  return (
    <aside className={styles.pane}>
      {span === null ? (
        <p className={styles.empty}>{t("workspace.rightPaneEmpty")}</p>
      ) : (
        <SpanDetail span={span} />
      )}
    </aside>
  );
};
