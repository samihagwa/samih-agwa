import { Fragment } from "react";
import { safeWebLink } from "../../lib/content-presentation";

// Render the saved document as text, never HTML. Links/bold are presentation only.
export function RequestText({ text }: { text: string }) {
  const tokens = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*\*[^*]+\*\*)/g);
  return <div className="request-prose">{tokens.map((part, index) => {
    const markdown = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (markdown) {
      const href = safeWebLink(markdown[2]);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{markdown[1]}</a> : <Fragment key={index}>{part}</Fragment>;
    }
    if (/^https?:\/\//.test(part)) {
      const clean = part.replace(/[.,،؛!؟)\]\\]+$/, "");
      const href = safeWebLink(clean);
      if (href) return <Fragment key={index}><a href={href} target="_blank" rel="noopener noreferrer">{clean}</a>{part.slice(clean.length)}</Fragment>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</div>;
}
