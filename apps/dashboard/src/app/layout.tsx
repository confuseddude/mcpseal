import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mcpseal — Control Plane",
  description: "Cross-agent visibility into blocked MCP tool-poisoning attacks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
