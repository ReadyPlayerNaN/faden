import { useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import styles from "./Modal.module.css";

type ModalSize = "sm" | "md" | "lg";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
}: ModalProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    containerRef.current
      ?.querySelector<HTMLElement>("input, textarea, select, button")
      ?.focus();
  }, [open]);

  if (!open) return null;

  const onBackdropClick = () => {
    if (closeOnBackdrop) onClose();
  };

  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div className={styles.backdrop} onClick={onBackdropClick}>
      <div
        ref={containerRef}
        className={`${styles.card} ${styles[size]}`}
        onClick={onCardClick}
        role="dialog"
        aria-modal="true"
      >
        {title !== undefined && (
          <header className={styles.header}>
            <h2>{title}</h2>
          </header>
        )}
        <div className={styles.body}>{children}</div>
        {footer !== undefined && (
          <footer className={styles.footer}>{footer}</footer>
        )}
      </div>
    </div>
  );
};
