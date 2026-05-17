import { useEffect, useRef, useState, type RefObject } from "react";
import styles from "./ActionMenu.module.css";

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type Props = {
  ariaLabel: string;
  items: ActionMenuItem[];
  contextMenuTargetRef?: RefObject<HTMLElement | null>;
};

export const ActionMenu = ({ ariaLabel, items, contextMenuTargetRef }: Props) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const target = contextMenuTargetRef?.current;
    if (!target) return;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setOpen(true);
    };
    target.addEventListener("contextmenu", onContextMenu);
    return () => target.removeEventListener("contextmenu", onContextMenu);
  }, [contextMenuTargetRef]);

  return (
    <div className={styles.wrap} ref={menuRef}>
      <button
        type="button"
        className={styles.button}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`${styles.item} ${item.destructive ? styles.destructive : ""}`.trim()}
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
