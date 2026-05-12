import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = ({ variant = "secondary", className = "", ...rest }: Props) => (
  <button
    {...rest}
    className={`${styles.btn} ${styles[variant]} ${className}`.trim()}
  />
);
