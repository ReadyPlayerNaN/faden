import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  speakerCreate,
  speakerListForInterview,
  speakerMerge,
  speakerSetDisplayName,
  type Speaker,
} from "../../../ipc/speaker";
import { Modal } from "../../../components/Modal/Modal";
import styles from "./SpeakerList.module.css";

type Props = {
  interviewId: number;
  onChanged?: () => void;
};

export const SpeakerList = ({ interviewId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [mergeSource, setMergeSource] = useState<Speaker | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  const refresh = async () => {
    setSpeakers(await speakerListForInterview(interviewId));
    onChanged?.();
  };

  useEffect(() => {
    void speakerListForInterview(interviewId).then(setSpeakers);
  }, [interviewId]);

  const mergeTargets = useMemo(
    () => speakers.filter((speaker) => speaker.id !== mergeSource?.id),
    [mergeSource?.id, speakers],
  );

  useEffect(() => {
    setMergeTargetId(mergeTargets[0]?.id ?? null);
  }, [mergeTargets]);

  const startEdit = (speaker: Speaker) => {
    setEditingId(speaker.id);
    setDraft(speaker.displayName ?? "");
  };

  const submit = async (speaker: Speaker) => {
    const value = draft.trim();
    setError(null);
    try {
      await speakerSetDisplayName(speaker.id, value ? value : null);
      await refresh();
      setEditingId(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const submitNewSpeaker = async () => {
    const label = newLabel.trim();
    const displayName = newDisplayName.trim();
    if (!label) return;
    setError(null);
    try {
      await speakerCreate(interviewId, label, displayName ? displayName : null);
      await refresh();
      setAddOpen(false);
      setNewLabel("");
      setNewDisplayName("");
    } catch (err) {
      setError(String(err));
    }
  };

  const submitMerge = async () => {
    if (!mergeSource || mergeTargetId === null) return;
    setError(null);
    try {
      await speakerMerge(mergeSource.id, mergeTargetId);
      await refresh();
      setMergeSource(null);
      setMergeTargetId(null);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.label}>
          {t("speakers.title", { defaultValue: "Speakers" })}:
        </span>
        {speakers.map((speaker) => (
          <span key={speaker.id} className={styles.item}>
            <span className={styles.raw}>{speaker.labelRaw}</span>
            {editingId === speaker.id ? (
              <input
                className={styles.input}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void submit(speaker)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit(speaker);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button className={styles.name} onClick={() => startEdit(speaker)}>
                {speaker.displayName ?? "—"}
              </button>
            )}
            {speakers.length > 1 && (
              <button
                type="button"
                className={styles.action}
                onClick={() => setMergeSource(speaker)}
              >
                {t("speakers.merge", { defaultValue: "Merge" })}
              </button>
            )}
          </span>
        ))}
        <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)}>
          {t("speakers.add", { defaultValue: "Add speaker" })}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setNewLabel("");
          setNewDisplayName("");
        }}
        title={t("speakers.add", { defaultValue: "Add speaker" })}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setAddOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" onClick={() => void submitNewSpeaker()}>
              {t("common.create", { defaultValue: "Create" })}
            </button>
          </>
        }
      >
        <div className={styles.modalFields}>
          <label className={styles.field}>
            <span>{t("speakers.label", { defaultValue: "Label" })}</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("speakers.labelPlaceholder", {
                defaultValue: "e.g. S3",
              })}
            />
          </label>
          <label className={styles.field}>
            <span>{t("speakers.displayName", { defaultValue: "Display name" })}</span>
            <input
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder={t("speakers.displayNamePlaceholder", {
                defaultValue: "Optional",
              })}
            />
          </label>
        </div>
      </Modal>
      <Modal
        open={mergeSource !== null}
        onClose={() => setMergeSource(null)}
        title={t("speakers.mergeTitle", { defaultValue: "Merge speaker" })}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setMergeSource(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              type="button"
              onClick={() => void submitMerge()}
              disabled={mergeTargetId === null}
            >
              {t("speakers.merge", { defaultValue: "Merge" })}
            </button>
          </>
        }
      >
        <div className={styles.modalFields}>
          <p className={styles.help}>
            {t("speakers.mergeHelp", {
              defaultValue:
                "Move all turns from this speaker to another speaker, then remove the source speaker.",
            })}
          </p>
          <div className={styles.field}>
            <span>{t("speakers.source", { defaultValue: "Source" })}</span>
            <strong>{mergeSource?.displayName ?? mergeSource?.labelRaw}</strong>
          </div>
          <label className={styles.field}>
            <span>{t("speakers.target", { defaultValue: "Merge into" })}</span>
            <select
              value={mergeTargetId === null ? "" : String(mergeTargetId)}
              onChange={(e) => setMergeTargetId(Number(e.target.value))}
            >
              {mergeTargets.map((speaker) => (
                <option key={speaker.id} value={String(speaker.id)}>
                  {speaker.displayName ?? speaker.labelRaw}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </>
  );
};
