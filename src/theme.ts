import type { AppearanceMode } from "./ipc/settings";

export const applyTheme = (appearance: AppearanceMode) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  if (appearance === "system") {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
    return;
  }

  root.setAttribute("data-theme", appearance);
  root.style.colorScheme = appearance;
};

export const applyResolvedTheme = (appearance: Extract<AppearanceMode, "light" | "dark">) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", appearance);
  root.style.colorScheme = appearance;
};
