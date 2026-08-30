import type {ChargeType} from '@magic/contracts';
import {Money} from '../../money/money.js';
import type {ChargeSnapshot, ExpectedPosting, LedgerContext} from '../../ledger/types.js';

/**
 * A mapper turns one charge into the postings that should exist if the Connect flow behaved.
 * This registry is the only place in the system that forks on charge type: the comparator below
 * it, `settlements`, matching, the console and the exports all stay charge-type agnostic.
 */
export interface PostingMapper {
    derive(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[];
}

function feeFor(charge: ChargeSnapshot, ctx: LedgerContext): Money {
    const fee = ctx.applicationFees.find((f) => f.chargeId === charge.id);
    if (fee) return Money.of(fee.amountMinor - fee.amountRefundedMinor, charge.currency);
    return Money.of(charge.amountMinor, charge.currency).percentBasisPoints(ctx.takeRateBasisPoints);
}

/**
 * Direct charges settle on the connected account's own ledger. The platform's only claim is the
 * application fee, which moves to the platform balance as a separate posting.
 */
export class DirectChargeMapper implements PostingMapper {
    derive(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[] {
        const gross = Money.of(charge.amountMinor, charge.currency);
        const fee = feeFor(charge, ctx);

        const postings: ExpectedPosting[] = [
            {
                kind: 'customer_gross',
                accountId: charge.stripeAccountId,
                amountMinor: gross.minor,
                currency: charge.currency,
                sourceId: charge.id,
                toleranceMinor: 0n,
                required: true,
            },
        ];

        if (!fee.isZero()) {
            postings.push({
                kind: 'application_fee',
                accountId: ctx.platformAccountId,
                amountMinor: fee.minor,
                currency: charge.currency,
                sourceId: charge.applicationFeeId ?? charge.id,
                toleranceMinor: 0n,
                required: charge.applicationFeeId !== null,
            });
        }

        return postings;
    }
}

/**
 * Destination charges settle on the platform ledger and Stripe moves the merchant's share by an
 * automatic transfer. The transfer is the posting most likely to be missing, so it is required.
 *
 * Reversals are netted out of the expectation. A charge that was refunded and correctly reversed
 * would otherwise read as a transfer shortfall, which is exactly the sort of confident-looking
 * false positive that costs a queue its credibility.
 */
export class DestinationChargeMapper implements PostingMapper {
    derive(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[] {
        const gross = Money.of(charge.amountMinor, charge.currency);
        const fee = feeFor(charge, ctx);
        const destination = charge.transferDestination ?? charge.onBehalfOf ?? charge.stripeAccountId;

        const declared =

          charge.transferDataAmountMinor !== null

            ? Money.of(charge.transferDataAmountMinor, charge.currency)

            : gross.minus(fee);


        const reversed = Money.sum(

          ctx.reversals

            .filter((r) => r.transferId === charge.transferId)

            .map((r) => Money.of(r.amountMinor, charge.currency)),

          charge.currency,

        );


        const outstanding = declared.minus(reversed);

        const transferAmount = outstanding.isNegative() ? Money.zero(charge.currency) : outstanding;

        return [
            {
                kind: 'customer_gross',
                accountId: ctx.platformAccountId,
                amountMinor: gross.minor,
                currency: charge.currency,
                sourceId: charge.id,
                toleranceMinor: 0n,
                required: true,
            },
            {
                kind: 'transfer_to_merchant',
                accountId: destination,
                amountMinor: transferAmount.minor,
                currency: charge.currency,
                sourceId: charge.transferId ?? charge.id,
                toleranceMinor: 0n,
                required: true,
            },
        ];
    }
}

/**
 * Separate charges and transfers frequently lack a `source_transaction`, so a per-charge transfer
 * posting cannot be asserted. The expectation is recorded as not required and the aggregate rule
 * carries the real check over the window.
 */
export class SeparateChargeMapper implements PostingMapper {
    derive(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[] {
        const gross = Money.of(charge.amountMinor, charge.currency);
        const fee = feeFor(charge, ctx);
        const linked = ctx.transfers.find((t) => t.sourceTransaction === charge.id);

        return [
            {
                kind: 'customer_gross',
                accountId: ctx.platformAccountId,
                amountMinor: gross.minor,
                currency: charge.currency,
                sourceId: charge.id,
                toleranceMinor: 0n,
                required: true,
            },
            {
                kind: 'transfer_to_merchant',
                accountId: linked?.destinationAccountId ?? charge.stripeAccountId,
                amountMinor: gross.minus(fee).minor,
                currency: charge.currency,
                sourceId: linked?.id ?? charge.id,
                toleranceMinor: 0n,
                required: linked !== undefined,
            },
        ];
    }
}

/** An unclassified charge has no derivable expectation. Layer 1 raises the finding instead. */
export class NullMapper implements PostingMapper {
    derive(): ExpectedPosting[] {
        return [];
    }
}

export const postingMappers: Record<ChargeType, PostingMapper> = {
    direct: new DirectChargeMapper(),
    destination: new DestinationChargeMapper(),
    separate: new SeparateChargeMapper(),
    unclassified: new NullMapper(),
};

export function deriveExpectedPostings(charge: ChargeSnapshot, ctx: LedgerContext): ExpectedPosting[] {
    return postingMappers[charge.chargeType].derive(charge, ctx);
}
