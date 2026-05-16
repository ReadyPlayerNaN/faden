import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue } from "jotai";
import { selectedInterviewAtom } from "../../../state/interview";
import {
  segmentPlaybackRequestAtom,
  segmentPlaybackStateAtom,
} from "../../../state/audio";
import { selectedSpanAtom } from "../../../state/tagging";
import { interviewAudioStreamUrl } from "../../../ipc/interview";
import { AiMenu } from "./AiMenu";
import styles from "./AudioPlayer.module.css";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;

const formatTime = (s: number): string => {
  if (!Number.isFinite(s)) return "0:00";
  const totalS = Math.floor(s);
  const m = Math.floor(totalS / 60);
  const sec = totalS % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : String((error as { name?: string; message?: string })?.name ?? error).includes("AbortError") ||
      String((error as { message?: string })?.message ?? error).includes("aborted");

export const AudioPlayer = () => {
  const { t } = useTranslation();
  const interview = useAtomValue(selectedInterviewAtom);
  const segmentPlaybackRequest = useAtomValue(segmentPlaybackRequestAtom);
  const [segmentPlaybackState, setSegmentPlaybackState] = useAtom(
    segmentPlaybackStateAtom,
  );
  const span = useAtomValue(selectedSpanAtom);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoplayRef = useRef(false);
  const lastRetriedSrcRef = useRef<string | null>(null);
  const srcRef = useRef<string | null>(null);
  const timeRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1.0);
  const [loopSpan, setLoopSpan] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const segmentPlaybackStateRef = useRef(segmentPlaybackState);

  const resolveStreamUrl = useCallback(
    async ({ preserveTime = false, autoplay = false } = {}): Promise<string | null> => {
      if (!interview?.audioPath) return null;
      try {
        const nextUrl = await interviewAudioStreamUrl(interview.id);
        setPlaybackError(null);
        if (srcRef.current !== nextUrl) {
          pendingSeekRef.current = preserveTime
            ? audioElRef.current?.currentTime ?? timeRef.current
            : null;
          pendingAutoplayRef.current = autoplay;
          setSrc(nextUrl);
        } else if (autoplay && audioElRef.current?.paused === true) {
          if (pendingSeekRef.current !== null) {
            audioElRef.current.currentTime = pendingSeekRef.current;
            pendingSeekRef.current = null;
          }
          await audioElRef.current.play();
        }
        return nextUrl;
      } catch (error) {
        const message = String((error as { message?: string })?.message ?? error);
        console.error("Failed to resolve interview audio stream URL", {
          interviewId: interview.id,
          error,
        });
        setPlaybackError(message);
        return null;
      }
    },
    [interview?.audioPath, interview?.id],
  );

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setPlaybackError(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setSegmentPlaybackState({
      activeSegmentId: null,
      startSec: null,
      endSec: null,
      loop: false,
      playing: false,
      currentTime: 0,
      duration: 0,
    });
    pendingSeekRef.current = null;
    pendingAutoplayRef.current = false;
    lastRetriedSrcRef.current = null;

    if (!interview?.audioPath) return;

    void resolveStreamUrl().then((url) => {
      if (cancelled || !url) return;
      lastRetriedSrcRef.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [interview?.audioPath, interview?.id, resolveStreamUrl, setSegmentPlaybackState]);

  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    segmentPlaybackStateRef.current = segmentPlaybackState;
  }, [segmentPlaybackState]);

  useEffect(() => {
    audioElRef.current = audioEl;
    if (!audioEl) return;
    audioEl.playbackRate = speed;
  }, [audioEl, speed]);

  useEffect(() => {
    if (!segmentPlaybackRequest || !audioEl || !interview?.audioPath) return;

    const current = segmentPlaybackStateRef.current;
    if (current.activeSegmentId === segmentPlaybackRequest.segmentId) {
      if (current.playing && current.loop === segmentPlaybackRequest.loop) {
        audioEl.pause();
        return;
      }
    }

    pendingSeekRef.current = segmentPlaybackRequest.startSec;
    pendingAutoplayRef.current = true;
    setSegmentPlaybackState((prev) => ({
      ...prev,
      activeSegmentId: segmentPlaybackRequest.segmentId,
      startSec: segmentPlaybackRequest.startSec,
      endSec: segmentPlaybackRequest.endSec,
      loop: segmentPlaybackRequest.loop,
    }));

    void resolveStreamUrl({ preserveTime: false, autoplay: true }).then((nextUrl) => {
      if (!nextUrl) return;
      if (nextUrl === srcRef.current) {
        audioEl.currentTime = segmentPlaybackRequest.startSec;
        void audioEl.play().catch((error) => {
          if (isAbortError(error)) return;
          const message = String((error as { message?: string })?.message ?? error);
          setPlaybackError(message);
        });
      }
    });
  }, [audioEl, interview?.audioPath, resolveStreamUrl, segmentPlaybackRequest, setSegmentPlaybackState]);

  const togglePlay = useCallback(async () => {
    if (!audioEl || !interview?.audioPath) return;
    if (
      segmentPlaybackStateRef.current.activeSegmentId !== null &&
      segmentPlaybackStateRef.current.startSec !== null &&
      audioEl.currentTime >= (segmentPlaybackStateRef.current.endSec ?? Infinity)
    ) {
      audioEl.currentTime = segmentPlaybackStateRef.current.startSec;
    }
    if (!audioEl.paused) {
      audioEl.pause();
      return;
    }
    const nextUrl = await resolveStreamUrl({ preserveTime: true });
    if (!nextUrl) return;
    if (nextUrl !== srcRef.current) {
      pendingAutoplayRef.current = true;
      return;
    }
    try {
      setPlaybackError(null);
      await audioEl.play();
    } catch (error) {
      if (isAbortError(error)) return;
      const message = String((error as { message?: string })?.message ?? error);
      console.error("Interview audio playback failed", {
        interviewId: interview?.id,
        src,
        error,
      });
      setPlaybackError(message);
    }
  }, [audioEl, interview?.audioPath, interview?.id, resolveStreamUrl, src]);

  const seekTo = (target: number) => {
    if (!audioEl) return;
    audioEl.currentTime = Math.max(0, Math.min(target, audioEl.duration || 0));
  };

  const onTimeUpdate = () => {
    if (!audioEl) return;
    const currentTime = audioEl.currentTime;
    setTime(currentTime);
    setSegmentPlaybackState((prev) => ({
      ...prev,
      currentTime,
      duration: audioEl.duration || 0,
    }));
    if (loopSpan && span && currentTime >= span.audioEndSec) {
      audioEl.currentTime = span.audioStartSec;
      return;
    }
    if (
      segmentPlaybackStateRef.current.activeSegmentId !== null &&
      segmentPlaybackStateRef.current.endSec !== null &&
      currentTime >= segmentPlaybackStateRef.current.endSec
    ) {
      if (
        segmentPlaybackStateRef.current.loop &&
        segmentPlaybackStateRef.current.startSec !== null
      ) {
        audioEl.currentTime = segmentPlaybackStateRef.current.startSec;
      } else {
        audioEl.pause();
        audioEl.currentTime = segmentPlaybackStateRef.current.endSec;
        setSegmentPlaybackState((prev) => ({
          ...prev,
          currentTime: prev.endSec ?? currentTime,
          playing: false,
        }));
      }
    }
  };

  useEffect(() => {
    const toggle = () => {
      void togglePlay();
    };
    const loop = () => setLoopSpan((v) => !v);
    window.addEventListener("stt:toggle-play", toggle);
    window.addEventListener("stt:toggle-loop", loop);
    return () => {
      window.removeEventListener("stt:toggle-play", toggle);
      window.removeEventListener("stt:toggle-loop", loop);
    };
  }, [togglePlay]);

  if (!interview?.audioPath) {
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
        disabled={!src}
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
        ref={(el) => {
          audioElRef.current = el;
          setAudioEl(el);
        }}
        src={src ?? undefined}
        onLoadedMetadata={(e) => {
          const el = e.target as HTMLAudioElement;
          setDuration(el.duration);
          setSegmentPlaybackState((prev) => ({
            ...prev,
            duration: el.duration || 0,
          }));
          if (pendingSeekRef.current !== null) {
            el.currentTime = Math.max(0, Math.min(pendingSeekRef.current, el.duration || 0));
            pendingSeekRef.current = null;
          }
        }}
        onCanPlay={() => {
          if (!pendingAutoplayRef.current || !audioEl) return;
          pendingAutoplayRef.current = false;
          void audioEl.play().catch((error) => {
            if (isAbortError(error)) return;
            const message = String((error as { message?: string })?.message ?? error);
            console.error("Interview audio autoplay after stream refresh failed", {
              interviewId: interview.id,
              src,
              error,
            });
            setPlaybackError(message);
          });
        }}
        onPlay={() => {
          setPlaying(true);
          setSegmentPlaybackState((prev) => ({ ...prev, playing: true }));
        }}
        onPause={() => {
          setPlaying(false);
          setSegmentPlaybackState((prev) => ({ ...prev, playing: false }));
        }}
        onTimeUpdate={onTimeUpdate}
        onSeeked={() => {
          if (!audioEl) return;
          const currentTime = audioEl.currentTime;
          setTime(currentTime);
          setSegmentPlaybackState((prev) => {
            if (prev.activeSegmentId === null) return prev;
            if (
              prev.startSec !== null &&
              prev.endSec !== null &&
              currentTime >= prev.startSec &&
              currentTime <= prev.endSec
            ) {
              return { ...prev, currentTime };
            }
            return {
              ...prev,
              activeSegmentId: null,
              startSec: null,
              endSec: null,
              loop: false,
              currentTime,
            };
          });
        }}
        onError={() => {
          const mediaError = audioEl?.error;
          const message = mediaError
            ? `media error ${mediaError.code}`
            : "unknown media error";
          console.error("Interview audio element error", {
            interviewId: interview.id,
            src,
            mediaError,
          });
          setPlaybackError(message);
          if (src && lastRetriedSrcRef.current !== src) {
            lastRetriedSrcRef.current = src;
            void resolveStreamUrl({ preserveTime: true, autoplay: true });
          }
        }}
        preload="metadata"
      />
    </div>
  );
};
