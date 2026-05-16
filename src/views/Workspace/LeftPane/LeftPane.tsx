import { useTranslation } from "react-i18next";
import { InterviewList } from "./InterviewList";
import styles from "./LeftPane.module.css";

export const LeftPane = () => {
  const { t } = useTranslation();
  return (
    <aside className={styles.pane}>
      <section className={styles.section}>
        <h3 className={styles.title}>{t("workspace.interviews")}</h3>
        <InterviewList />
      </section>
    </aside>
  );
};
