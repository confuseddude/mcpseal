const STYLES: Record<string, string> = {
  critical: "text-[var(--color-severity-critical)] border-[var(--color-severity-critical)]/40 bg-[var(--color-severity-critical)]/10",
  high: "text-[var(--color-severity-high)] border-[var(--color-severity-high)]/40 bg-[var(--color-severity-high)]/10",
  medium: "text-[var(--color-severity-medium)] border-[var(--color-severity-medium)]/40 bg-[var(--color-severity-medium)]/10",
  info: "text-[var(--color-severity-info)] border-[var(--color-severity-info)]/40 bg-[var(--color-severity-info)]/10",
  low: "text-[var(--color-severity-low)] border-[var(--color-severity-low)]/40 bg-[var(--color-severity-low)]/10",
};

export function SeverityChip({ severity }: { severity: string }) {
  const cls = STYLES[severity] ?? STYLES.low;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-data uppercase tracking-wide ${cls}`}>
      {severity}
    </span>
  );
}
