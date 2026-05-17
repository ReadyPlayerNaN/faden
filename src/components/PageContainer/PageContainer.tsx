import type { HTMLAttributes, ReactNode } from "react";
import styles from "./PageContainer.module.css";

type PageContainerSize = "narrow" | "default" | "wide" | "xwide" | "full";

type PageContainerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  size?: PageContainerSize;
};

export const PageContainer = ({
  children,
  className = "",
  size = "default",
  ...rest
}: PageContainerProps) => (
  <div
    {...rest}
    className={className ? `${styles.root} ${className}` : styles.root}
    data-size={size}
  >
    {children}
  </div>
);
