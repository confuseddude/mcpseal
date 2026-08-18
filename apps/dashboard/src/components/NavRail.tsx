"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/live-feed", label: "Live Feed" },
  { href: "/fleet", label: "Fleet" },
  { href: "/policy", label: "Policy" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

export function NavRail() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-5">
      <div className="mb-8 px-2">
        <span className="font-data text-sm tracking-tight text-[var(--color-text)]">mcplock</span>
        <span className="ml-1.5 font-data text-[10px] text-[var(--color-text-faint)]">control plane</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border-strong)]"
                  : "text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]/50 border border-transparent"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
