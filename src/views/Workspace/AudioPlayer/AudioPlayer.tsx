import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { currentProjectAtom } from "../../../state/project";
import { selectedInterviewAtom } from "../../../state/interview";
import { selectedSpanAtom } from "../../../state/tagging";
import { AiMenu } from "./AiMenu";
import styles from "./AudioPlayer.module.css";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

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
  const blobUrlRef = useRef<string | null>(null);
  const triedBlobFallbackRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1.0);
  const [loopSpan, setLoopSpan] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const absPath = useMemo(() => {
    if (!project || !interview?.audioPath) return null;
    return project.path + "/" + interview.audioPath;
  }, [project, interview?.audioPath]);

  const assetSrc = useMemo(() => {
    if (!absPath) return null;
    return convertFileSrc(absPath);
  }, [absPath]);

  const releaseBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const loadBlobFallback = useCallback(async (): Promise<boolean> => {
    if (!absPath || !interview?.audioPath || triedBlobFallbackRef.current) {
      return false;
    }
    triedBlobFallbackRef.current = true;
    try {
      const bytes = await readFile(absPath);
      const ext = interview.audioPath.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
      releaseBlobUrl();
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      blobUrlRef.current = blobUrl;
      setSrc(blobUrl);
      return true;
    } catch (error) {
      console.error("Failed to load interview audio as blob fallback", {
        absPath,
        error,
      });
      return false;
    }
  }, [absPath, interview?.audioPath, releaseBlobUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    releaseBlobUrl();
    triedBlobFallbackRef.current = false;
    setSrc(assetSrc);
    setPlaybackError(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
  }, [assetSrc, releaseBlobUrl]);

  useEffect(() => () => releaseBlobUrl(), [releaseBlobUrl]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    try {
      setPlaybackError(null);
      await el.play();
    } catch (error) {
      const message = String((error as { message?: string })?.message ?? error);
      console.error("Interview audio playback failed", {
        src,
        absPath,
        error,
      });
      setPlaybackError(message);
      const switchedToBlob = await loadBlobFallback();
      if (!switchedToBlob) return;
      requestAnimationFrame(() => {
        const retryEl = audioRef.current;
        if (!retryEl) return;
        void retryEl.play().then(
          () => setPlaybackError(null),
          (retryError) => {
            const retryMessage = String(
              (retryError as { message?: string })?.message ?? retryError,
            );
            console.error("Interview audio playback failed after blob fallback", {
              src: blobUrlRef.current,
              absPath,
              error: retryError,
            });
            setPlaybackError(retryMessage);
          },
        );
      });
    }
  }, [absPath, loadBlobFallback, src]);

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
        <span className={styles.spacer} />
        <AiMenu />
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <button
        className={styles.playBtn}
        onClick={() => void togglePlay()}
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
      {playbackError && (
        <span className={styles.error} title={playbackError}>
          Audio failed: {playbackError}
        </span>
      )}
      <AiMenu />
      <audio
        ref={audioRef}
        src={src ?? undefined}
        onLoadedMetadata={(e) =>
          setDuration((e.target as HTMLAudioElement).duration)
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        onError={() => {
          const el = audioRef.current;
          const mediaError = el?.error;
          const message = mediaError
            ? `media error ${mediaError.code}`
            : "unknown media error";
          console.error("Interview audio element error", {
            src,
            absPath,
            mediaError,
          });
          setPlaybackError(message);
        }}
        preload="metadata"
      />
    </div>
  );
};
