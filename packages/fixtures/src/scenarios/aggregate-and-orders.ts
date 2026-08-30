import type { Scenario } from '../types.js';
import { ACME, BRIGHTSIDE, EMPTY, MERIDIAN, PLATFORM_ACCOUNT, USD, daysBefore } from './index.js';

/**
 * Separate charges and transfers with no `source_transaction`. Per-charge matching is
 * structurally impossible here, so aggregate mode is the only correct check that exists — which
 * is why it is built as a first-class path rather than a fallback.
 */
export const separateTransferAggregate: Scenario = {
  ...EMPTY,
  id: 'transfer-no-source-transaction',
  title: 'Separate transfers that cannot be linked per charge',
  exercises: 'Aggregate reconciliation mode',
  mode: 'aggregate',
  runAccountId: BRIGHTSIDE,
  runPayoutId: null,
  charges: [
    {
      id: 'ch_sep_1',
      accountId: BRIGHTSIDE,
      paymentIntentId: 'pi_sep_1',
      balanceTransactionId: 'txn_sep_1',
      amountMinor: 60_000n,
      currency: USD,
      sourceTransferId: 'tr_sep_bulk',
      customerEmail: 'sep1@northwind.test',
      createdAt: daysBefore(6),
    },
    {
      id: 'ch_sep_2',
      accountId: BRIGHTSIDE,
      paymentIntentId: 'pi_sep_2',
      balanceTransactionId: 'txn_sep_2',
      amountMinor: 40_000n,
      currency: USD,
      sourceTransferId: 'tr_sep_bulk',
      customerEmail: 'sep2@northwind.test',
      createdAt: daysBefore(6),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_sep_1',
      accountId: BRIGHTSIDE,
      type: 'charge',
      sourceId: 'ch_sep_1',
      grossMinor: 60_000n,
      feeMinor: 1_770n,
      netMinor: 58_230n,
      currency: USD,
      payoutId: null,
      createdAt: daysBefore(6),
    },
    {
      id: 'txn_sep_2',
      accountId: BRIGHTSIDE,
      type: 'charge',
      sourceId: 'ch_sep_2',
      grossMinor: 40_000n,
      feeMinor: 1_190n,
      netMinor: 38_810n,
      currency: USD,
      payoutId: null,
      createdAt: daysBefore(6),
    },
  ],
  transfers: [
    {
      id: 'tr_sep_bulk',
      destinationAccountId: BRIGHTSIDE,
      amountMinor: 90_000n,
      currency: USD,
      sourceTransaction: null,
      createdAt: daysBefore(5),
    },
  ],
  expectedRuleIds: ['L2.SEP.TRANSFER_AGGREGATE'],
};

/**
 * A connected account whose window nets negative. Stripe recovers the shortfall from the
 * platform, so this is a platform liability rather than a merchant problem.
 */
export const negativeBalance: Scenario = {
  ...EMPTY,
  id: 'connected-account-negative-balance',
  title: 'Connected account is net negative for the window',
  exercises: 'Platform liability detection in aggregate mode',
  mode: 'aggregate',
  runAccountId: MERIDIAN,
  runPayoutId: null,
  charges: [],
  balanceTransactions: [
    {
      id: 'txn_neg_1',
      accountId: MERIDIAN,
      type: 'refund',
      sourceId: 're_neg_1',
      grossMinor: -95_000n,
      feeMinor: 0n,
      netMinor: -95_000n,
      currency: USD,
      payoutId: null,
      createdAt: daysBefore(4),
    },
    {
      id: 'txn_neg_2',
      accountId: MERIDIAN,
      type: 'adjustment',
      sourceId: null,
      grossMinor: -12_500n,
      feeMinor: 0n,
      netMinor: -12_500n,
      currency: USD,
      payoutId: null,
      createdAt: daysBefore(3),
    },
  ],
  expectedRuleIds: ['L1.ACCOUNT.NEGATIVE_BALANCE'],
};

/**
 * One order matched by two settlements. The customer paid twice, which no Stripe view surfaces
 * because both charges succeeded exactly as instructed.
 */
export const duplicatePayment: Scenario = {
  ...EMPTY,
  id: 'duplicate-payment-one-order',
  title: 'One order charged twice',
  exercises: 'Layer 3 business rules over the settlement boundary',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: null,
  charges: [
    {
      id: 'ch_dupe_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_dupe_1',
      balanceTransactionId: 'txn_dupe_1',
      amountMinor: 78_000n,
      currency: USD,
      transferDestination: ACME,
      transferDataAmountMinor: 70_200n,
      transferId: 'tr_dupe_1',
      applicationFeeId: 'fee_dupe_1',
      metadata: { order_id: 'ORD-DUPE-1' },
      customerEmail: 'twice@northwind.test',
      createdAt: daysBefore(5),
    },
    {
      id: 'ch_dupe_2',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_dupe_2',
      balanceTransactionId: 'txn_dupe_2',
      amountMinor: 78_000n,
      currency: USD,
      transferDestination: ACME,
      transferDataAmountMinor: 70_200n,
      transferId: 'tr_dupe_2',
      applicationFeeId: 'fee_dupe_2',
      metadata: { order_id: 'ORD-DUPE-1' },
      customerEmail: 'twice@northwind.test',
      createdAt: daysBefore(5),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_dupe_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_dupe_1',
      grossMinor: 78_000n,
      feeMinor: 2_292n,
      netMinor: 75_708n,
      currency: USD,
      payoutId: 'po_dupe_1',
      createdAt: daysBefore(5),
    },
    {
      id: 'txn_dupe_2',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_dupe_2',
      grossMinor: 78_000n,
      feeMinor: 2_292n,
      netMinor: 75_708n,
      currency: USD,
      payoutId: 'po_dupe_1',
      createdAt: daysBefore(5),
    },
  ],
  payouts: [
    {
      id: 'po_dupe_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 151_416n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(3).slice(0, 10),
      createdAt: daysBefore(4),
    },
  ],
  transfers: [
    {
      id: 'tr_dupe_1',
      destinationAccountId: ACME,
      amountMinor: 70_200n,
      currency: USD,
      sourceTransaction: 'ch_dupe_1',
      createdAt: daysBefore(5),
    },
    {
      id: 'tr_dupe_2',
      destinationAccountId: ACME,
      amountMinor: 70_200n,
      currency: USD,
      sourceTransaction: 'ch_dupe_2',
      createdAt: daysBefore(5),
    },
  ],
  applicationFees: [
    {
      id: 'fee_dupe_1',
      chargeId: 'ch_dupe_1',
      originatingAccountId: ACME,
      amountMinor: 7_800n,
      currency: USD,
      createdAt: daysBefore(5),
    },
    {
      id: 'fee_dupe_2',
      chargeId: 'ch_dupe_2',
      originatingAccountId: ACME,
      amountMinor: 7_800n,
      currency: USD,
      createdAt: daysBefore(5),
    },
  ],
  orders: [
    {
      externalOrderId: 'ORD-DUPE-1',
      merchantAccountId: ACME,
      totalMinor: 78_000n,
      currency: USD,
      expectedPlatformFeeMinor: 7_800n,
      status: 'fulfilled',
      fulfillmentStatus: 'fulfilled',
      customerEmail: 'twice@northwind.test',
      paymentIntentId: 'pi_dupe_1',
      placedAt: daysBefore(5),
      fulfilledAt: daysBefore(4),
      cancelledAt: null,
    },
  ],
  expectedRuleIds: ['L3.ORDER.DUPLICATE_PAYMENT'],
};

/**
 * An order that was placed and never paid. Matured past its window, so it is a real gap rather
 * than a checkout still in progress.
 */
export const orderNeverPaid: Scenario = {
  ...EMPTY,
  id: 'order-never-paid',
  title: 'Order placed but never paid',
  exercises: 'Layer 3 with a maturity window; the order-side gap',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: null,
  charges: [
    {
      id: 'ch_unpaid_other',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_unpaid_other',
      balanceTransactionId: 'txn_unpaid_other',
      amountMinor: 22_000n,
      currency: USD,
      transferDestination: BRIGHTSIDE,
      transferDataAmountMinor: 19_800n,
      transferId: 'tr_unpaid_other',
      applicationFeeId: 'fee_unpaid_other',
      metadata: { order_id: 'ORD-PAID-1' },
      customerEmail: 'paid@northwind.test',
      createdAt: daysBefore(4),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_unpaid_other',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_unpaid_other',
      grossMinor: 22_000n,
      feeMinor: 668n,
      netMinor: 21_332n,
      currency: USD,
      payoutId: 'po_unpaid_1',
      createdAt: daysBefore(4),
    },
  ],
  payouts: [
    {
      id: 'po_unpaid_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 21_332n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(2).slice(0, 10),
      createdAt: daysBefore(3),
    },
  ],
  transfers: [
    {
      id: 'tr_unpaid_other',
      destinationAccountId: BRIGHTSIDE,
      amountMinor: 19_800n,
      currency: USD,
      sourceTransaction: 'ch_unpaid_other',
      createdAt: daysBefore(4),
    },
  ],
  applicationFees: [
    {
      id: 'fee_unpaid_other',
      chargeId: 'ch_unpaid_other',
      originatingAccountId: BRIGHTSIDE,
      amountMinor: 2_200n,
      currency: USD,
      createdAt: daysBefore(4),
    },
  ],
  orders: [
    {
      externalOrderId: 'ORD-PAID-1',
      merchantAccountId: BRIGHTSIDE,
      totalMinor: 22_000n,
      currency: USD,
      expectedPlatformFeeMinor: 2_200n,
      status: 'fulfilled',
      fulfillmentStatus: 'fulfilled',
      customerEmail: 'paid@northwind.test',
      paymentIntentId: 'pi_unpaid_other',
      placedAt: daysBefore(4),
      fulfilledAt: daysBefore(3),
      cancelledAt: null,
    },
    {
      externalOrderId: 'ORD-UNPAID-1',
      merchantAccountId: BRIGHTSIDE,
      totalMinor: 133_000n,
      currency: USD,
      expectedPlatformFeeMinor: 13_300n,
      status: 'created',
      fulfillmentStatus: 'unfulfilled',
      customerEmail: 'ghost@northwind.test',
      paymentIntentId: null,
      placedAt: daysBefore(6),
      fulfilledAt: null,
      cancelledAt: null,
    },
  ],
  expectedRuleIds: ['L3.ORDER.NEVER_PAID'],
};

/**
 * A payout that completed while a dispute was open on one of its charges. The ledger still
 * balances, so a correct system raises nothing: this scenario exists to prove the maturity and
 * suppression interplay does not manufacture a finding out of an alarming-looking situation.
 */
export const payoutDuringDispute: Scenario = {
  ...EMPTY,
  id: 'payout-during-open-dispute',
  title: 'Payout completed while a dispute was open',
  exercises: 'Maturity and suppression interplay; must produce no exception',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_dispute_1',
  charges: [
    {
      id: 'ch_dispute_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_dispute_1',
      balanceTransactionId: 'txn_dispute_1',
      amountMinor: 55_000n,
      currency: USD,
      transferDestination: ACME,
      transferDataAmountMinor: 49_500n,
      transferId: 'tr_dispute_1',
      applicationFeeId: 'fee_dispute_1',
      metadata: { order_id: 'ORD-DISPUTE-1' },
      customerEmail: 'disputed@northwind.test',
      createdAt: daysBefore(8),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_dispute_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_dispute_1',
      grossMinor: 55_000n,
      feeMinor: 1_625n,
      netMinor: 53_375n,
      currency: USD,
      payoutId: 'po_dispute_1',
      createdAt: daysBefore(8),
    },
  ],
  payouts: [
    {
      id: 'po_dispute_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 53_375n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(5).slice(0, 10),
      createdAt: daysBefore(6),
    },
  ],
  transfers: [
    {
      id: 'tr_dispute_1',
      destinationAccountId: ACME,
      amountMinor: 49_500n,
      currency: USD,
      sourceTransaction: 'ch_dispute_1',
      createdAt: daysBefore(8),
    },
  ],
  applicationFees: [
    {
      id: 'fee_dispute_1',
      chargeId: 'ch_dispute_1',
      originatingAccountId: ACME,
      amountMinor: 5_500n,
      currency: USD,
      createdAt: daysBefore(8),
    },
  ],
  disputes: [
    {
      id: 'dp_dispute_1',
      accountId: PLATFORM_ACCOUNT,
      chargeId: 'ch_dispute_1',
      amountMinor: 55_000n,
      currency: USD,
      status: 'needs_response',
      reason: 'product_not_received',
      createdAt: daysBefore(2),
    },
  ],
  orders: [
    {
      externalOrderId: 'ORD-DISPUTE-1',
      merchantAccountId: ACME,
      totalMinor: 55_000n,
      currency: USD,
      expectedPlatformFeeMinor: 5_500n,
      status: 'fulfilled',
      fulfillmentStatus: 'fulfilled',
      customerEmail: 'disputed@northwind.test',
      paymentIntentId: 'pi_dispute_1',
      placedAt: daysBefore(8),
      fulfilledAt: daysBefore(7),
      cancelledAt: null,
    },
  ],
  expectedRuleIds: [],
};

export const AGGREGATE_AND_ORDER_SCENARIOS: readonly Scenario[] = [
  separateTransferAggregate,
  negativeBalance,
  duplicatePayment,
  orderNeverPaid,
  payoutDuringDispute,
];
