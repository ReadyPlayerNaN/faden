import type { InputHTMLAttributes } from "react";
import styles from "./TextField.module.css";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helpText?: string;
};

export const TextField = ({
  label,
  helpText,
  className = "",
  id,
  ...rest
}: Props) => (
  <label className={styles.wrap}>
    {label ? <span className={styles.label}>{label}</span> : null}
    <input
      {...rest}
      id={id}
      className={`${styles.input} ${className}`.trim()}
    />
    {helpText ? <span className={styles.help}>{helpText}</span> : null}
  </label>
);
