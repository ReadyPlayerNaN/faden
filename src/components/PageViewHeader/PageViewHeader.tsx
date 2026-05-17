import type { ReactNode } from "react";
import { ViewModeLabel, type ViewMode } from "../ViewModeIcon/ViewModeIcon";
import styles from "./PageViewHeader.module.css";

type PageViewHeaderProps = {
  view: ViewMode;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  className?: string;
};

const join = (...names: Array<string | undefined>) => names.filter(Boolean).join(" ");

export const PageViewHeader = ({
  view,
  title,
  subtitle,
  aside,
  className,
}: PageViewHeaderProps) => (
  <header className={join(styles.root, className)}>
    <div className={styles.content}>
      <h1 className={styles.title}>
        <ViewModeLabel view={view}>{title}</ViewModeLabel>
      </h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
    {aside ? <div className={styles.aside}>{aside}</div> : null}
  </header>
);
