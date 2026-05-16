import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  interviewDelete,
  interviewList as fetchList,
  interviewSetAudio,
} from "../../../ipc/interview";
import { transcribeStart, transcribeCancel } from "../../../ipc/transcribe";
import {
  interviewListAtom,
  selectedInterviewIdAtom,
} from "../../../state/interview";
import { transcriptionRunsAtom } from "../../../state/transcription";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import { AddInterviewModal } from "./AddInterviewModal";
import { EditInterviewModal } from "./EditInterviewModal";
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
  const setSelectedInterviewId = useSetAtom(selectedInterviewIdAtom);
  const status = iv.transcriptStatus;
  const hasAudio = iv.audioPath !== null;
  const isInProgress = status === "in_progress" || progress?.lastProgress.stage === "starting"
    || progress?.lastProgress.stage === "normalizing"
    || progress?.lastProgress.stage === "chunking"
    || progress?.lastProgress.stage === "transcribing_chunk"
    || progress?.lastProgress.stage === "chunk_complete";

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const addAudio = async () => {
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

  const doDeleteInterview = async () => {
    try {
      await interviewDelete(iv.id);
      setList((prev) => prev.filter((item) => item.id !== iv.id));
      setSelectedInterviewId((prev) => (prev === iv.id ? null : prev));
      setConfirmDelete(false);
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
      return null;
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
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
          setMenuOpen(true);
        }}
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
            aria-label={t("interview.menu", { defaultValue: "Interview actions" }) as string}
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
                  onClick={(e) => { e.stopPropagation(); void addAudio(); }}
                >
                  {t("audio.add", { defaultValue: "Add audio…" })}
                </button>
              )}
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setEditOpen(true); }}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }}
              >
                {t("common.delete")}
              </button>
            </div>
          )}
        </span>
      </div>
      {editOpen && <EditInterviewModal interview={iv} onClose={() => setEditOpen(false)} />}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("interview.confirmDelete", {
          name: iv.name,
          defaultValue: 'Delete "{{name}}"?',
        })}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button variant="danger" onClick={() => void doDeleteInterview()}>
              {t("common.delete", { defaultValue: "Delete" })}
            </Button>
          </>
        }
      >
        <p>
          {t("interview.confirmDeleteBody", {
            defaultValue:
              "This will permanently delete the interview, transcript, audio, and tagged spans.",
          })}
        </p>
      </Modal>
    </li>
  );
};
