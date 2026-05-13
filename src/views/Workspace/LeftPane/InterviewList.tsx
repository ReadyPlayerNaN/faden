import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue } from "jotai";
import { interviewList as fetchList } from "../../../ipc/interview";
import { transcribeStart, transcribeCancel } from "../../../ipc/transcribe";
import { interviewListAtom, selectedInterviewIdAtom } from "../../../state/interview";
import { transcriptionRunsAtom } from "../../../state/transcription";
import { Button } from "../../../components/Button/Button";
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
  const status = iv.transcriptStatus;
  const hasAudio = iv.audioPath !== null;
  const isInProgress = status === "in_progress" || progress?.lastProgress.stage === "starting"
    || progress?.lastProgress.stage === "normalizing"
    || progress?.lastProgress.stage === "chunking"
    || progress?.lastProgress.stage === "transcribing_chunk"
    || progress?.lastProgress.stage === "chunk_complete";

  const onTranscribe = async () => {
    try { await transcribeStart(iv.id); } catch (e) { window.alert(String((e as { message?: string }).message ?? e)); }
  };
  const onCancel = async () => {
    try { await transcribeCancel(iv.id); } catch (e) { window.alert(String((e as { message?: string }).message ?? e)); }
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
      </div>
    </li>
  );
};
