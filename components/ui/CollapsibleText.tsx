"use client";

import { useState } from "react";

type CollapsibleTextProps = {
  text: string;
  maxCharacters?: number;
  className?: string;
};

export function CollapsibleText({ text, maxCharacters = 180, className }: CollapsibleTextProps) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = text.length > maxCharacters;
  const visibleText = canCollapse && !expanded
    ? `${text.slice(0, maxCharacters).trimEnd()}…`
    : text;

  return <div className={`collapsible-text ${className ?? ""}`}>
    <p>{visibleText}</p>
    {canCollapse ? <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      {expanded ? "إظهار أقل" : "إظهار المزيد"}
    </button> : null}
  </div>;
}
