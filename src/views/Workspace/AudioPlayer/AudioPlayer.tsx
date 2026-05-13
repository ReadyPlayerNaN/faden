import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { convertFileSrc } from "@tauri-apps/api/core";
import { currentProjectAtom } from "../../../state/project";
import { selectedInterviewAtom } from "../../../state/interview";
import { selectedSpanAtom } from "../../../state/tagging";
import styles from "./AudioPlayer.module.css";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;

const formatTime = (s: number): string => {
  if (!Number.isFinite(s)) return "0:00";
  const totalS = Math.floor(s);
  const m = Math.floor(totalS / 60);
  const sec = totalS % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const AudioPlayer = () => {
  const { t } = useTranslation();
  const project = useAtomValue(currentProjectAtom);
  const interview = useAtomValue(selectedInterviewAtom);
  const span = useAtomValue(selectedSpanAtom);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1.0);
  const [loopSpan, setLoopSpan] = useState(false);

  const src = useMemo(() => {
    if (!project || !interview?.audioPath) return null;
    const abs = project.path + "/" + interview.audioPath;
    return convertFileSrc(abs);
  }, [project, interview?.audioPath]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const seekTo = (target: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(target, el.duration || 0));
  };

  // Loop within span boundary
  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (!el) return;
    setTime(el.currentTime);
    if (loopSpan && span && el.currentTime >= span.audioEndSec) {
      el.currentTime = span.audioStartSec;
    }
  };

  useEffect(() => {
    const toggle = () => togglePlay();
    const loop = () => setLoopSpan((v) => !v);
    window.addEventListener("stt:toggle-play", toggle);
    window.addEventListener("stt:toggle-loop", loop);
    return () => {
      window.removeEventListener("stt:toggle-play", toggle);
      window.removeEventListener("stt:toggle-loop", loop);
    };
  }, [togglePlay]);

  if (!src) {
    return (
      <div className={styles.bar}>
        <span className={styles.empty}>{t("workspace.audioFilter")}</span>
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <button
        className={styles.playBtn}
        onClick={togglePlay}
        aria-label="play/pause"
        data-audio-toggle
      >
        {playing ? "⏸" : "▶"}
      </button>
      <span className={styles.time}>{formatTime(time)}</span>
      <input
        className={styles.scrub}
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={time}
        onChange={(e) => seekTo(Number(e.target.value))}
      />
      <span className={styles.time}>{formatTime(duration)}</span>
      <select
        className={styles.speed}
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s.toFixed(2)}×
          </option>
        ))}
      </select>
      <label className={styles.loop}>
        <input
          type="checkbox"
          checked={loopSpan}
          onChange={(e) => setLoopSpan(e.target.checked)}
          disabled={!span}
        />
        {t("workspace.loopSpan")}
      </label>
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={(e) =>
          setDuration((e.target as HTMLAudioElement).duration)
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        preload="metadata"
      />
    </div>
  );
};
