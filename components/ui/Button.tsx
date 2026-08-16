import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ children, href, variant = "primary", className = "", ...buttonProps }: Props) {
  const classes = `button button-${variant} ${className}`.trim();
  if (href) return <Link href={href} className={classes}>{children}</Link>;
  return <button {...buttonProps} className={classes}>{children}</button>;
}
