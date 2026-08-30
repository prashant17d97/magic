import Stripe from 'stripe';
import type { SecretsProvider } from './secrets.js';
import { RateLimitedError, type TokenBucketLimiter } from './rate-limiter.js';

export interface StripeClientOptions {
  readonly secrets: SecretsProvider;
  readonly limiter: TokenBucketLimiter;
  readonly apiVersion: string;
  readonly capacity?: number;
  readonly refillPerSecond?: number;
}

export interface AccountContext {
  readonly apiKeyRef: string;
  readonly platformAccountId: string;
  readonly connectedAccountId?: string;
}

/**
 * The API version is pinned in code, never taken from the account default. A dashboard toggle
 * that silently changes the shape of every response is not a change anyone wants to discover
 * through a wrong settlement figure.
 *
 * `maxNetworkRetries` is zero on purpose: retry policy belongs to BullMQ, and two independent
 * retry loops multiply into a burst that trips the rate limit they were meant to survive.
 */
export class StripeClientFactory {
  private readonly options: StripeClientOptions;
  private readonly clients = new Map<string, Stripe>();

  constructor(options: StripeClientOptions) {
    this.options = options;
  }

  async forAccount(context: AccountContext): Promise<StripeAccountClient> {
    const cached = this.clients.get(context.apiKeyRef);
    const client =
      cached ??
      new Stripe(await this.options.secrets.get(context.apiKeyRef), {
        apiVersion: this.options.apiVersion as Stripe.LatestApiVersion,
        maxNetworkRetries: 0,
        timeout: 20_000,
        telemetry: false,
      });

    if (!cached) this.clients.set(context.apiKeyRef, client);

    return new StripeAccountClient(
      client,
      context.connectedAccountId ?? context.platformAccountId,
      context.connectedAccountId,
      this.options.limiter,
      {
        capacity: this.options.capacity ?? 80,
        refillPerSecond: this.options.refillPerSecond ?? 80,
      },
    );
  }
}

/**
 * A client already bound to one account. Every call spends a token from that account's bucket
 * before it leaves the process, so the limiter cannot be bypassed by forgetting to call it.
 */
export class StripeAccountClient {
  private readonly stripe: Stripe;
  private readonly accountId: string;
  private readonly connectedAccountId: string | undefined;
  private readonly limiter: TokenBucketLimiter;
  private readonly bucket: { capacity: number; refillPerSecond: number };

  constructor(
    stripe: Stripe,
    accountId: string,
    connectedAccountId: string | undefined,
    limiter: TokenBucketLimiter,
    bucket: { capacity: number; refillPerSecond: number },
  ) {
    this.stripe = stripe;
    this.accountId = accountId;
    this.connectedAccountId = connectedAccountId;
    this.limiter = limiter;
    this.bucket = bucket;
  }

  private requestOptions(): Stripe.RequestOptions {
    return this.connectedAccountId ? { stripeAccount: this.connectedAccountId } : {};
  }

  private async spend(cost = 1): Promise<void> {
    await this.limiter.acquireOrThrow(`stripe:${this.accountId}`, this.bucket, cost);
  }

  async retrieveCharge(id: string): Promise<Stripe.Charge> {
    await this.spend();
    return this.stripe.charges.retrieve(id, { expand: ['balance_transaction'] }, this.requestOptions());
  }

  async retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    await this.spend();
    return this.stripe.paymentIntents.retrieve(id, {}, this.requestOptions());
  }

  async retrieveRefund(id: string): Promise<Stripe.Refund> {
    await this.spend();
    return this.stripe.refunds.retrieve(id, {}, this.requestOptions());
  }

  async retrieveTransfer(id: string): Promise<Stripe.Transfer> {
    await this.spend();
    return this.stripe.transfers.retrieve(id, {}, this.requestOptions());
  }

  async retrievePayout(id: string): Promise<Stripe.Payout> {
    await this.spend();
    return this.stripe.payouts.retrieve(id, {}, this.requestOptions());
  }

  async retrieveDispute(id: string): Promise<Stripe.Dispute> {
    await this.spend();
    return this.stripe.disputes.retrieve(id, {}, this.requestOptions());
  }

  async retrieveApplicationFee(id: string): Promise<Stripe.ApplicationFee> {
    await this.spend();
    return this.stripe.applicationFees.retrieve(id, {}, this.requestOptions());
  }

  async retrieveAccount(id: string): Promise<Stripe.Account> {
    await this.spend();
    return this.stripe.accounts.retrieve(id);
  }

  async listBalanceTransactions(params: Stripe.BalanceTransactionListParams): Promise<Stripe.ApiList<Stripe.BalanceTransaction>> {
    await this.spend();
    return this.stripe.balanceTransactions.list(params, this.requestOptions());
  }

  /** Cursor-based walk used by the sweeper. Resumable from `startingAfter` after any failure. */
  async listEvents(params: Stripe.EventListParams): Promise<Stripe.ApiList<Stripe.Event>> {
    await this.spend();
    return this.stripe.events.list(params, this.requestOptions());
  }

  async countObjects(
    kind: 'charges' | 'payouts' | 'transfers' | 'refunds',
    created: { gte: number; lt: number },
  ): Promise<number> {
    await this.spend();
    let total = 0;
    let startingAfter: string | undefined;

    for (;;) {
      const page = await this.stripe[kind].list(
        { created, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) } as never,
        this.requestOptions(),
      );
      total += page.data.length;
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1]?.id;
      if (!startingAfter) break;
      await this.spend();
    }

    return total;
  }
}

export { RateLimitedError };
