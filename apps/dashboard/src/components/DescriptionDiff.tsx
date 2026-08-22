// The signature element of the Live Feed (see docs/history/NIGHT_SHIFT_LOG.md's design
// note): the old-vs-new tool description IS the product's core mechanism —
// a rug pull is detected exactly because this text changed — so it's shown
// as a real unified diff, not summarized away into a generic "details"
// link. `descriptionDiff` is produced by cli-node's event-log.ts as
// "- <old>\n+ <new>".
export function DescriptionDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="font-data text-[13px] leading-relaxed rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 overflow-x-auto">
      {lines.map((line, i) => {
        const isRemoved = line.startsWith("- ");
        const isAdded = line.startsWith("+ ");
        const color = isRemoved ? "text-[var(--color-severity-high)]" : isAdded ? "text-[var(--color-ok)]" : "text-[var(--color-text-dim)]";
        return (
          <div key={i} className={color}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
