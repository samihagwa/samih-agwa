import type { ReactNode } from "react";

const marks = { neutral: "•", info: "i", success: "✓", warning: "!", danger: "×" } as const;

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof marks }) {
  return <span className={`status-badge status-${tone}`}><span aria-hidden="true">{marks[tone]}</span>{children}</span>;
}
