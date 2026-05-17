import { type ReactNode } from "react";
import styles from "./ViewModeIcon.module.css";

export type ViewMode = "coding" | "interviews" | "labels" | "people" | "analysis" | "export";

type ViewModeIconProps = {
  view: ViewMode;
  className?: string;
};

type ViewModeLabelProps = {
  view: ViewMode;
  children: ReactNode;
  className?: string;
};

const join = (...names: Array<string | undefined>) => names.filter(Boolean).join(" ");

export const ViewModeIcon = ({ view, className }: ViewModeIconProps) => {
  switch (view) {
    case "interviews":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9l-4 4v-4H7a3 3 0 0 1-3-3z" />
        </svg>
      );
    case "coding":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="m8 9-4 3 4 3" />
          <path d="m16 9 4 3-4 3" />
          <path d="m14 4-4 16" />
        </svg>
      );
    case "labels":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="M20 10 10 20l-6-6V4h10z" />
          <circle cx="14.5" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
          <path d="M12 6h6a2 2 0 0 1 2 2v6" />
        </svg>
      );
    case "people":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="M16 20a4 4 0 0 0-8 0" />
          <circle cx="12" cy="10" r="3" />
          <path d="M22 20a4 4 0 0 0-3-3.87" />
          <path d="M18 7.13A3 3 0 0 1 18 13" />
          <path d="M2 20a4 4 0 0 1 3-3.87" />
          <path d="M6 7.13A3 3 0 0 0 6 13" />
        </svg>
      );
    case "analysis":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20v-4" />
        </svg>
      );
    case "export":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={join(styles.icon, className)} aria-hidden="true">
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M4 20h16" />
        </svg>
      );
  }
};

export const ViewModeLabel = ({ view, children, className }: ViewModeLabelProps) => (
  <span className={join(styles.label, className)}>
    <ViewModeIcon view={view} />
    <span>{children}</span>
  </span>
);
