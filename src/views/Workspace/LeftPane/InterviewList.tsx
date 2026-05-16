import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  interviewList as fetchList,
  interviewSetAudio,
  interviewClearAudio,
} from "../../../ipc/interview";
import { transcribeStart, transcribeCancel } from "../../../ipc/transcribe";
import { interviewListAtom, selectedInterviewIdAtom } from "../../../state/interview";
import { transcriptionRunsAtom } from "../../../state/transcription";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import { AddInterviewModal } from "./AddInterviewModal";
import styles from "./InterviewList.module.css";
import type { Interview } from "../../../ipc/interview";

export const InterviewList = () => {
  const { t } = useTranslation();
  const [list, setList] = useAtom(interviewListAtom);
  const [selected, setSelected] = useAtom(selectedInterviewIdAtom);
  const runs = useAtomValue(transcriptionRunsAtom);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    void fetchList().then(setList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.wrap}>
      <Button onClick={() => setModalOpen(true)}>{t("workspace.addInterview")}</Button>
      {list.length === 0 ? (
        <p className={styles.empty}>{t("workspace.noInterviews")}</p>
      ) : (
        <ul className={styles.list}>
          {list.map((i) => (
            <InterviewRow
              key={i.id}
              iv={i}
              selected={selected === i.id}
              onSelect={() => setSelected(i.id)}
              progress={runs[i.id]}
            />
          ))}
        </ul>
      )}
      {modalOpen && <AddInterviewModal onClose={() => setModalOpen(false)} />}
    </div>
  );
};

type RowProps = {
  iv: Interview;
  selected: boolean;
  onSelect: () => void;
  progress?: import("../../../state/transcription").RunSnapshot;
};

const InterviewRow = ({ iv, selected, onSelect, progress }: RowProps) => {
  const { t } = useTranslation();
  const setList = useSetAtom(interviewListAtom);
  const status = iv.transcriptStatus;
  const hasAudio = iv.audioPath !== null;
  const isInProgress = status === "in_progress" || progress?.lastProgress.stage === "starting"
    || progress?.lastProgress.stage === "normalizing"
    || progress?.lastProgress.stage === "chunking"
    || progress?.lastProgress.stage === "transcribing_chunk"
    || progress?.lastProgress.stage === "chunk_complete";

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const menuWrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) {
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

  const onTranscribe = async () => {
    try { await transcribeStart(iv.id); } catch (e) { window.alert(String((e as { message?: string }).message ?? e)); }
  };
  const onCancel = async () => {
    try { await transcribeCancel(iv.id); } catch (e) { window.alert(String((e as { message?: string }).message ?? e)); }
  };

  const pickAndSetAudio = async () => {
    setMenuOpen(false);
    try {
      const p = await openDialog({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "aac"] }],
      });
      if (!p || Array.isArray(p)) return;
      await interviewSetAudio(iv.id, p);
      setList(await fetchList());
    } catch (e) {
      window.alert(String((e as { message?: string }).message ?? e));
    }
  };

  const doRemoveAudio = async () => {
    try {
      await interviewClearAudio(iv.id);
      setList(await fetchList());
      setConfirmRemove(false);
    } catch (e) {
      window.alert(String((e as { message?: string }).message ?? e));
    }
  };

  const renderRight = () => {
    if (isInProgress) {
      let label = t("workspace.transcribing");
      const p = progress?.lastProgress;
      if (p?.stage === "transcribing_chunk") {
        label = t("workspace.transcribingChunk", { index: p.index + 1, total: p.total });
      }
      return (
        <span className={styles.rowRight}>
          <span className={styles.progressLabel}>{label}</span>
          <button className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); void onCancel(); }}>
            {t("workspace.cancel")}
          </button>
        </span>
      );
    }
    if (status === "complete") {
      return <span className={styles.rowRight + " " + styles.statusOk}>{t("workspace.transcriptComplete")}</span>;
    }
    if (hasAudio && (status === "none" || status === "failed")) {
      return (
        <span className={styles.rowRight}>
          {status === "failed" && <span className={styles.statusFailed}>{t("workspace.transcriptFailed")}</span>}
          <button className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); void onTranscribe(); }}>
            {t("workspace.transcribe")}
          </button>
        </span>
      );
    }
    return null;
  };

  return (
    <li>
      <div
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      >
        <span className={styles.rowLeft}>{iv.name}</span>
        {renderRight()}
        <span className={styles.menuWrap} ref={menuWrapRef}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={t("audio.menu", { defaultValue: "Audio actions" }) as string}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            {"⋯"}
          </button>
          {menuOpen && (
            <div className={styles.menuDropdown} role="menu">
              {!hasAudio && (
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); void pickAndSetAudio(); }}
                >
                  {t("audio.attach", { defaultValue: "Attach audio…" })}
                </button>
              )}
              {hasAudio && (
                <>
                  <button
                    type="button"
                    className={styles.menuItem}
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); void pickAndSetAudio(); }}
                  >
                    {t("audio.replace", { defaultValue: "Replace audio…" })}
                  </button>
                  <button
                    type="button"
                    className={styles.menuItem}
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmRemove(true); }}
                  >
                    {t("audio.remove", { defaultValue: "Remove audio" })}
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </div>
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t("audio.confirmRemove", { defaultValue: "Remove audio?" })}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmRemove(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button variant="danger" onClick={() => void doRemoveAudio()}>
              {t("audio.remove", { defaultValue: "Remove audio" })}
            </Button>
          </>
        }
      >
        <p>
          {t("audio.confirmRemoveBody", {
            defaultValue:
              "The audio file will be deleted from the project. The transcript will be kept.",
          })}
        </p>
      </Modal>
    </li>
  );
};
