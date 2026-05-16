import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useSetAtom } from "jotai";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import { TextField } from "../../../components/TextField/TextField";
import {
  interviewCreate,
  interviewCreateWithAudio,
  interviewImportText,
  interviewImportJson,
  interviewImportAudioText,
  interviewImportAudioJson,
  interviewList as fetchList,
} from "../../../ipc/interview";
import { interviewListAtom, selectedInterviewIdAtom } from "../../../state/interview";
import styles from "./AddInterviewModal.module.css";

type TranscriptType = "none" | "text" | "json";
type Props = { onClose: () => void };

export const AddInterviewModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const setList = useSetAtom(interviewListAtom);
  const setSelected = useSetAtom(selectedInterviewIdAtom);
  const [name, setName] = useState("");
  const [transcriptType, setTranscriptType] = useState<TranscriptType>("none");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [bodyText, setBodyText] = useState("");
  const [bodyJson, setBodyJson] = useState("");
  const [bodyTextPath, setBodyTextPath] = useState<string | null>(null);
  const [bodyJsonPath, setBodyJsonPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const basenameWithoutExt = (path: string) =>
    path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? path;

  const pickAudio = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [
        { name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "aac"] },
      ],
    });
    if (p && !Array.isArray(p)) {
      setAudioPath(p);
      if (!name.trim()) setName(basenameWithoutExt(p));
    }
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
    if (!name.trim()) setName(basenameWithoutExt(p));
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
    if (!name.trim()) setName(basenameWithoutExt(p));
  };

  const refresh = async (newId: number) => {
    setList(await fetchList());
    setSelected(newId);
    onClose();
  };

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t("import.errorNameRequired") as string);

      let created;
      if (transcriptType === "none") {
        created = audioPath
          ? await interviewCreateWithAudio(trimmedName, audioPath)
          : await interviewCreate(trimmedName);
      } else if (transcriptType === "text") {
        if (!bodyText.trim()) throw new Error(t("import.errorEmpty") as string);
        created = audioPath
          ? await interviewImportAudioText(trimmedName, audioPath, bodyText)
          : await interviewImportText(trimmedName, bodyText);
      } else {
        if (!bodyJson.trim()) throw new Error(t("import.errorEmpty") as string);
        try {
          JSON.parse(bodyJson);
        } catch {
          throw new Error(t("import.errorParse") as string);
        }
        created = audioPath
          ? await interviewImportAudioJson(trimmedName, audioPath, bodyJson)
          : await interviewImportJson(trimmedName, bodyJson);
      }
      await refresh(created.id);
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
      title={t("import.title")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={busy}>
            {t("import.submit")}
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
            <Button onClick={() => void pickAudio()}>{t("import.pickAudio")}</Button>
            {audioPath && <span className={styles.path}>{audioPath}</span>}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>{t("import.transcript")}</div>
          <div className={styles.choiceList}>
            {(["none", "text", "json"] as TranscriptType[]).map((value) => (
              <label key={value} className={styles.choiceItem}>
                <input
                  type="radio"
                  name="transcriptType"
                  checked={transcriptType === value}
                  onChange={() => setTranscriptType(value)}
                />
                <span>{t(`import.transcriptType.${value}`)}</span>
              </label>
            ))}
          </div>

          {transcriptType === "text" && (
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

          {transcriptType === "json" && (
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
