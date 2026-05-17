import { useEffect } from "react";
import { useAtom } from "jotai";
import { settingsGet, settingsSystemAppearance } from "../ipc/settings";
import { globalSettingsAtom, themePreviewAtom } from "../state/settings";
import { applyResolvedTheme, applyTheme } from "../theme";

export const ThemeController = () => {
  const [settings, setSettings] = useAtom(globalSettingsAtom);
  const [previewAppearance] = useAtom(themePreviewAtom);
  const appearance = previewAppearance ?? settings?.appearance ?? "system";

  useEffect(() => {
    if (settings) return;
    let cancelled = false;
    void settingsGet()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => {
        applyTheme("system");
      });
    return () => {
      cancelled = true;
    };
  }, [settings, setSettings]);

  useEffect(() => {
    if (appearance !== "system") {
      applyTheme(appearance);
      return;
    }

    let cancelled = false;

    const sync = async () => {
      try {
        const resolved = await settingsSystemAppearance();
        if (!cancelled) applyResolvedTheme(resolved);
      } catch {
        if (!cancelled) applyTheme("system");
      }
    };

    void sync();
    const interval = window.setInterval(() => {
      void sync();
    }, 2000);
    const onFocus = () => {
      void sync();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [appearance]);

  return null;
};
