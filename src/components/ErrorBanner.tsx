import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import styles from "./ErrorBanner.module.css";

type Props = {
  message: string;
  onDismiss?: () => void;
};

export const ErrorBanner = ({ message, onDismiss }: Props) => {
  const { t } = useTranslation();

  useEffect(() => {
    console.error("UI error:", message);
  }, [message]);

  const localize = (m: string): string => {
    const commandNotFoundMatch = m.match(/command\s+([\w:.-]+)\s+not\s+found/i);
    if (commandNotFoundMatch) {
      return t("errors.commandUnavailable", {
        command: commandNotFoundMatch[1],
        defaultValue: `Command unavailable: ${commandNotFoundMatch[1]}. Restart the app.`,
      });
    }

    if (m.includes("Conflict") || m.includes("already exists")) {
      return t("errors.conflict");
    }
    if (m.includes("not found") || m.includes("NotFound")) {
      return `${t("errors.notFound")}: ${m}`;
    }
    if (m.includes("Invalid") || m.includes("invalid")) {
      return `${t("errors.invalid")}: ${m}`;
    }
    if (m.includes("network") || m.includes("Network")) {
      return t("errors.networkFailed");
    }
    return m;
  };

  return (
    <div className={styles.banner} role="alert">
      <span>{localize(message)}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={styles.close}
          aria-label={t("common.dismiss")}
        >
          ×
        </button>
      )}
    </div>
  );
};
