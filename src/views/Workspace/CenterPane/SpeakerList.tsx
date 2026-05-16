import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  speakerCreate,
  speakerDelete,
  speakerListForInterview,
  speakerMerge,
  speakerSetDisplayName,
  type Speaker,
} from "../../../ipc/speaker";
import { Modal } from "../../../components/Modal/Modal";
import { Button } from "../../../components/Button/Button";
import styles from "./SpeakerList.module.css";

type Props = {
  interviewId: number;
  onChanged?: () => void;
};

type Action = "" | "add" | "merge" | "remove";

export const SpeakerList = ({ interviewId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<Action>("");
  const [newLabel, setNewLabel] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [removeSpeakerId, setRemoveSpeakerId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    setSpeakers(await speakerListForInterview(interviewId));
    onChanged?.();
  };

  useEffect(() => {
    void speakerListForInterview(interviewId).then(setSpeakers);
  }, [interviewId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const mergeTargets = useMemo(
    () => speakers.filter((speaker) => speaker.id !== mergeSourceId),
    [mergeSourceId, speakers],
  );

  useEffect(() => {
    if (action !== "merge") return;
    if (mergeSourceId === null && speakers.length > 0) {
      setMergeSourceId(speakers[0].id);
      setMergeTargetId(speakers[1]?.id ?? null);
      return;
    }
    const nextTargets = speakers.filter((speaker) => speaker.id !== mergeSourceId);
    if (nextTargets.length === 0) {
      setMergeTargetId(null);
      return;
    }
    if (!nextTargets.some((speaker) => speaker.id === mergeTargetId)) {
      setMergeTargetId(nextTargets[0].id);
    }
  }, [action, mergeSourceId, mergeTargetId, speakers]);

  useEffect(() => {
    if (action !== "remove") return;
    if (removeSpeakerId === null && speakers.length > 0) {
      setRemoveSpeakerId(speakers[0].id);
    }
  }, [action, removeSpeakerId, speakers]);

  const startEdit = (speaker: Speaker) => {
    setEditingId(speaker.id);
    setDraft(speaker.displayName ?? "");
  };

  const submitName = async (speaker: Speaker) => {
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

  const closeActionModal = () => {
    setAction("");
    setNewLabel("");
    setNewDisplayName("");
    setMergeSourceId(null);
    setMergeTargetId(null);
    setRemoveSpeakerId(null);
  };

  const openAction = (nextAction: Action) => {
    setError(null);
    setMenuOpen(false);
    setAction(nextAction);
  };

  const submitAdd = async () => {
    const label = newLabel.trim();
    const displayName = newDisplayName.trim();
    if (!label) return;
    setError(null);
    try {
      await speakerCreate(interviewId, label, displayName ? displayName : null);
      await refresh();
      closeActionModal();
    } catch (err) {
      setError(String(err));
    }
  };

  const submitMerge = async () => {
    if (mergeSourceId === null || mergeTargetId === null) return;
    setError(null);
    try {
      await speakerMerge(mergeSourceId, mergeTargetId);
      await refresh();
      closeActionModal();
    } catch (err) {
      setError(String(err));
    }
  };

  const submitRemove = async () => {
    if (removeSpeakerId === null) return;
    setError(null);
    try {
      await speakerDelete(removeSpeakerId);
      await refresh();
      closeActionModal();
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
        <div className={styles.actions} ref={containerRef}>
          <Button
            onClick={() => setMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={styles.trigger}
          >
            {t("speakers.actions", { defaultValue: "Actions..." })} ▾
          </Button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => openAction("add")}
              >
                {t("speakers.add", { defaultValue: "Add speaker" })}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                disabled={speakers.length < 2}
                onClick={() => openAction("merge")}
              >
                {t("speakers.merge", { defaultValue: "Merge speakers" })}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                disabled={speakers.length === 0}
                onClick={() => openAction("remove")}
              >
                {t("speakers.remove", { defaultValue: "Remove speaker" })}
              </button>
            </div>
          )}
        </div>
        {speakers.map((speaker) => (
          <span key={speaker.id} className={styles.item}>
            <span className={styles.raw}>{speaker.labelRaw}</span>
            {editingId === speaker.id ? (
              <input
                className={styles.input}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void submitName(speaker)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitName(speaker);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button className={styles.name} onClick={() => startEdit(speaker)}>
                {speaker.displayName ?? "—"}
              </button>
            )}
          </span>
        ))}
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <Modal
        open={action === "add"}
        onClose={closeActionModal}
        title={t("speakers.add", { defaultValue: "Add speaker" })}
        size="sm"
        footer={
          <>
            <button type="button" onClick={closeActionModal}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" onClick={() => void submitAdd()}>
              {t("common.create", { defaultValue: "Create" })}
            </button>
          </>
        }
      >
        <div className={styles.fields}>
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
        open={action === "merge"}
        onClose={closeActionModal}
        title={t("speakers.merge", { defaultValue: "Merge speakers" })}
        size="sm"
        footer={
          <>
            <button type="button" onClick={closeActionModal}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" onClick={() => void submitMerge()} disabled={mergeTargetId === null}>
              {t("speakers.merge", { defaultValue: "Merge speakers" })}
            </button>
          </>
        }
      >
        <div className={styles.fields}>
          <p className={styles.help}>
            {t("speakers.mergeHelp", {
              defaultValue:
                "All segments from the source speaker will be reassigned to the target speaker.",
            })}
          </p>
          <label className={styles.field}>
            <span>{t("speakers.source", { defaultValue: "Source speaker" })}</span>
            <select
              value={mergeSourceId === null ? "" : String(mergeSourceId)}
              onChange={(e) => setMergeSourceId(Number(e.target.value))}
            >
              {speakers.map((speaker) => (
                <option key={speaker.id} value={String(speaker.id)}>
                  {speaker.displayName ?? speaker.labelRaw}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t("speakers.target", { defaultValue: "Target speaker" })}</span>
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

      <Modal
        open={action === "remove"}
        onClose={closeActionModal}
        title={t("speakers.remove", { defaultValue: "Remove speaker" })}
        size="sm"
        footer={
          <>
            <button type="button" onClick={closeActionModal}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" onClick={() => void submitRemove()} disabled={removeSpeakerId === null}>
              {t("common.delete", { defaultValue: "Delete" })}
            </button>
          </>
        }
      >
        <div className={styles.fields}>
          <p className={styles.help}>
            {t("speakers.removeHelp", {
              defaultValue:
                "Removing a speaker keeps the transcript segments, but clears that speaker assignment.",
            })}
          </p>
          <label className={styles.field}>
            <span>{t("speakers.remove", { defaultValue: "Remove speaker" })}</span>
            <select
              value={removeSpeakerId === null ? "" : String(removeSpeakerId)}
              onChange={(e) => setRemoveSpeakerId(Number(e.target.value))}
            >
              {speakers.map((speaker) => (
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
