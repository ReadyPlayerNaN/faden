import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./SearchableSelect.module.css";

type Option = {
  value: string;
  label: string;
  searchText?: string;
};

type Props = {
  label?: string;
  helpText?: string;
  value: string;
  options: readonly Option[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  variant?: "default" | "header";
  onChange: (value: string) => void;
};

export const SearchableSelect = ({
  label,
  helpText,
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled = false,
  variant = "default",
  onChange,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<Record<string, string | number>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownStyle(
        variant === "header"
          ? {
              top: rect.bottom + 6,
              left: rect.left,
              minWidth: rect.width,
            }
          : {
              top: rect.bottom + 6,
              left: rect.left,
              width: rect.width,
            },
      );
    };
    updatePosition();
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      (option.searchText ?? `${option.label} ${option.value}`).toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <div className={`${styles.wrap} ${variant === "header" ? styles.wrapHeader : ""}`.trim()} ref={rootRef}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${variant === "header" ? styles.triggerHeader : ""}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className={selected ? styles.value : styles.placeholder}>
          {selected?.label || placeholder || ""}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className={`${styles.dropdown} ${variant === "header" ? styles.dropdownHeader : ""}`.trim()}
            style={dropdownStyle}
          >
            <input
              ref={inputRef}
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
            />
            {filtered.length > 0 ? (
              <ul className={styles.list} role="listbox">
                {filtered.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={`${styles.option} ${variant === "header" ? styles.optionHeader : ""}`.trim()}
                      aria-selected={option.value === value}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>{emptyText}</div>
            )}
          </div>,
          document.body,
        )}
      {helpText ? <span className={styles.help}>{helpText}</span> : null}
    </div>
  );
};