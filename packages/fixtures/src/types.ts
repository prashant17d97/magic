export interface FixtureAccount {
  readonly stripeAccountId: string;
  readonly displayName: string;
  readonly country: string;
  readonly currency: string;
  readonly accountType: 'standard' | 'express' | 'custom';
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDisabledReason: string | null;
}

export interface FixtureCharge {
  readonly id: string;
  readonly accountId: string;
  readonly paymentIntentId: string | null;
  readonly balanceTransactionId: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly refundedMinor?: bigint;
  readonly status?: string;
  readonly onBehalfOf?: string | null;
  readonly transferDestination?: string | null;
  readonly transferDataAmountMinor?: bigint | null;
  readonly transferId?: string | null;
  readonly applicationFeeId?: string | null;
  readonly sourceTransferId?: string | null;
  readonly customerEmail?: string | null;
  readonly metadata?: Record<string, string>;
  readonly createdAt: string;
}

export interface FixtureBalanceTxn {
  readonly id: string;
  readonly accountId: string;
  readonly type: string;
  readonly sourceId: string | null;
  readonly grossMinor: bigint;
  readonly feeMinor: bigint;
  readonly netMinor: bigint;
  readonly currency: string;
  readonly payoutId: string | null;
  readonly createdAt: string;
}

export interface FixturePayout {
  readonly id: string;
  readonly accountId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly arrivalDate: string;
  readonly createdAt: string;
}

export interface FixtureRefund {
  readonly id: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status?: string;
  readonly reason?: string | null;
  readonly transferReversalId?: string | null;
  readonly createdAt: string;
}

export interface FixtureTransfer {
  readonly id: string;
  readonly destinationAccountId: string;
  readonly amountMinor: bigint;
  readonly reversedMinor?: bigint;
  readonly currency: string;
  readonly sourceTransaction: string | null;
  readonly createdAt: string;
}

export interface FixtureReversal {
  readonly id: string;
  readonly transferId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly createdAt: string;
}

export interface FixtureAppFee {
  readonly id: string;
  readonly chargeId: string;
  readonly originatingAccountId: string;
  readonly amountMinor: bigint;
  readonly refundedMinor?: bigint;
  readonly currency: string;
  readonly createdAt: string;
}

export interface FixtureDispute {
  readonly id: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface FixtureOrder {
  readonly externalOrderId: string;
  readonly merchantAccountId: string | null;
  readonly totalMinor: bigint;
  readonly currency: string;
  readonly expectedPlatformFeeMinor: bigint | null;
  readonly status: 'created' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
  readonly fulfillmentStatus: 'unfulfilled' | 'partial' | 'fulfilled' | 'returned' | null;
  readonly customerEmail: string | null;
  readonly paymentIntentId: string | null;
  readonly placedAt: string;
  readonly fulfilledAt: string | null;
  readonly cancelledAt: string | null;
}

/**
 * A scenario is a sequence of Stripe objects plus the exceptions a correct system must raise
 * from them. Because it declares its own expectation, the corpus doubles as a specification:
 * a rule change that silently stops catching something fails the fixture that named it.
 */
export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly exercises: string;
  readonly accounts: readonly FixtureAccount[];
  readonly charges: readonly FixtureCharge[];
  readonly balanceTransactions: readonly FixtureBalanceTxn[];
  readonly payouts: readonly FixturePayout[];
  readonly refunds: readonly FixtureRefund[];
  readonly transfers: readonly FixtureTransfer[];
  readonly reversals: readonly FixtureReversal[];
  readonly applicationFees: readonly FixtureAppFee[];
  readonly disputes: readonly FixtureDispute[];
  readonly orders: readonly FixtureOrder[];
  readonly mode: 'transactional' | 'aggregate';
  readonly runAccountId: string;
  readonly runPayoutId: string | null;
  readonly expectedRuleIds: readonly string[];
}
