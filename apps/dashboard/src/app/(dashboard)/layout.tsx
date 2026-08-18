"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NavRail } from "@/components/NavRail";
import { api, ApiError, type Me } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setMe(res.user))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="font-data text-sm text-[var(--color-text-faint)]">loading…</span>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="flex h-screen">
      <NavRail />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6">
          <div />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--color-text-dim)]">{me.email}</span>
            <span className="font-data text-xs uppercase text-[var(--color-text-faint)]">{me.role}</span>
            <button
              onClick={() => api.logout().then(() => router.replace("/login"))}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
