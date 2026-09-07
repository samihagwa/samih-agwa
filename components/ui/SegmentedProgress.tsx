import { Check } from "lucide-react";

export type SegmentedProgressStep = {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming" | "blocked";
};

export function SegmentedProgress({
  steps,
  compact = false,
  ariaLabel = "مراحل التقدم",
}: {
  steps: SegmentedProgressStep[];
  compact?: boolean;
  ariaLabel?: string;
}) {
  const completed = steps.filter((step) => step.state === "done").length;

  return (
    <div className={`segmented-progress ${compact ? "compact" : ""}`} aria-label={ariaLabel}>
      <div className="segmented-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed}>
        {steps.map((step) => <span className={step.state} key={step.id} aria-hidden="true" />)}
      </div>
      <ol>
        {steps.map((step) => (
          <li className={step.state} key={step.id}>
            <span className="segmented-progress-mark" aria-hidden="true">{step.state === "done" ? <Check size={11} strokeWidth={3} /> : null}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
