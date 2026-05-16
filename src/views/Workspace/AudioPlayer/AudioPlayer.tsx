import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectedInterviewAtom } from "../../../state/interview";
import {
  segmentPlaybackRequestAtom,
  segmentPlaybackStateAtom,
} from "../../../state/audio";
import { interviewAudioStreamUrl } from "../../../ipc/interview";
import { Button } from "../../../components/Button/Button";
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

const isAbortedMediaError = (error: MediaError | null | undefined): boolean =>
  error?.code === 1;

export const AudioPlayer = () => {
  const { t } = useTranslation();
  const interview = useAtomValue(selectedInterviewAtom);
  const segmentPlaybackRequest = useAtomValue(segmentPlaybackRequestAtom);
  const setSegmentPlaybackRequest = useSetAtom(segmentPlaybackRequestAtom);
  const [segmentPlaybackState, setSegmentPlaybackState] = useAtom(
    segmentPlaybackStateAtom,
  );
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
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const segmentPlaybackStateRef = useRef(segmentPlaybackState);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);

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
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setSrc(null);
    setPlaybackError(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setSegmentPlaybackRequest(null);
    setSegmentPlaybackState({
      activeSegmentId: null,
      startSec: null,
      endSec: null,
      loop: false,
      loopBySegmentId: {},
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
  }, [interview?.audioPath, interview?.id, resolveStreamUrl, setSegmentPlaybackRequest, setSegmentPlaybackState]);

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
    if (
      !segmentPlaybackRequest ||
      !audioEl ||
      !interview?.audioPath ||
      segmentPlaybackRequest.interviewId !== interview.id
    ) {
      return;
    }

    const current = segmentPlaybackStateRef.current;

    setSegmentPlaybackState((prev) => ({
      ...prev,
      loopBySegmentId: {
        ...prev.loopBySegmentId,
        [segmentPlaybackRequest.segmentId]: segmentPlaybackRequest.loop,
      },
    }));

    if (segmentPlaybackRequest.action === "set-loop") {
      if (current.activeSegmentId === segmentPlaybackRequest.segmentId) {
        setSegmentPlaybackState((prev) => ({ ...prev, loop: segmentPlaybackRequest.loop }));
      }
      return;
    }

    if (segmentPlaybackRequest.action === "pause") {
      if (current.activeSegmentId === segmentPlaybackRequest.segmentId) {
        audioEl.pause();
      }
      return;
    }

    if (current.activeSegmentId === segmentPlaybackRequest.segmentId) {
      const isWithinActiveSegment =
        current.startSec !== null &&
        current.endSec !== null &&
        audioEl.currentTime >= current.startSec &&
        audioEl.currentTime < current.endSec;

      setSegmentPlaybackState((prev) => ({ ...prev, loop: segmentPlaybackRequest.loop }));

      if (!current.playing && isWithinActiveSegment) {
        setPlaybackError(null);
        void audioEl.play().catch((error) => {
          if (isAbortError(error)) return;
          const message = String((error as { message?: string })?.message ?? error);
          setPlaybackError(message);
        });
        return;
      }
    }

    setSegmentPlaybackState((prev) => ({
      ...prev,
      activeSegmentId: segmentPlaybackRequest.segmentId,
      startSec: segmentPlaybackRequest.startSec,
      endSec: segmentPlaybackRequest.endSec,
      loop: segmentPlaybackRequest.loop,
      currentTime: segmentPlaybackRequest.startSec,
      playing: false,
    }));

    pendingSeekRef.current = segmentPlaybackRequest.startSec;
    pendingAutoplayRef.current = true;
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
    pendingAutoplayRef.current = false;
    pendingSeekRef.current = null;
    setSegmentPlaybackRequest(null);
    setSegmentPlaybackState((prev) => ({
      ...prev,
      activeSegmentId: null,
      startSec: null,
      endSec: null,
      loop: false,
      currentTime: Math.max(0, Math.min(target, audioEl.duration || 0)),
      playing: false,
    }));
    audioEl.currentTime = Math.max(0, Math.min(target, audioEl.duration || 0));
    setPlaybackError(null);
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
    window.addEventListener("faden:toggle-play", toggle);
    return () => {
      window.removeEventListener("faden:toggle-play", toggle);
    };
  }, [togglePlay]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!speedMenuRef.current) return;
      if (!speedMenuRef.current.contains(event.target as Node)) {
        setSpeedMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSpeedMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [speedMenuOpen]);

  if (!interview?.audioPath) {
    return (
      <div className={styles.bar}>
        <div className={styles.audioPanel}>
          <span className={styles.empty}>{t("workspace.audioFilter")}</span>
        </div>
        <div className={styles.statusArea}>
          <AiMenu />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <div className={styles.audioPanel}>
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
        <div className={styles.menuRoot} ref={speedMenuRef}>
          <Button
            type="button"
            className={styles.menuTrigger}
            onClick={() => setSpeedMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={speedMenuOpen}
          >
            {speed.toFixed(2)}× ▾
          </Button>
          {speedMenuOpen && (
            <div className={styles.menu} role="menu">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={speed === option}
                  className={styles.menuItem}
                  onClick={() => {
                    setSpeed(option);
                    setSpeedMenuOpen(false);
                  }}
                >
                  {option.toFixed(2)}×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.statusArea}>
        {playbackError && (
          <span className={styles.error} title={playbackError}>
            Audio failed: {playbackError}
          </span>
        )}
        <AiMenu />
      </div>
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
          if (isAbortedMediaError(mediaError)) {
            setPlaybackError(null);
            return;
          }
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
