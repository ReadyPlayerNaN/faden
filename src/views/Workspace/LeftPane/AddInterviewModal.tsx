import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSetAtom } from "jotai";
import { Button } from "../../../components/Button/Button";
import { TextField } from "../../../components/TextField/TextField";
import {
  interviewCreateWithAudio,
  interviewImportText,
  interviewImportJson,
  interviewImportAudioText,
  interviewList as fetchList,
} from "../../../ipc/interview";
import { interviewListAtom, selectedInterviewIdAtom } from "../../../state/interview";
import styles from "./AddInterviewModal.module.css";

type Tab = "audio" | "text" | "json" | "audioText";
type Props = { onClose: () => void };

export const AddInterviewModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const setList = useSetAtom(interviewListAtom);
  const setSelected = useSetAtom(selectedInterviewIdAtom);
  const [tab, setTab] = useState<Tab>("audio");
  const [name, setName] = useState("");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [bodyText, setBodyText] = useState("");
  const [bodyJson, setBodyJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickAudio = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [
        { name: "Audio", extensions: ["mp3", "m4a", "wav", "ogg", "flac", "aac"] },
      ],
    });
    if (p && !Array.isArray(p)) setAudioPath(p);
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
      if (!name.trim()) throw new Error(t("import.name") as string);
      let created;
      if (tab === "audio") {
        if (!audioPath) throw new Error(t("import.pickAudio") as string);
        created = await interviewCreateWithAudio(name, audioPath);
      } else if (tab === "text") {
        if (!bodyText.trim()) throw new Error(t("import.errorEmpty") as string);
        created = await interviewImportText(name, bodyText);
      } else if (tab === "json") {
        if (!bodyJson.trim()) throw new Error(t("import.errorEmpty") as string);
        try {
          JSON.parse(bodyJson);
        } catch {
          throw new Error(t("import.errorParse") as string);
        }
        created = await interviewImportJson(name, bodyJson);
      } else {
        if (!audioPath || !bodyText.trim()) throw new Error(t("import.errorEmpty") as string);
        created = await interviewImportAudioText(name, audioPath, bodyText);
      }
      await refresh(created.id);
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>{t("import.title")}</h2>
        <div className={styles.tabs}>
          {(["audio", "text", "json", "audioText"] as Tab[]).map((k) => (
            <button
              key={k}
              className={`${styles.tab} ${tab === k ? styles.tabActive : ""}`}
              onClick={() => setTab(k)}
            >
              {t(`import.tabs.${k}`)}
            </button>
          ))}
        </div>
        <TextField
          label={t("import.name") as string}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {(tab === "audio" || tab === "audioText") && (
          <div className={styles.audioRow}>
            <Button onClick={() => void pickAudio()}>{t("import.pickAudio")}</Button>
            {audioPath && <span className={styles.path}>{audioPath}</span>}
          </div>
        )}
        {(tab === "text" || tab === "audioText") && (
          <textarea
            className={styles.area}
            rows={8}
            placeholder={t("import.pasteText") as string}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
          />
        )}
        {tab === "json" && (
          <textarea
            className={styles.area}
            rows={8}
            placeholder={t("import.pasteJson") as string}
            value={bodyJson}
            onChange={(e) => setBodyJson(e.target.value)}
          />
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={busy}>
            {t("import.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
};
