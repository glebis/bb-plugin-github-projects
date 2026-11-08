import type { ButtonHTMLAttributes } from "react";
import { Icon } from "../../components/ui/icon";

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  label: string;
  icon: string;
  busy?: boolean;
  busyLabel?: string;
};

export function IconButton({
  label,
  icon,
  busy = false,
  busyLabel,
  className = "",
  disabled,
  type = "button",
  ...props
}: IconButtonProps) {
  const description = busy && busyLabel ? busyLabel : label;
  return (
    <button
      {...props}
      type={type}
      className={`gp-icon-button ${className}`}
      disabled={disabled || busy}
      aria-label={description}
      aria-busy={busy || undefined}
      data-tooltip={description}
    >
      <Icon
        name={icon}
        className={busy ? "gp-icon-glyph gp-icon-spin" : "gp-icon-glyph"}
        aria-hidden="true"
      />
    </button>
  );
}
