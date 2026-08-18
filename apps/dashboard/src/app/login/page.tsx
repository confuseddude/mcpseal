"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.devLogin(email);
      router.replace("/live-feed");
    } catch {
      setError("Couldn't sign you in. Check the address and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-data text-lg text-[var(--color-text)]">mcplock</div>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">Sign in to your workspace</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none focus:border-[var(--color-severity-info)]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--color-text)] px-3 py-2.5 text-sm font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Continue"}
          </button>
          {error && <p className="text-sm text-[var(--color-severity-high)]">{error}</p>}
        </form>
        <p className="mt-6 text-center text-xs text-[var(--color-text-faint)]">
          Dev build: signs you in immediately, standing in for a WorkOS magic-link click. First person from a given
          email domain becomes the workspace owner.
        </p>
      </div>
    </div>
  );
}
