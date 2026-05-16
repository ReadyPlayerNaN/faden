import { useEffect, useRef, useState } from "react";
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
  const [mergeSpeakerIds, setMergeSpeakerIds] = useState<number[]>([]);
  const [mergeNewName, setMergeNewName] = useState("");
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
    setMergeSpeakerIds([]);
    setMergeNewName("");
    setRemoveSpeakerId(null);
  };

  const openAction = (nextAction: Action) => {
    setError(null);
    setMenuOpen(false);
    setAction(nextAction);
  };

  const toggleMergeSpeaker = (speakerId: number) => {
    setMergeSpeakerIds((current) =>
      current.includes(speakerId)
        ? current.filter((id) => id !== speakerId)
        : [...current, speakerId],
    );
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
    if (mergeSpeakerIds.length < 2) {
      setError(
        t("speakers.mergeSelectAtLeastTwo", {
          defaultValue: "Select at least two speakers to merge.",
        }),
      );
      return;
    }
    if (!mergeNewName.trim()) {
      setError(
        t("speakers.mergeNameRequired", {
          defaultValue: "Enter a name for the merged speaker.",
        }),
      );
      return;
    }
    setError(null);
    try {
      await speakerMerge(interviewId, mergeSpeakerIds, mergeNewName.trim());
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
                {speaker.displayName ?? speaker.labelRaw}
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
            <button type="button" onClick={() => void submitMerge()}>
              {t("speakers.merge", { defaultValue: "Merge speakers" })}
            </button>
          </>
        }
      >
        <div className={styles.fields}>
          <p className={styles.help}>
            {t("speakers.mergeHelp", {
              defaultValue:
                "Select multiple speakers to merge, then give the merged speaker a new name.",
            })}
          </p>
          <label className={styles.field}>
            <span>{t("speakers.mergeName", { defaultValue: "Merged speaker name" })}</span>
            <input
              value={mergeNewName}
              onChange={(e) => setMergeNewName(e.target.value)}
              placeholder={t("speakers.mergeNamePlaceholder", {
                defaultValue: "Enter merged speaker name",
              })}
            />
          </label>
          <div className={styles.field}>
            <span>{t("speakers.mergeSelection", { defaultValue: "Speakers to merge" })}</span>
            <div className={styles.checkboxGroup}>
              {speakers.map((speaker) => {
                const checked = mergeSpeakerIds.includes(speaker.id);
                return (
                  <label key={speaker.id} className={styles.checkboxItem}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMergeSpeaker(speaker.id)}
                    />
                    <span>
                      {speaker.displayName ?? speaker.labelRaw}
                      {speaker.displayName ? (
                        <span className={styles.checkboxMeta}> ({speaker.labelRaw})</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
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
