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
      className={`gp-icon-button${icon === "RefreshCw" ? " gp-icon-refresh" : ""} ${className}`}
      disabled={disabled || busy}
      aria-label={description}
      aria-busy={busy || undefined}
      data-tooltip={description}
    >
      {icon === "RefreshCw" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={busy ? "gp-icon-glyph gp-icon-spin" : "gp-icon-glyph"}
          aria-hidden="true"
          data-utility-icon="refresh"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      ) : (
        <Icon
          name={icon}
          className="gp-icon-glyph"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
