import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  speakerListForInterview,
  speakerSetDisplayName,
  type Speaker,
} from "../../../ipc/speaker";
import styles from "./SpeakerList.module.css";

type Props = { interviewId: number };

export const SpeakerList = ({ interviewId }: Props) => {
  const { t } = useTranslation();
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void speakerListForInterview(interviewId).then(setSpeakers);
  }, [interviewId]);

  const startEdit = (s: Speaker) => {
    setEditingId(s.id);
    setDraft(s.displayName ?? "");
  };
  const submit = async (s: Speaker) => {
    const v = draft.trim();
    await speakerSetDisplayName(s.id, v ? v : null);
    setSpeakers(await speakerListForInterview(interviewId));
    setEditingId(null);
  };

  if (speakers.length === 0) return null;
  return (
    <div className={styles.bar}>
      <span className={styles.label}>
        {t("speakers.title", { defaultValue: "Speakers" })}:
      </span>
      {speakers.map((s) => (
        <span key={s.id} className={styles.item}>
          <span className={styles.raw}>{s.labelRaw}</span>
          {editingId === s.id ? (
            <input
              className={styles.input}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void submit(s)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit(s);
                if (e.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <button className={styles.name} onClick={() => startEdit(s)}>
              {s.displayName ?? "—"}
            </button>
          )}
        </span>
      ))}
    </div>
  );
};
