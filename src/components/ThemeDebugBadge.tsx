import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { globalSettingsAtom, themePreviewAtom } from "../state/settings";
import { settingsSystemAppearance } from "../ipc/settings";
import styles from "./ThemeDebugBadge.module.css";

const readSnapshot = () => {
  const root = document.documentElement;
  const media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  return {
    dataTheme: root.getAttribute("data-theme") ?? "<none>",
    colorScheme: getComputedStyle(root).colorScheme || "<empty>",
    prefersDark: media ? String(media.matches) : "unsupported",
  };
};

export const ThemeDebugBadge = () => {
  const settings = useAtomValue(globalSettingsAtom);
  const preview = useAtomValue(themePreviewAtom);
  const [snapshot, setSnapshot] = useState(() => readSnapshot());
  const [backendSystem, setBackendSystem] = useState<string>("<pending>");

  useEffect(() => {
    const refresh = () => {
      setSnapshot(readSnapshot());
      void settingsSystemAppearance()
        .then((value) => setBackendSystem(value))
        .catch(() => setBackendSystem("<error>"));
    };
    refresh();

    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

    if (media) {
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", refresh);
      } else {
        media.addListener(refresh);
      }
    }

    window.addEventListener("focus", refresh);

    return () => {
      if (media) {
        if (typeof media.addEventListener === "function") {
          media.removeEventListener("change", refresh);
        } else {
          media.removeListener(refresh);
        }
      }
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    setSnapshot(readSnapshot());
  }, [settings?.appearance, preview]);

  return (
    <div className={styles.badge}>
      <div><strong>theme</strong></div>
      <div>saved: {settings?.appearance ?? "<unset>"}</div>
      <div>preview: {preview ?? "<none>"}</div>
      <div>data-theme: {snapshot.dataTheme}</div>
      <div>css color-scheme: {snapshot.colorScheme}</div>
      <div>prefers dark: {snapshot.prefersDark}</div>
      <div>backend system: {backendSystem}</div>
    </div>
  );
};
