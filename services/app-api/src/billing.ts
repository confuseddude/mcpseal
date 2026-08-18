// build-bible.md Part 10: "Stripe holds subscription truth; mirror status
// into `subscriptions` via webhooks for fast in-app gating. Never gate on a
// stale local copy without webhook reconciliation." The provider interface
// below is the real production shape; MockBillingProvider stands in when no
// Stripe credentials are configured (documented, not hidden — see
// NIGHT_SHIFT_LOG.md).
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { Plan } from "./db.js";

export interface CheckoutResult {
  url: string;
  // Present only in mock mode: lets the caller apply the "checkout" result
  // immediately instead of waiting for a webhook that will never arrive
  // without a real Stripe account.
  mockImmediateOutcome?: { plan: Plan; stripeCustomerId: string; stripeSubId: string };
}

export interface BillingProvider {
  readonly mode: "stripe" | "mock";
  createCheckoutSession(orgId: string, plan: "team", successUrl: string, cancelUrl: string): Promise<CheckoutResult>;
  createPortalSession(stripeCustomerId: string, returnUrl: string): Promise<{ url: string }>;
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent;
}

export type WebhookEvent =
  | { type: "checkout.session.completed"; orgId: string; plan: Plan; stripeCustomerId: string; stripeSubId: string }
  | { type: "customer.subscription.updated"; stripeSubId: string; status: string; plan: Plan }
  | { type: "customer.subscription.deleted"; stripeSubId: string }
  | { type: "invoice.payment_failed"; stripeSubId: string };

export class StripeBillingProvider implements BillingProvider {
  readonly mode = "stripe" as const;
  private stripe: Stripe;
  constructor(private secretKey: string, private webhookSecret: string, private priceIdByPlan: Record<"team", string>) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckoutSession(orgId: string, plan: "team", successUrl: string, cancelUrl: string): Promise<CheckoutResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: this.priceIdByPlan[plan], quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: orgId,
      metadata: { orgId, plan },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  }

  async createPortalSession(stripeCustomerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: returnUrl });
    return { url: session.url };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent {
    if (!signature) throw new Error("missing stripe-signature header");
    // constructEvent throws on any signature mismatch — fail closed, never
    // apply an unverified webhook body (build-bible Part 9).
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return mapStripeEvent(event);
  }
}

function mapStripeEvent(event: Stripe.Event): WebhookEvent {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.client_reference_id;
      const plan = (session.metadata?.plan as Plan) ?? "team";
      if (!orgId) throw new Error("checkout.session.completed missing client_reference_id");
      return {
        type: "checkout.session.completed",
        orgId,
        plan,
        stripeCustomerId: String(session.customer),
        stripeSubId: String(session.subscription),
      };
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      return { type: "customer.subscription.updated", stripeSubId: sub.id, status: sub.status, plan: "team" };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return { type: "customer.subscription.deleted", stripeSubId: sub.id };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return { type: "invoice.payment_failed", stripeSubId: String((invoice as unknown as { subscription?: string }).subscription) };
    }
    default:
      throw new Error(`unhandled Stripe event type: ${event.type}`);
  }
}

// MOCK: no real Stripe account. "Checkout" simulates an immediate
// successful subscription instead of a real hosted-checkout redirect —
// the caller applies mockImmediateOutcome directly rather than waiting for
// a webhook Stripe will never send. Webhook verification accepts a
// deterministic dev signature scheme so tests can exercise the exact same
// webhook-application code path the real Stripe integration uses.
export class MockBillingProvider implements BillingProvider {
  readonly mode = "mock" as const;
  static readonly DEV_SIGNATURE_PREFIX = "mock-dev-signature:";

  async createCheckoutSession(orgId: string, plan: "team", successUrl: string): Promise<CheckoutResult> {
    return {
      url: `${successUrl}?mock_checkout=1`,
      mockImmediateOutcome: { plan, stripeCustomerId: `mock_cus_${randomUUID()}`, stripeSubId: `mock_sub_${randomUUID()}` },
    };
  }

  async createPortalSession(_stripeCustomerId: string, returnUrl: string): Promise<{ url: string }> {
    return { url: `${returnUrl}?mock_portal=1` };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent {
    if (!signature || !signature.startsWith(MockBillingProvider.DEV_SIGNATURE_PREFIX)) {
      throw new Error("missing or invalid mock dev signature");
    }
    // Dev signature is just an HMAC-shaped marker over the body length —
    // enough to prove "this test constructed the event deliberately", not
    // cryptographic security (there's nothing to protect in mock mode: no
    // real money or real Stripe account is involved).
    const expected = MockBillingProvider.DEV_SIGNATURE_PREFIX + rawBody.length;
    if (signature !== expected) throw new Error("mock signature does not match body");
    return JSON.parse(rawBody) as WebhookEvent;
  }

  static signMockBody(rawBody: string): string {
    return MockBillingProvider.DEV_SIGNATURE_PREFIX + rawBody.length;
  }
}

export function buildBillingProvider(): BillingProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID;
  if (secretKey && webhookSecret && teamPriceId) {
    return new StripeBillingProvider(secretKey, webhookSecret, { team: teamPriceId });
  }
  return new MockBillingProvider();
}
