import type {ChargeType, MatchTier, SettlementStatus, Severity} from '@magic/contracts';

/**
 * The snapshot is the rule engine's entire world. It is assembled once, frozen, and handed to
 * every rule. Rules cannot query, cannot enqueue, and cannot read the clock — which is precisely
 * what makes the double-run determinism test a check rather than a hope.
 */
export interface AccountState {
    readonly stripeAccountId: string;
    readonly displayName: string | null;
    readonly chargesEnabled: boolean;
    readonly payoutsEnabled: boolean;
    readonly requirementsDisabledReason: string | null;
    readonly defaultCurrency: string | null;
}

export interface PayoutSnapshot {
    readonly id: string;
    readonly stripeAccountId: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly status: string;
    readonly arrivalDate: string | null;
    readonly createdAt: string;
    readonly balanceTransactionId: string | null;
}

export interface BalanceTxnSnapshot {
    readonly id: string;
    readonly stripeAccountId: string;
    readonly type: string;
    readonly sourceId: string | null;
    readonly grossMinor: bigint;
    readonly feeMinor: bigint;
    readonly netMinor: bigint;
    readonly currency: string;
    readonly payoutId: string | null;
    readonly createdAt: string;
}

export interface ChargeSnapshot {
    readonly id: string;
    readonly stripeAccountId: string;
    readonly paymentIntentId: string | null;
    readonly balanceTransactionId: string | null;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly amountRefundedMinor: bigint;
    readonly amountCapturedMinor: bigint;
    readonly status: string;
    readonly paid: boolean;
    readonly refunded: boolean;
    readonly disputed: boolean;
    readonly captured: boolean;
    readonly onBehalfOf: string | null;
    readonly transferDestination: string | null;
    readonly transferDataAmountMinor: bigint | null;
    readonly transferId: string | null;
    readonly applicationFeeId: string | null;
    readonly sourceTransferId: string | null;
    readonly chargeType: ChargeType;
    readonly chargeTypeConfidence: number;
    readonly customerEmail: string | null;
    readonly metadata: Readonly<Record<string, string>>;
    readonly createdAt: string;
}

export interface RefundSnapshot {
    readonly id: string;
    readonly chargeId: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly status: string;
    readonly reason: string | null;
    readonly transferReversalId: string | null;
    readonly createdAt: string;
}

export interface TransferSnapshot {
    readonly id: string;
    readonly destinationAccountId: string;
    readonly amountMinor: bigint;
    readonly amountReversedMinor: bigint;
    readonly currency: string;
    readonly sourceTransaction: string | null;
    readonly createdAt: string;
}

export interface ReversalSnapshot {
    readonly id: string;
    readonly transferId: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly createdAt: string;
}

export interface AppFeeSnapshot {
    readonly id: string;
    readonly chargeId: string;
    readonly originatingAccountId: string;
    readonly amountMinor: bigint;
    readonly amountRefundedMinor: bigint;
    readonly currency: string;
    readonly refunded: boolean;
    readonly createdAt: string;
}

export interface DisputeSnapshot {
    readonly id: string;
    readonly chargeId: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly status: string;
    readonly reason: string | null;
    readonly createdAt: string;
}

export interface SettlementSnapshot {
    readonly chargeId: string;
    readonly chargeType: ChargeType;
    readonly fundsHolderAccountId: string;
    readonly merchantAccountId: string;
    readonly currency: string;
    readonly customerGrossMinor: bigint;
    readonly processingFeeMinor: bigint;
    readonly platformRevenueMinor: bigint;
    readonly merchantNetMinor: bigint;
    readonly refundedMinor: bigint;
    readonly reversedToPlatformMinor: bigint;
    readonly settlementStatus: SettlementStatus;
    readonly payoutId: string | null;
    readonly chargedAt: string;
}

export interface OrderSnapshot {
    readonly id: string;
    readonly externalOrderId: string;
    readonly merchantAccountId: string | null;
    readonly totalMinor: bigint;
    readonly currency: string;
    readonly expectedPlatformFeeMinor: bigint | null;
    readonly status: string;
    readonly fulfillmentStatus: string | null;
    readonly customerEmail: string | null;
    readonly paymentIntentId: string | null;
    readonly placedAt: string;
    readonly fulfilledAt: string | null;
    readonly cancelledAt: string | null;
}

export interface MatchSnapshot {
    readonly settlementChargeId: string;
    readonly orderId: string | null;
    readonly tier: MatchTier;
    readonly confidence: number;
    readonly method: string;
}

export interface ReconSnapshot {
    readonly asOf: string;
    readonly tenantId: string;
    readonly stripeAccountId: string;
    readonly platformAccountId: string;
    readonly scopeKey: string;
    readonly scopeType: 'payout' | 'window' | 'platform';
    readonly mode: 'transactional' | 'aggregate';
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly accountState: AccountState;
    readonly payout: PayoutSnapshot | null;
    readonly balanceTransactions: readonly BalanceTxnSnapshot[];
    readonly charges: readonly ChargeSnapshot[];
    readonly refunds: readonly RefundSnapshot[];
    readonly transfers: readonly TransferSnapshot[];
    readonly reversals: readonly ReversalSnapshot[];
    readonly applicationFees: readonly AppFeeSnapshot[];
    readonly disputes: readonly DisputeSnapshot[];
    readonly settlements: readonly SettlementSnapshot[];
    readonly orders: readonly OrderSnapshot[];
    readonly matches: readonly MatchSnapshot[];
    readonly checksum: string;
}

/**
 * A posting is one side of an expected money movement. Each charge-type mapper emits the
 * postings it believes should exist; a single shared comparator checks them against the actual
 * balance transactions, which is what keeps the charge-type fork inside Layer 2.
 */
export type PostingKind =
    | 'customer_gross'
    | 'processing_fee'
    | 'application_fee'
    | 'transfer_to_merchant'
    | 'merchant_net'
    | 'refund'
    | 'transfer_reversal';

export interface ExpectedPosting {
    readonly kind: PostingKind;
    readonly accountId: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly sourceId: string;
    readonly toleranceMinor: bigint;
    readonly required: boolean;
}

export interface LedgerContext {
    readonly platformAccountId: string;
    readonly balanceTransactions: readonly BalanceTxnSnapshot[];
    readonly applicationFees: readonly AppFeeSnapshot[];
    readonly transfers: readonly TransferSnapshot[];
    readonly refunds: readonly RefundSnapshot[];
    readonly reversals: readonly ReversalSnapshot[];
    readonly takeRateBasisPoints: number;
}

export interface Finding {
    readonly ruleId: string;
    readonly subjectType: 'charge' | 'payout' | 'transfer' | 'order' | 'account' | 'settlement' | 'window';
    readonly subjectId: string;
    readonly severity: Severity;
    readonly exposureMinor: bigint | null;
    readonly currency: string | null;
    readonly expected: Readonly<Record<string, unknown>>;
    readonly actual: Readonly<Record<string, unknown>>;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly narrative: string;
}
