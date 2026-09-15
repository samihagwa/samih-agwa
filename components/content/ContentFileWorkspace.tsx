"use client";
import { ContentWorkspace } from "./ContentWorkspace";

// Task-only participants use the same document without requiring the content section.
export function ContentFileWorkspace({ contentId }: { contentId: string }) {
  return <ContentWorkspace contentId={contentId} backHref="/tasks" />;
}
