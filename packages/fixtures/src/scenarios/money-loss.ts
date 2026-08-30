import type { Scenario } from '../types.js';
import { ACME, BRIGHTSIDE, EMPTY, MERIDIAN, PLATFORM_ACCOUNT, USD, daysBefore } from './index.js';

/**
 * The highest-value finding in practice. The customer was refunded from the platform balance,
 * the application fee came back, but the transfer to the merchant was never reversed — so the
 * platform paid the refund out of its own pocket and nobody noticed.
 */
export const refundWithoutReversal: Scenario = {
  ...EMPTY,
  id: 'app-fee-refunded-transfer-not-reversed',
  title: 'Refund issued, application fee returned, transfer never reversed',
  exercises: 'Layer 2 across refund and reversal; the finding that pays for the product',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_absorb_1',
  charges: [
    {
      id: 'ch_absorb_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_absorb_1',
      balanceTransactionId: 'txn_absorb_1',
      amountMinor: 240_000n,
      currency: USD,
      refundedMinor: 240_000n,
      transferDestination: ACME,
      transferDataAmountMinor: 216_000n,
      transferId: 'tr_absorb_1',
      applicationFeeId: 'fee_absorb_1',
      customerEmail: 'refunded@northwind.test',
      createdAt: daysBefore(9),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_absorb_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_absorb_1',
      grossMinor: 240_000n,
      feeMinor: 7_260n,
      netMinor: 232_740n,
      currency: USD,
      payoutId: 'po_absorb_1',
      createdAt: daysBefore(9),
    },
  ],
  payouts: [
    {
      id: 'po_absorb_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 232_740n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(6).slice(0, 10),
      createdAt: daysBefore(7),
    },
  ],
  refunds: [
    {
      id: 're_absorb_1',
      accountId: PLATFORM_ACCOUNT,
      chargeId: 'ch_absorb_1',
      amountMinor: 240_000n,
      currency: USD,
      reason: 'requested_by_customer',
      transferReversalId: null,
      createdAt: daysBefore(4),
    },
  ],
  transfers: [
    {
      id: 'tr_absorb_1',
      destinationAccountId: ACME,
      amountMinor: 216_000n,
      currency: USD,
      sourceTransaction: 'ch_absorb_1',
      createdAt: daysBefore(9),
    },
  ],
  applicationFees: [
    {
      id: 'fee_absorb_1',
      chargeId: 'ch_absorb_1',
      originatingAccountId: ACME,
      amountMinor: 24_000n,
      refundedMinor: 24_000n,
      currency: USD,
      createdAt: daysBefore(9),
    },
  ],
  expectedRuleIds: ['L2.DEST.REFUND_NO_REVERSAL'],
};

/**
 * Refunds totalling more than the charge ever captured. Either a duplicate refund was issued or
 * a projection is stale, and both need stopping before any rule below Layer 1 runs.
 */
export const refundExceedsCharge: Scenario = {
  ...EMPTY,
  id: 'partial-refund-exceeds-remaining',
  title: 'Refunds total more than the charge captured',
  exercises: 'Layer 1 arithmetic integrity and the short-circuit to lower layers',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_over_1',
  charges: [
    {
      id: 'ch_over_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_over_1',
      balanceTransactionId: 'txn_over_1',
      amountMinor: 15_000n,
      currency: USD,
      refundedMinor: 15_000n,
      transferDestination: BRIGHTSIDE,
      transferDataAmountMinor: 13_500n,
      transferId: 'tr_over_1',
      customerEmail: 'double@northwind.test',
      createdAt: daysBefore(7),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_over_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_over_1',
      grossMinor: 15_000n,
      feeMinor: 465n,
      netMinor: 14_535n,
      currency: USD,
      payoutId: 'po_over_1',
      createdAt: daysBefore(7),
    },
  ],
  payouts: [
    {
      id: 'po_over_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 14_535n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(5).slice(0, 10),
      createdAt: daysBefore(6),
    },
  ],
  refunds: [
    {
      id: 're_over_1',
      accountId: PLATFORM_ACCOUNT,
      chargeId: 'ch_over_1',
      amountMinor: 9_000n,
      currency: USD,
      createdAt: daysBefore(5),
    },
    {
      id: 're_over_2',
      accountId: PLATFORM_ACCOUNT,
      chargeId: 'ch_over_1',
      amountMinor: 9_000n,
      currency: USD,
      createdAt: daysBefore(5),
    },
  ],
  transfers: [
    {
      id: 'tr_over_1',
      destinationAccountId: BRIGHTSIDE,
      amountMinor: 13_500n,
      currency: USD,
      sourceTransaction: 'ch_over_1',
      createdAt: daysBefore(7),
    },
  ],
  expectedRuleIds: ['L1.REFUND.EXCEEDS_CHARGE'],
};

/**
 * A charge on the platform ledger with no destination, no on_behalf_of and no linked transfer.
 * No Connect shape fits, so the classifier declines to guess and the charge surfaces instead of
 * producing a settlement row built on a wrong assumption.
 */
export const unclassifiableCharge: Scenario = {
  ...EMPTY,
  id: 'unclassifiable-charge-shape',
  title: 'Charge shape matches no known Connect flow',
  exercises: 'Classifier fallback; an unclassified charge must never settle silently',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_unknown_1',
  charges: [
    {
      id: 'ch_unknown_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_unknown_1',
      balanceTransactionId: 'txn_unknown_1',
      amountMinor: 64_500n,
      currency: USD,
      customerEmail: 'mystery@northwind.test',
      createdAt: daysBefore(3),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_unknown_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_unknown_1',
      grossMinor: 64_500n,
      feeMinor: 2_100n,
      netMinor: 62_400n,
      currency: USD,
      payoutId: 'po_unknown_1',
      createdAt: daysBefore(3),
    },
  ],
  payouts: [
    {
      id: 'po_unknown_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 62_400n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(1).slice(0, 10),
      createdAt: daysBefore(2),
    },
  ],
  expectedRuleIds: ['L1.CLASSIFY.UNKNOWN'],
};

/**
 * A direct charge on a connected account that settled without an application fee. The platform's
 * revenue simply did not happen, which is invisible in every Stripe view because nothing failed.
 */
export const directChargeNoFee: Scenario = {
  ...EMPTY,
  id: 'direct-charge-no-application-fee',
  title: 'Direct charge settled without the platform fee',
  exercises: 'Layer 2 for the direct charge flow; silent revenue loss',
  mode: 'transactional',
  runAccountId: ACME,
  runPayoutId: 'po_direct_1',
  charges: [
    {
      id: 'ch_direct_1',
      accountId: ACME,
      paymentIntentId: 'pi_direct_1',
      balanceTransactionId: 'txn_direct_1',
      amountMinor: 175_000n,
      currency: USD,
      customerEmail: 'direct@northwind.test',
      createdAt: daysBefore(4),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_direct_1',
      accountId: ACME,
      type: 'charge',
      sourceId: 'ch_direct_1',
      grossMinor: 175_000n,
      feeMinor: 5_105n,
      netMinor: 169_895n,
      currency: USD,
      payoutId: 'po_direct_1',
      createdAt: daysBefore(4),
    },
  ],
  payouts: [
    {
      id: 'po_direct_1',
      accountId: ACME,
      amountMinor: 169_895n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(2).slice(0, 10),
      createdAt: daysBefore(3),
    },
  ],
  expectedRuleIds: ['L2.DIRECT.APP_FEE_MISSING'],
};

/**
 * A restricted account with payouts paused. Suppression must hold: this scenario is correct only
 * when it produces nothing at all. Without it the queue fills with findings that are working as
 * designed, and the operator stops reading the queue.
 */
export const restrictedAccountSuppressed: Scenario = {
  ...EMPTY,
  id: 'restricted-account-payouts-paused',
  title: 'Restricted account with payouts paused raises nothing',
  exercises: 'Suppression driven by account state; the false-positive guard',
  mode: 'transactional',
  runAccountId: MERIDIAN,
  runPayoutId: null,
  charges: [
    {
      id: 'ch_paused_1',
      accountId: MERIDIAN,
      paymentIntentId: 'pi_paused_1',
      balanceTransactionId: 'txn_paused_1',
      amountMinor: 42_000n,
      currency: USD,
      applicationFeeId: 'fee_paused_1',
      customerEmail: 'paused@northwind.test',
      createdAt: daysBefore(5),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_paused_1',
      accountId: MERIDIAN,
      type: 'charge',
      sourceId: 'ch_paused_1',
      grossMinor: 42_000n,
      feeMinor: 1_248n,
      netMinor: 40_752n,
      currency: USD,
      payoutId: null,
      createdAt: daysBefore(5),
    },
  ],
  applicationFees: [
    {
      id: 'fee_paused_1',
      chargeId: 'ch_paused_1',
      originatingAccountId: MERIDIAN,
      amountMinor: 4_200n,
      currency: USD,
      createdAt: daysBefore(5),
    },
  ],
  expectedRuleIds: [],
};

export const MONEY_LOSS_SCENARIOS: readonly Scenario[] = [
  refundWithoutReversal,
  refundExceedsCharge,
  unclassifiableCharge,
  directChargeNoFee,
  restrictedAccountSuppressed,
];
