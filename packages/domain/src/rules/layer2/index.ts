import {abs, Money} from '../../money/money.js';
import type {Finding, LedgerContext} from '../../ledger/types.js';
import {ageSeconds, bigintParam, numberParam, type Rule} from '../types.js';
import {comparePostings, describeComparison} from './comparator.js';
import {deriveExpectedPostings} from './mappers.js';

export * from './mappers.js';
export * from './comparator.js';

function ledgerContext(
    snapshot: Parameters<Rule['evaluate']>[0],
    takeRateBasisPoints: number,
): LedgerContext {
    return {
        platformAccountId: snapshot.platformAccountId,
        balanceTransactions: snapshot.balanceTransactions,
        applicationFees: snapshot.applicationFees,
        transfers: snapshot.transfers,
        refunds: snapshot.refunds,
        reversals: snapshot.reversals,
        takeRateBasisPoints,
    };
}

/**
 * Destination charges whose merchant transfer never appeared. The two-hour maturity window is the
 * difference between a useful queue and one that flags every charge for the minutes Stripe takes
 * to create the transfer.
 */
export const DestinationTransferMissingRule: Rule = {
    id: 'L2.DEST.TRANSFER_MISSING',
    name: 'Destination transfer missing',
    description: 'A destination charge must produce a transfer to the merchant account.',
    layer: 2,
    chargeTypes: ['destination'],
    severity: 'critical',
    maturitySeconds: 7_200,
    mode: 'transactional',
    defaultParameters: {take_rate_bps: 1000},

    evaluate(snapshot, params) {
        const ctx = ledgerContext(snapshot, numberParam(params, 'take_rate_bps', 1000));
        const findings: Finding[] = [];

        for (const charge of snapshot.charges) {
            if (charge.chargeType !== 'destination') continue;
            if (ageSeconds(snapshot.asOf, charge.createdAt) < DestinationTransferMissingRule.maturitySeconds) continue;

            const comparisons = comparePostings(deriveExpectedPostings(charge, ctx), ctx).filter(
                (c) => c.posting.kind === 'transfer_to_merchant' && c.status === 'missing',
            );

            for (const comparison of comparisons) {
                findings.push({
                    ruleId: DestinationTransferMissingRule.id,
                    subjectType: 'charge',
                    subjectId: charge.id,
                    severity: 'critical',
                    exposureMinor: comparison.posting.amountMinor,
                    currency: charge.currency,
                    expected: {
                        transfer_to: comparison.posting.accountId,
                        amount_minor: comparison.posting.amountMinor.toString(),
                    },
                    actual: {transfer_found: false},
                    evidence: {
                        charge_id: charge.id,
                        transfer_destination: charge.transferDestination,
                        transfer_id: charge.transferId,
                        posting: describeComparison(comparison),
                    },
                    narrative: `Destination charge ${charge.id} should have transferred ${Money.of(comparison.posting.amountMinor, charge.currency).format()} to ${comparison.posting.accountId}, but no transfer exists. The merchant has not been paid.`,
                });
            }
        }

        return findings;
    },
};

/** The transfer exists but does not carry the amount the split implies. */
export const DestinationTransferAmountRule: Rule = {
    id: 'L2.DEST.TRANSFER_AMOUNT',
    name: 'Destination transfer amount mismatch',
    description: 'A destination transfer must carry the gross less the application fee.',
    layer: 2,
    chargeTypes: ['destination'],
    severity: 'high',
    maturitySeconds: 7_200,
    mode: 'transactional',
    defaultParameters: {take_rate_bps: 1000, tolerance_minor: 0},

    evaluate(snapshot, params) {
        const ctx = ledgerContext(snapshot, numberParam(params, 'take_rate_bps', 1000));
        const tolerance = bigintParam(params, 'tolerance_minor', 0n);
        const findings: Finding[] = [];

        for (const charge of snapshot.charges) {
            if (charge.chargeType !== 'destination') continue;
            if (ageSeconds(snapshot.asOf, charge.createdAt) < DestinationTransferAmountRule.maturitySeconds) continue;

            const comparisons = comparePostings(
                deriveExpectedPostings(charge, ctx).map((p) =>
                    p.kind === 'transfer_to_merchant' ? {...p, toleranceMinor: tolerance} : p,
                ),
                ctx,
            ).filter((c) => c.posting.kind === 'transfer_to_merchant' && c.status === 'mismatched');

            for (const comparison of comparisons) {
                findings.push({
                    ruleId: DestinationTransferAmountRule.id,
                    subjectType: 'charge',
                    subjectId: charge.id,
                    severity: 'high',
                    exposureMinor: abs(comparison.deltaMinor),
                    currency: charge.currency,
                    expected: {amount_minor: comparison.posting.amountMinor.toString()},
                    actual: {
                        amount_minor: (comparison.actualMinor ?? 0n).toString(),
                        delta_minor: comparison.deltaMinor.toString(),
                    },
                    evidence: {
                        charge_id: charge.id,
                        transfer_id: charge.transferId,
                        take_rate_bps: numberParam(params, 'take_rate_bps', 1000),
                        tolerance_minor: tolerance.toString(),
                    },
                    narrative: `Transfer for charge ${charge.id} moved ${Money.of(comparison.actualMinor ?? 0n, charge.currency).format()} where ${Money.of(comparison.posting.amountMinor, charge.currency).format()} was due. Difference: ${Money.of(comparison.deltaMinor, charge.currency).format()}.`,
                });
            }
        }

        return findings;
    },
};

/** Direct charges are the platform's revenue path. No application fee means revenue was lost. */
export const DirectApplicationFeeMissingRule: Rule = {
    id: 'L2.DIRECT.APP_FEE_MISSING',
    name: 'Application fee absent on direct charge',
    description: 'A direct charge on a revenue-bearing account must carry an application fee.',
    layer: 2,
    chargeTypes: ['direct'],
    severity: 'high',
    maturitySeconds: 3_600,
    mode: 'transactional',
    defaultParameters: {take_rate_bps: 1000, minimum_charge_minor: 100},

    evaluate(snapshot, params) {
        const takeRate = numberParam(params, 'take_rate_bps', 1000);
        const minimum = bigintParam(params, 'minimum_charge_minor', 100n);
        const findings: Finding[] = [];

        for (const charge of snapshot.charges) {
            if (charge.chargeType !== 'direct') continue;
            if (charge.amountMinor < minimum) continue;
            if (charge.status !== 'succeeded') continue;
            if (ageSeconds(snapshot.asOf, charge.createdAt) < DirectApplicationFeeMissingRule.maturitySeconds) continue;

            const fee = snapshot.applicationFees.find((f) => f.chargeId === charge.id);
            if (fee) continue;

            const expected = Money.of(charge.amountMinor, charge.currency).percentBasisPoints(takeRate);
            findings.push({
                ruleId: DirectApplicationFeeMissingRule.id,
                subjectType: 'charge',
                subjectId: charge.id,
                severity: 'high',
                exposureMinor: expected.minor,
                currency: charge.currency,
                expected: {application_fee_minor: expected.toMinorString(), take_rate_bps: takeRate},
                actual: {application_fee_minor: '0', application_fee_id: null},
                evidence: {charge_id: charge.id, stripe_account_id: charge.stripeAccountId},
                narrative: `Direct charge ${charge.id} settled without an application fee. At the configured take rate the platform should have earned ${expected.format()}.`,
            });
        }

        return findings;
    },
};

/**
 * The highest-value real-world finding: money was refunded to the customer from the platform
 * balance but never clawed back from the merchant, so the platform absorbed the loss.
 */
export const RefundWithoutReversalRule: Rule = {
    id: 'L2.DEST.REFUND_NO_REVERSAL',
    name: 'Refund without transfer reversal',
    description: 'A refund on a charge whose funds were transferred out must reverse that transfer.',
    layer: 2,
    chargeTypes: ['destination', 'separate'],
    severity: 'critical',
    maturitySeconds: 86_400,
    mode: 'transactional',
    defaultParameters: {},

    evaluate(snapshot) {
        const findings: Finding[] = [];

        for (const charge of snapshot.charges) {
            if (charge.chargeType !== 'destination' && charge.chargeType !== 'separate') continue;

            const refunds = snapshot.refunds.filter(
                (r) => r.chargeId === charge.id && r.status !== 'failed' && r.status !== 'canceled',
            );
            if (refunds.length === 0) continue;
            if (refunds.every((r) => ageSeconds(snapshot.asOf, r.createdAt) < RefundWithoutReversalRule.maturitySeconds)) continue;

            const transfer = snapshot.transfers.find((t) => t.id === charge.transferId || t.sourceTransaction === charge.id);
            if (!transfer) continue;

            const refunded = Money.sum(refunds.map((r) => Money.of(r.amountMinor, charge.currency)), charge.currency);
            const reversed = Money.sum(
                snapshot.reversals.filter((r) => r.transferId === transfer.id).map((r) => Money.of(r.amountMinor, charge.currency)),
                charge.currency,
            );

            const shortfall = refunded.minus(reversed);
            if (shortfall.minor <= 0n) continue;

            findings.push({
                ruleId: RefundWithoutReversalRule.id,
                subjectType: 'charge',
                subjectId: charge.id,
                severity: 'critical',
                exposureMinor: shortfall.minor,
                currency: charge.currency,
                expected: {reversal_minor: refunded.toMinorString()},
                actual: {reversal_minor: reversed.toMinorString(), shortfall_minor: shortfall.toMinorString()},
                evidence: {
                    charge_id: charge.id,
                    transfer_id: transfer.id,
                    refund_ids: refunds.map((r) => r.id).sort(),
                    reversal_ids: snapshot.reversals.filter((r) => r.transferId === transfer.id).map((r) => r.id).sort(),
                },
                narrative: `Charge ${charge.id} was refunded ${refunded.format()} but only ${reversed.format()} was reversed from transfer ${transfer.id}. The platform absorbed ${shortfall.format()}.`,
            });
        }

        return findings;
    },
};

/**
 * When transfers carry no `source_transaction`, per-charge matching is structurally impossible.
 * Aggregate mode is a first-class path rather than a fallback, because for this flow it is the
 * only correct check that exists.
 */
export const SeparateTransferAggregateRule: Rule = {
    id: 'L2.SEP.TRANSFER_AGGREGATE',
    name: 'Separate transfers do not reconcile in aggregate',
    description: 'Where transfers cannot be linked per charge, their window total must match merchant net.',
    layer: 2,
    chargeTypes: ['separate'],
    severity: 'high',
    maturitySeconds: 259_200,
    mode: 'aggregate',
    defaultParameters: {tolerance_minor: 0},

    evaluate(snapshot, params) {
        const separates = snapshot.settlements.filter((s) => s.chargeType === 'separate');
        if (separates.length === 0) return [];

        const currency = separates[0]?.currency ?? 'USD';
        const expected = Money.sum(
            separates.map((s) => Money.of(s.merchantNetMinor, currency)),
            currency,
        );
        const actual = Money.sum(
            snapshot.transfers.map((t) => Money.of(t.amountMinor - t.amountReversedMinor, currency)),
            currency,
        );

        const delta = expected.minus(actual);
        const tolerance = bigintParam(params, 'tolerance_minor', 0n);
        if (abs(delta.minor) <= tolerance) return [];

        return [
            {
                ruleId: SeparateTransferAggregateRule.id,
                subjectType: 'window',
                subjectId: snapshot.scopeKey,
                severity: 'high',
                exposureMinor: abs(delta.minor),
                currency,
                expected: {merchant_net_total_minor: expected.toMinorString(), settlement_count: separates.length},
                actual: {transfer_total_minor: actual.toMinorString(), transfer_count: snapshot.transfers.length},
                evidence: {
                    window_start: snapshot.windowStart,
                    window_end: snapshot.windowEnd,
                    stripe_account_id: snapshot.stripeAccountId,
                    charge_ids: separates.map((s) => s.chargeId).sort(),
                    tolerance_minor: tolerance.toString(),
                },
                narrative: `Separate-transfer settlements for this window total ${expected.format()} of merchant net, while transfers moved ${actual.format()}. Difference: ${delta.format()}.`,
            },
        ];
    },
};

export const LAYER_2_RULES: readonly Rule[] = [
    DestinationTransferMissingRule,
    DestinationTransferAmountRule,
    DirectApplicationFeeMissingRule,
    RefundWithoutReversalRule,
    SeparateTransferAggregateRule,
];
