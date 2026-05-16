import type { HTMLAttributes, ReactNode } from "react";
import styles from "./StatusMenu.module.css";

type Props = HTMLAttributes<HTMLDivElement>;

type SectionProps = {
  children: ReactNode;
  className?: string;
};

export const StatusMenu = ({ className = "", ...props }: Props) => (
  <div {...props} className={`${styles.menu} ${className}`.trim()} />
);

export const StatusMenuHeader = ({ children, className = "" }: SectionProps) => (
  <div className={`${styles.header} ${className}`.trim()}>{children}</div>
);

export const StatusMenuFooter = ({ children, className = "" }: SectionProps) => (
  <div className={`${styles.footer} ${className}`.trim()}>{children}</div>
);

export const StatusMenuEmpty = ({ children, className = "" }: SectionProps) => (
  <p className={`${styles.empty} ${className}`.trim()}>{children}</p>
);
