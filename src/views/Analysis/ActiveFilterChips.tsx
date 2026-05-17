import { useTranslation } from "react-i18next";
import styles from "./ActiveFilterChips.module.css";

type ActiveFilterChipItem = {
  key: string;
  label: string;
  onClear: () => void;
};

type Props = {
  items: ActiveFilterChipItem[];
};

export const ActiveFilterChips = ({ items }: Props) => {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>
        {t("analysis.filters.activeScope", { defaultValue: "Active scope" })}
      </span>
      <div className={styles.list}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={styles.chip}
            onClick={item.onClear}
            aria-label={t("analysis.filters.clearFilter", {
              label: item.label,
              defaultValue: "Clear filter {{label}}",
            })}
            title={t("analysis.filters.clearFilter", {
              label: item.label,
              defaultValue: "Clear filter {{label}}",
            })}
          >
            <span>{item.label}</span>
            <span className={styles.clearMark} aria-hidden="true">
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
