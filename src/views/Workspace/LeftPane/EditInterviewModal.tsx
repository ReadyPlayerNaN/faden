import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useSetAtom } from "jotai";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import { TextField } from "../../../components/TextField/TextField";
import {
  interviewList as fetchList,
  interviewRename,
  interviewReplaceTranscriptJson,
  interviewReplaceTranscriptText,
  interviewSetAudio,
  type Interview,
} from "../../../ipc/interview";
import {
  interviewContentVersionAtom,
  interviewListAtom,
} from "../../../state/interview";
import styles from "./AddInterviewModal.module.css";

type TranscriptUpdateMode = "none" | "text" | "json";

type Props = {
  interview: Interview;
  onClose: () => void;
};

export const EditInterviewModal = ({ interview, onClose }: Props) => {
  const { t } = useTranslation();
  const setList = useSetAtom(interviewListAtom);
  const bumpInterviewContentVersion = useSetAtom(interviewContentVersionAtom);
  const [name, setName] = useState(interview.name);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptUpdateMode>("none");
  const [bodyText, setBodyText] = useState("");
  const [bodyJson, setBodyJson] = useState("");
  const [bodyTextPath, setBodyTextPath] = useState<string | null>(null);
  const [bodyJsonPath, setBodyJsonPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickAudio = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "aac"] }],
    });
    if (p && !Array.isArray(p)) setAudioPath(p);
  };

  const pickTranscriptTextFile = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "Transcript text", extensions: ["txt", "md"] }],
    });
    if (!p || Array.isArray(p)) return;
    const text = await readTextFile(p);
    setBodyText(text);
    setBodyTextPath(p);
  };

  const pickTranscriptJsonFile = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "Transcript JSON", extensions: ["json"] }],
    });
    if (!p || Array.isArray(p)) return;
    const text = await readTextFile(p);
    JSON.parse(text);
    setBodyJson(text);
    setBodyJsonPath(p);
  };

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t("import.errorNameRequired") as string);

      let contentChanged = false;
      if (trimmedName !== interview.name) {
        await interviewRename(interview.id, trimmedName);
      }
      if (audioPath) {
        await interviewSetAudio(interview.id, audioPath);
        contentChanged = true;
      }
      if (transcriptMode === "text") {
        if (!bodyText.trim()) throw new Error(t("import.errorEmpty") as string);
        await interviewReplaceTranscriptText(interview.id, bodyText);
        contentChanged = true;
      }
      if (transcriptMode === "json") {
        if (!bodyJson.trim()) throw new Error(t("import.errorEmpty") as string);
        try {
          JSON.parse(bodyJson);
        } catch {
          throw new Error(t("import.errorParse") as string);
        }
        await interviewReplaceTranscriptJson(interview.id, bodyJson);
        contentChanged = true;
      }

      setList(await fetchList());
      if (contentChanged) {
        bumpInterviewContentVersion((value) => value + 1);
      }
      onClose();
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t("interview.edit", { defaultValue: "Edit interview" })}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <TextField
          label={t("import.name") as string}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className={styles.section}>
          <div className={styles.sectionHeader}>{t("import.audio")}</div>
          <div className={styles.audioRow}>
            <Button onClick={() => void pickAudio()}>
              {t(interview.audioPath ? "audio.replace" : "audio.add", {
                defaultValue: interview.audioPath ? "Replace audio…" : "Add audio…",
              })}
            </Button>
            <span className={styles.path}>
              {audioPath ?? interview.audioPath ?? t("audio.none", { defaultValue: "No audio selected" })}
            </span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            {t("interview.reuploadTranscript", { defaultValue: "Reupload transcript" })}
          </div>
          <div className={styles.choiceList}>
            {(["none", "text", "json"] as TranscriptUpdateMode[]).map((value) => (
              <label key={value} className={styles.choiceItem}>
                <input
                  type="radio"
                  name="transcriptUpdateType"
                  checked={transcriptMode === value}
                  onChange={() => setTranscriptMode(value)}
                />
                <span>
                  {t(`interview.transcriptUpdate.${value}`, {
                    defaultValue:
                      value === "none"
                        ? "Keep current transcript"
                        : value === "text"
                          ? "Replace with text"
                          : "Replace with JSON",
                  })}
                </span>
              </label>
            ))}
          </div>

          {transcriptMode === "text" && (
            <>
              <div className={styles.audioRow}>
                <Button onClick={() => void pickTranscriptTextFile()}>{t("import.pickFile")}</Button>
                {bodyTextPath && <span className={styles.path}>{bodyTextPath}</span>}
              </div>
              <textarea
                className={styles.area}
                rows={8}
                placeholder={t("import.pasteText") as string}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </>
          )}

          {transcriptMode === "json" && (
            <>
              <div className={styles.audioRow}>
                <Button onClick={() => void pickTranscriptJsonFile()}>{t("import.pickFile")}</Button>
                {bodyJsonPath && <span className={styles.path}>{bodyJsonPath}</span>}
              </div>
              <textarea
                className={styles.area}
                rows={8}
                placeholder={t("import.pasteJson") as string}
                value={bodyJson}
                onChange={(e) => setBodyJson(e.target.value)}
              />
            </>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
};
