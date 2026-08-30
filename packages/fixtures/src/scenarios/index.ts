import { daysBefore, hoursBefore } from '../clock.js';
import type { Scenario } from '../types.js';
import { PLATFORM_ACCOUNT } from './accounts.js';

const USD = 'USD';
const ACME = 'acct_acme_studio';
const BRIGHTSIDE = 'acct_brightside';
const MERIDIAN = 'acct_meridian';

/** Shared empty collections keep each scenario to only the objects it actually needs. */
const EMPTY = {
  charges: [],
  balanceTransactions: [],
  payouts: [],
  refunds: [],
  transfers: [],
  reversals: [],
  applicationFees: [],
  disputes: [],
  orders: [],
  accounts: [],
} as const;

/**
 * A payout whose balance transactions do not add up to the amount that reached the bank. This is
 * the hardest check in the system and the number finance ties to the statement, so it leads.
 */
const payoutChecksumMismatch: Scenario = {
  ...EMPTY,
  id: 'payout-checksum-mismatch',
  title: 'Payout does not equal its balance transactions',
  exercises: 'Layer 1 ledger integrity; the checksum that ties to the bank statement',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_checksum_1',
  charges: [
    {
      id: 'ch_checksum_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_checksum_1',
      balanceTransactionId: 'txn_checksum_1',
      amountMinor: 120_000n,
      currency: USD,
      transferDestination: ACME,
      transferDataAmountMinor: 108_000n,
      transferId: 'tr_checksum_1',
      applicationFeeId: 'fee_checksum_1',
      customerEmail: 'ops@northwind.test',
      createdAt: daysBefore(3),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_checksum_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_checksum_1',
      grossMinor: 120_000n,
      feeMinor: 3_780n,
      netMinor: 116_220n,
      currency: USD,
      payoutId: 'po_checksum_1',
      createdAt: daysBefore(3),
    },
  ],
  payouts: [
    {
      id: 'po_checksum_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 157_470n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(1).slice(0, 10),
      createdAt: daysBefore(2),
    },
  ],
  transfers: [
    {
      id: 'tr_checksum_1',
      destinationAccountId: ACME,
      amountMinor: 108_000n,
      currency: USD,
      sourceTransaction: 'ch_checksum_1',
      createdAt: daysBefore(3),
    },
  ],
  applicationFees: [
    {
      id: 'fee_checksum_1',
      chargeId: 'ch_checksum_1',
      originatingAccountId: ACME,
      amountMinor: 12_000n,
      currency: USD,
      createdAt: daysBefore(3),
    },
  ],
  expectedRuleIds: ['L1.PAYOUT.CHECKSUM'],
};

/**
 * The refund event arrives before the charge event. Because workers re-fetch canonical state
 * rather than trusting payloads, the final projection is correct and nothing is flagged.
 * A system that trusted payload ordering would produce a spurious finding here.
 */
const refundBeforeCharge: Scenario = {
  ...EMPTY,
  id: 'refund-before-charge',
  title: 'Refund observed before its charge',
  exercises: 'Out-of-order tolerance via canonical re-fetch; must produce no exception',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_ooo_1',
  charges: [
    {
      id: 'ch_ooo_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_ooo_1',
      balanceTransactionId: 'txn_ooo_1',
      amountMinor: 50_000n,
      currency: USD,
      refundedMinor: 50_000n,
      transferDestination: BRIGHTSIDE,
      transferDataAmountMinor: 45_000n,
      transferId: 'tr_ooo_1',
      applicationFeeId: 'fee_ooo_1',
      metadata: { order_id: 'ORD-OOO-1' },
      customerEmail: 'late@northwind.test',
      createdAt: daysBefore(6),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_ooo_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_ooo_1',
      grossMinor: 50_000n,
      feeMinor: 1_580n,
      netMinor: 48_420n,
      currency: USD,
      payoutId: 'po_ooo_1',
      createdAt: daysBefore(6),
    },
    {
      id: 'txn_ooo_refund',
      accountId: PLATFORM_ACCOUNT,
      type: 'refund',
      sourceId: 're_ooo_1',
      grossMinor: -50_000n,
      feeMinor: 0n,
      netMinor: -50_000n,
      currency: USD,
      payoutId: 'po_ooo_1',
      createdAt: daysBefore(5),
    },
  ],
  payouts: [
    {
      id: 'po_ooo_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: -1_580n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(4).slice(0, 10),
      createdAt: daysBefore(4),
    },
  ],
  refunds: [
    {
      id: 're_ooo_1',
      accountId: PLATFORM_ACCOUNT,
      chargeId: 'ch_ooo_1',
      amountMinor: 50_000n,
      currency: USD,
      transferReversalId: 'trr_ooo_1',
      createdAt: daysBefore(5),
    },
  ],
  transfers: [
    {
      id: 'tr_ooo_1',
      destinationAccountId: BRIGHTSIDE,
      amountMinor: 45_000n,
      reversedMinor: 45_000n,
      currency: USD,
      sourceTransaction: 'ch_ooo_1',
      createdAt: daysBefore(6),
    },
  ],
  reversals: [
    { id: 'trr_ooo_1', transferId: 'tr_ooo_1', amountMinor: 50_000n, currency: USD, createdAt: daysBefore(5) },
  ],
  applicationFees: [
    {
      id: 'fee_ooo_1',
      chargeId: 'ch_ooo_1',
      originatingAccountId: BRIGHTSIDE,
      amountMinor: 5_000n,
      refundedMinor: 5_000n,
      currency: USD,
      createdAt: daysBefore(6),
    },
  ],
  orders: [
    {
      externalOrderId: 'ORD-OOO-1',
      merchantAccountId: BRIGHTSIDE,
      totalMinor: 50_000n,
      currency: USD,
      expectedPlatformFeeMinor: 5_000n,
      status: 'refunded',
      fulfillmentStatus: 'returned',
      customerEmail: 'late@northwind.test',
      paymentIntentId: 'pi_ooo_1',
      placedAt: daysBefore(6),
      fulfilledAt: null,
      cancelledAt: null,
    },
  ],
  expectedRuleIds: [],
};

/**
 * A destination charge whose merchant transfer never happened. This is money the merchant is
 * owed and has not received, so it is critical and it carries the full transfer amount as
 * exposure rather than a difference.
 */
const destinationTransferMissing: Scenario = {
  ...EMPTY,
  id: 'destination-transfer-missing',
  title: 'Destination charge with no transfer to the merchant',
  exercises: 'Layer 2 expected postings for the destination charge flow',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_missing_1',
  charges: [
    {
      id: 'ch_missing_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_missing_1',
      balanceTransactionId: 'txn_missing_1',
      amountMinor: 89_900n,
      currency: USD,
      transferDestination: BRIGHTSIDE,
      transferDataAmountMinor: 80_910n,
      applicationFeeId: 'fee_missing_1',
      customerEmail: 'buyer1@northwind.test',
      createdAt: daysBefore(4),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_missing_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_missing_1',
      grossMinor: 89_900n,
      feeMinor: 2_907n,
      netMinor: 86_993n,
      currency: USD,
      payoutId: 'po_missing_1',
      createdAt: daysBefore(4),
    },
  ],
  payouts: [
    {
      id: 'po_missing_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 86_993n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(2).slice(0, 10),
      createdAt: daysBefore(3),
    },
  ],
  applicationFees: [
    {
      id: 'fee_missing_1',
      chargeId: 'ch_missing_1',
      originatingAccountId: BRIGHTSIDE,
      amountMinor: 8_990n,
      currency: USD,
      createdAt: daysBefore(4),
    },
  ],
  expectedRuleIds: ['L2.DEST.TRANSFER_MISSING'],
};

/**
 * A percentage split that does not divide evenly. With a zero tolerance the drift is a finding;
 * the tenant parameter exists precisely so a business that accepts a penny of drift can say so
 * rather than living with a permanently noisy rule.
 */
const roundingDrift: Scenario = {
  ...EMPTY,
  id: 'rounding-drift-percentage-split',
  title: 'Transfer is short by rounding on a percentage split',
  exercises: 'Tolerance parameters on the shared posting comparator',
  mode: 'transactional',
  runAccountId: PLATFORM_ACCOUNT,
  runPayoutId: 'po_round_1',
  charges: [
    {
      id: 'ch_round_1',
      accountId: PLATFORM_ACCOUNT,
      paymentIntentId: 'pi_round_1',
      balanceTransactionId: 'txn_round_1',
      amountMinor: 3_333n,
      currency: USD,
      transferDestination: ACME,
      transferDataAmountMinor: 3_000n,
      transferId: 'tr_round_1',
      applicationFeeId: 'fee_round_1',
      customerEmail: 'buyer2@northwind.test',
      createdAt: daysBefore(5),
    },
  ],
  balanceTransactions: [
    {
      id: 'txn_round_1',
      accountId: PLATFORM_ACCOUNT,
      type: 'charge',
      sourceId: 'ch_round_1',
      grossMinor: 3_333n,
      feeMinor: 127n,
      netMinor: 3_206n,
      currency: USD,
      payoutId: 'po_round_1',
      createdAt: daysBefore(5),
    },
  ],
  payouts: [
    {
      id: 'po_round_1',
      accountId: PLATFORM_ACCOUNT,
      amountMinor: 3_206n,
      currency: USD,
      status: 'paid',
      arrivalDate: daysBefore(3).slice(0, 10),
      createdAt: daysBefore(4),
    },
  ],
  transfers: [
    {
      id: 'tr_round_1',
      destinationAccountId: ACME,
      amountMinor: 2_997n,
      currency: USD,
      sourceTransaction: 'ch_round_1',
      createdAt: daysBefore(5),
    },
  ],
  applicationFees: [
    {
      id: 'fee_round_1',
      chargeId: 'ch_round_1',
      originatingAccountId: ACME,
      amountMinor: 333n,
      currency: USD,
      createdAt: daysBefore(5),
    },
  ],
  expectedRuleIds: ['L2.DEST.TRANSFER_AMOUNT'],
};

export const CORE_SCENARIOS: readonly Scenario[] = [
  payoutChecksumMismatch,
  refundBeforeCharge,
  destinationTransferMissing,
  roundingDrift,
];

export { PLATFORM_ACCOUNT, ACME, BRIGHTSIDE, MERIDIAN, USD, EMPTY, daysBefore, hoursBefore };
