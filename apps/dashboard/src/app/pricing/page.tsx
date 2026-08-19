import Link from "next/link";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    tagline: "The CLI, forever.",
    features: ["mcpseal init / proxy / scan", "Local rug-pull blocking", "7-day workspace retention if you connect one"],
    cta: { label: "Get started", href: "/login" },
  },
  {
    name: "Team",
    price: "Self-serve",
    tagline: "No sales call. Card in, protected in minutes.",
    features: ["Everything in Free", "Live Feed across your whole fleet", "30-day retention", "Self-serve Stripe Checkout"],
    cta: { label: "Start on Team", href: "/login" },
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    tagline: "Provable compliance at fleet scale.",
    features: ["Everything in Team", "Signed policy push to the whole fleet", "SSO/SCIM", "Tamper-evident audit export", "Unlimited retention"],
    cta: { label: "Contact sales", href: "mailto:sales@mcpseal.dev" },
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <div className="font-data text-sm text-[var(--color-text-faint)]">mcpseal</div>
          <h1 className="mt-2 text-2xl font-medium text-[var(--color-text)]">Pricing</h1>
          <p className="mt-2 text-sm text-[var(--color-text-dim)]">
            The free CLI is the whole product on one machine. The Control Plane is what a single machine structurally
            can&apos;t show you.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-6 ${
                tier.highlight
                  ? "border-[var(--color-severity-info)]/50 bg-[var(--color-surface-raised)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <div className="font-data text-xs uppercase tracking-wide text-[var(--color-text-faint)]">{tier.name}</div>
              <div className="mt-2 text-xl font-medium text-[var(--color-text)]">{tier.price}</div>
              <p className="mt-1 text-sm text-[var(--color-text-dim)]">{tier.tagline}</p>
              <ul className="mt-5 flex flex-col gap-2">
                {tier.features.map((f) => (
                  <li key={f} className="text-sm text-[var(--color-text-dim)]">
                    · {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={`mt-6 block rounded-md px-3 py-2 text-center text-sm font-medium ${
                  tier.highlight ? "bg-[var(--color-text)] text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text)]"
                }`}
              >
                {tier.cta.label}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
