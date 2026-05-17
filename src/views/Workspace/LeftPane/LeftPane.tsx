import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { Button } from "../../../components/Button/Button";
import { ViewModeLabel } from "../../../components/ViewModeIcon/ViewModeIcon";
import { interviewListAtom } from "../../../state/interview";
import { AddInterviewModal } from "./AddInterviewModal";
import { InterviewList } from "./InterviewList";
import styles from "./LeftPane.module.css";

export const LeftPane = () => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const interviews = useAtomValue(interviewListAtom);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <aside className={styles.pane}>
      <section className={styles.section}>
        {interviews.length > 0 && (
          <div className={styles.menuWrap} ref={menuRef}>
            <Button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={styles.titleButton}
            >
              <span className={styles.titleButtonContent}>
                <ViewModeLabel view="interviews">{t("workspace.interviews")}</ViewModeLabel>
                <span aria-hidden="true">▾</span>
              </span>
            </Button>
            {menuOpen && (
              <div className={styles.menuDropdown} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setModalOpen(true);
                  }}
                >
                  {t("workspace.createInterview", { defaultValue: "Add interview" })}
                </button>
              </div>
            )}
          </div>
        )}
        <InterviewList onAddInterview={() => setModalOpen(true)} />
      </section>
      {modalOpen && <AddInterviewModal onClose={() => setModalOpen(false)} />}
    </aside>
  );
};
