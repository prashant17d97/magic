import {abs, Money} from '../../money/money.js';
import type {ExpectedPosting, LedgerContext} from '../../ledger/types.js';

export interface PostingComparison {
    readonly posting: ExpectedPosting;
    readonly actualMinor: bigint | null;
    readonly deltaMinor: bigint;
    readonly status: 'matched' | 'missing' | 'mismatched';
}

/**
 * The one comparator. Every charge type funnels through it, so the difference between a direct
 * charge and a destination charge is a different list of expected postings, never a different
 * checking routine. Adding a fourth Connect flow is a mapper plus a test, nothing more.
 */
export function comparePostings(
    expected: readonly ExpectedPosting[],
    ctx: LedgerContext,
): PostingComparison[] {
    return expected.map((posting) => {
        const actual = findActual(posting, ctx);

        if (actual === null) {
            return {
                posting,
                actualMinor: null,
                deltaMinor: posting.amountMinor,
                status: posting.required ? ('missing' as const) : ('matched' as const),
            };
        }

        const delta = actual - posting.amountMinor;
        return {
            posting,
            actualMinor: actual,
            deltaMinor: delta,
            status: abs(delta) <= posting.toleranceMinor ? ('matched' as const) : ('mismatched' as const),
        };
    });
}

function findActual(posting: ExpectedPosting, ctx: LedgerContext): bigint | null {
    switch (posting.kind) {
        case 'customer_gross': {
            const txn = ctx.balanceTransactions.find((b) => b.type === 'charge' && b.sourceId === posting.sourceId);
            return txn ? txn.grossMinor : null;
        }
        case 'application_fee': {
            const fee = ctx.applicationFees.find((f) => f.id === posting.sourceId || f.chargeId === posting.sourceId);
            return fee ? fee.amountMinor - fee.amountRefundedMinor : null;
        }
        case 'transfer_to_merchant': {
            const transfer = ctx.transfers.find(
                (t) => t.id === posting.sourceId || t.sourceTransaction === posting.sourceId,
            );
            return transfer ? transfer.amountMinor - transfer.amountReversedMinor : null;
        }
        case 'transfer_reversal': {
            const reversal = ctx.reversals.find((r) => r.id === posting.sourceId || r.transferId === posting.sourceId);
            return reversal ? reversal.amountMinor : null;
        }
        case 'refund': {
            const refund = ctx.refunds.find((r) => r.id === posting.sourceId || r.chargeId === posting.sourceId);
            return refund ? refund.amountMinor : null;
        }
        case 'processing_fee':
        case 'merchant_net': {
            const txn = ctx.balanceTransactions.find((b) => b.sourceId === posting.sourceId);
            if (!txn) return null;
            return posting.kind === 'processing_fee' ? txn.feeMinor : txn.netMinor;
        }
    }
}

export function describeComparison(comparison: PostingComparison): string {
    const expected = Money.of(comparison.posting.amountMinor, comparison.posting.currency);
    if (comparison.status === 'missing') return `expected ${expected.format()}, nothing posted`;
    const actual = Money.of(comparison.actualMinor ?? 0n, comparison.posting.currency);
    return `expected ${expected.format()}, actual ${actual.format()}`;
}
