export function StatCard({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: "default" | "warning" }) {
  return <article className={`stat-card stat-${tone}`}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}
