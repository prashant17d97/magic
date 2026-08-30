import {abs, Money} from '../../money/money.js';
import type {Finding} from '../../ledger/types.js';
import {ageSeconds, bigintParam, type Rule} from '../types.js';

/**
 * A payout is an actual bank deposit and decomposes exactly into its balance transactions.
 * That equality is the hardest checksum the system has, and it is the number finance ties to
 * the bank statement, so it runs with a zero maturity window: a paid payout is terminal.
 */
export const PayoutChecksumRule: Rule = {
    id: 'L1.PAYOUT.CHECKSUM',
    name: 'Payout checksum',
    description: 'The payout amount must equal the sum of the balance transactions assigned to it.',
    layer: 1,
    severity: 'critical',
    maturitySeconds: 0,
    mode: 'both',
    defaultParameters: {tolerance_minor: 0},

    evaluate(snapshot, params) {
        const payout = snapshot.payout;
        if (!payout) return [];

        const assigned = snapshot.balanceTransactions.filter((b) => b.payoutId === payout.id);
        const reconstructed = Money.sum(
            assigned.map((b) => Money.of(b.netMinor, payout.currency)),
            payout.currency,
        );
        const expected = Money.of(payout.amountMinor, payout.currency);
        const delta = reconstructed.minus(expected);
        const tolerance = bigintParam(params, 'tolerance_minor', 0n);

        if (abs(delta.minor) <= tolerance) return [];

        return [
            {
                ruleId: PayoutChecksumRule.id,
                subjectType: 'payout',
                subjectId: payout.id,
                severity: 'critical',
                exposureMinor: abs(delta.minor),
                currency: payout.currency,
                expected: {payout_amount_minor: expected.toMinorString()},
                actual: {
                    reconstructed_minor: reconstructed.toMinorString(),
                    transaction_count: assigned.length,
                    delta_minor: delta.toMinorString(),
                },
                evidence: {
                    payout_id: payout.id,
                    balance_transaction_ids: assigned.map((b) => b.id).sort(),
                    tolerance_minor: tolerance.toString(),
                },
                narrative: `Payout ${payout.id} does not equal the sum of its balance transactions. Difference: ${delta.format()}.`,
            },
        ];
    },
};

/**
 * A refund larger than what remains on the charge means either a duplicate refund was issued or
 * a projection is stale. Both are worth stopping on before any downstream rule runs.
 */
export const RefundExceedsChargeRule: Rule = {
    id: 'L1.REFUND.EXCEEDS_CHARGE',
    name: 'Refund exceeds charge',
    description: 'Total refunds against a charge must never exceed the captured amount.',
    layer: 1,
    severity: 'critical',
    maturitySeconds: 0,
    mode: 'both',
    defaultParameters: {},

    evaluate(snapshot) {
        const findings: Finding[] = [];

        for (const charge of snapshot.charges) {
            const refunds = snapshot.refunds.filter(
                (r) => r.chargeId === charge.id && r.status !== 'failed' && r.status !== 'canceled',
            );
            if (refunds.length === 0) continue;

            const refunded = Money.sum(
                refunds.map((r) => Money.of(r.amountMinor, charge.currency)),
                charge.currency,
            );
            const captured = Money.of(charge.amountCapturedMinor, charge.currency);
            if (refunded.compare(captured) <= 0) continue;

            const over = refunded.minus(captured);
            findings.push({
                ruleId: RefundExceedsChargeRule.id,
                subjectType: 'charge',
                subjectId: charge.id,
                severity: 'critical',
                exposureMinor: over.minor,
                currency: charge.currency,
                expected: {max_refundable_minor: captured.toMinorString()},
                actual: {refunded_minor: refunded.toMinorString(), refund_count: refunds.length},
                evidence: {charge_id: charge.id, refund_ids: refunds.map((r) => r.id).sort()},
                narrative: `Charge ${charge.id} has been refunded ${refunded.format()} against a captured amount of ${captured.format()}, an excess of ${over.format()}.`,
            });
        }

        return findings;
    },
};

/**
 * A balance transaction whose source object never landed locally means the projection has a hole.
 * This is the rule that turns a silent ingestion gap into a visible one.
 */
export const OrphanBalanceTransactionRule: Rule = {
    id: 'L1.LEDGER.ORPHAN_BALANCE_TXN',
    name: 'Orphan balance transaction',
    description: 'Every charge, refund and transfer balance transaction must have its source object projected locally.',
    layer: 1,
    severity: 'high',
    maturitySeconds: 3600,
    mode: 'transactional',
    defaultParameters: {},

    evaluate(snapshot, _params) {
        const known = new Set<string>();
        for (const c of snapshot.charges) known.add(c.id);
        for (const r of snapshot.refunds) known.add(r.id);
        for (const t of snapshot.transfers) known.add(t.id);
        for (const f of snapshot.applicationFees) known.add(f.id);

        const tracked = new Set(['charge', 'refund', 'transfer', 'application_fee']);
        const orphans = snapshot.balanceTransactions
            .filter((b) => tracked.has(b.type) && b.sourceId !== null && !known.has(b.sourceId))
            .filter((b) => ageSeconds(snapshot.asOf, b.createdAt) >= OrphanBalanceTransactionRule.maturitySeconds)
            .sort((a, b) => (a.id < b.id ? -1 : 1));

        return orphans.map((b) => ({
            ruleId: OrphanBalanceTransactionRule.id,
            subjectType: 'settlement' as const,
            subjectId: b.id,
            severity: 'high' as const,
            exposureMinor: abs(b.netMinor),
            currency: b.currency,
            expected: {source_object_present: true, source_id: b.sourceId},
            actual: {source_object_present: false},
            evidence: {balance_transaction_id: b.id, type: b.type, source_id: b.sourceId},
            narrative: `Balance transaction ${b.id} of type ${b.type} references ${b.sourceId}, which has not been ingested. The local ledger is incomplete for this payout.`,
        }));
    },
};

/**
 * The classifier returns `unclassified` rather than guessing. That decision only pays off if the
 * unclassified charge surfaces here, because a settlement row derived from a wrong charge type
 * would be quietly wrong everywhere it is read.
 */
export const UnclassifiedChargeRule: Rule = {
    id: 'L1.CLASSIFY.UNKNOWN',
    name: 'Unclassified charge',
    description: 'A charge whose Connect shape matches no known charge type cannot be settled correctly.',
    layer: 1,
    severity: 'high',
    maturitySeconds: 1800,
    mode: 'both',
    defaultParameters: {min_confidence: 0.7},

    evaluate(snapshot, params) {
        const minConfidence = typeof params['min_confidence'] === 'number' ? params['min_confidence'] : 0.7;

        return snapshot.charges
            .filter((c) => c.chargeType === 'unclassified' || c.chargeTypeConfidence < minConfidence)
            .filter((c) => ageSeconds(snapshot.asOf, c.createdAt) >= UnclassifiedChargeRule.maturitySeconds)
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .map((c) => ({
                ruleId: UnclassifiedChargeRule.id,
                subjectType: 'charge' as const,
                subjectId: c.id,
                severity: 'high' as const,
                exposureMinor: c.amountMinor,
                currency: c.currency,
                expected: {charge_type: 'direct | destination | separate', min_confidence: minConfidence},
                actual: {charge_type: c.chargeType, confidence: c.chargeTypeConfidence},
                evidence: {
                    charge_id: c.id,
                    on_behalf_of: c.onBehalfOf,
                    transfer_destination: c.transferDestination,
                    transfer_id: c.transferId,
                    source_transfer_id: c.sourceTransferId,
                    application_fee_id: c.applicationFeeId,
                },
                narrative: `Charge ${c.id} could not be classified with confidence (${c.chargeType}, ${c.chargeTypeConfidence}). Its settlement figures cannot be trusted until the shape is understood.`,
            }));
    },
};

/**
 * A dispute lands on the platform even when the funds already reached the merchant, so a dispute
 * without a locally known charge means the platform is carrying a liability it cannot attribute.
 */
export const DisputeWithoutChargeRule: Rule = {
    id: 'L1.DISPUTE.NO_CHARGE',
    name: 'Dispute without charge',
    description: 'Every dispute must reference a charge that exists in the local projection.',
    layer: 1,
    severity: 'critical',
    maturitySeconds: 900,
    mode: 'transactional',
    defaultParameters: {},

    evaluate(snapshot) {
        const chargeIds = new Set(snapshot.charges.map((c) => c.id));
        return snapshot.disputes
            .filter((d) => !chargeIds.has(d.chargeId))
            .filter((d) => ageSeconds(snapshot.asOf, d.createdAt) >= DisputeWithoutChargeRule.maturitySeconds)
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .map((d) => ({
                ruleId: DisputeWithoutChargeRule.id,
                subjectType: 'charge' as const,
                subjectId: d.chargeId,
                severity: 'critical' as const,
                exposureMinor: d.amountMinor,
                currency: d.currency,
                expected: {charge_present: true},
                actual: {charge_present: false, dispute_status: d.status},
                evidence: {dispute_id: d.id, charge_id: d.chargeId, reason: d.reason},
                narrative: `Dispute ${d.id} for ${Money.of(d.amountMinor, d.currency).format()} references charge ${d.chargeId}, which is not present locally. The liability cannot be attributed to a merchant.`,
            }));
    },
};

/**
 * A connected account whose balance transactions net negative over the window is a platform
 * liability: Stripe will recover the shortfall from the platform if the merchant cannot cover it.
 */
export const NegativeBalanceRule: Rule = {
    id: 'L1.ACCOUNT.NEGATIVE_BALANCE',
    name: 'Connected account negative balance',
    description: 'A connected account whose net movement is negative exposes the platform to recovery.',
    layer: 1,
    severity: 'high',
    maturitySeconds: 86_400,
    mode: 'aggregate',
    defaultParameters: {threshold_minor: 0},

    evaluate(snapshot, params) {
        if (snapshot.stripeAccountId === snapshot.platformAccountId) return [];

        const currency = snapshot.accountState.defaultCurrency ?? snapshot.payout?.currency ?? 'USD';
        const net = Money.sum(
            snapshot.balanceTransactions
                .filter((b) => b.currency === currency)
                .map((b) => Money.of(b.netMinor, currency)),
            currency,
        );
        const threshold = bigintParam(params, 'threshold_minor', 0n);
        if (net.minor >= -threshold) return [];

        return [
            {
                ruleId: NegativeBalanceRule.id,
                subjectType: 'account',
                subjectId: snapshot.stripeAccountId,
                severity: 'high',
                exposureMinor: abs(net.minor),
                currency,
                expected: {net_minor_at_least: (-threshold).toString()},
                actual: {net_minor: net.toMinorString()},
                evidence: {
                    stripe_account_id: snapshot.stripeAccountId,
                    window_start: snapshot.windowStart,
                    window_end: snapshot.windowEnd,
                    transaction_count: snapshot.balanceTransactions.length,
                },
                narrative: `Connected account ${snapshot.accountState.displayName ?? snapshot.stripeAccountId} is net ${net.format()} over this window. A negative balance is recovered from the platform.`,
            },
        ];
    },
};

export const LAYER_1_RULES: readonly Rule[] = [
    PayoutChecksumRule,
    RefundExceedsChargeRule,
    OrphanBalanceTransactionRule,
    UnclassifiedChargeRule,
    DisputeWithoutChargeRule,
    NegativeBalanceRule,
];
