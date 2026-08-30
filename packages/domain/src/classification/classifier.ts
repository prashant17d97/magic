import type {ChargeType} from '@magic/contracts';

/**
 * The shape of a Stripe charge as it matters to charge-type inference. Only the Connect signals
 * appear here: the classifier deliberately cannot see amounts, so it can never be tempted to
 * guess a type from a number.
 */
export interface ClassifiableCharge {
    readonly id: string;
    readonly stripeAccountId: string;
    readonly platformAccountId: string;
    readonly onBehalfOf: string | null;
    readonly transferDestination: string | null;
    readonly transferId: string | null;
    readonly applicationFeeId: string | null;
    readonly sourceTransferId: string | null;
    readonly transferDataAmountMinor: bigint | null;
}

export interface Classification {
    readonly chargeType: ChargeType;
    readonly confidence: number;
    readonly signals: Readonly<Record<string, unknown>>;
    readonly reason: string;
}

/**
 * Inference runs strongest-signal-first and stops at the first conclusive shape.
 *
 * - A charge created on a connected account's own ledger is a direct charge; an application fee
 *   on top only tells us the platform takes a cut, not that the shape differs.
 * - A charge on the platform ledger carrying transfer data is a destination charge.
 * - A charge on the platform ledger with no transfer data, later linked by a standalone
 *   transfer, is separate charges and transfers.
 *
 * Anything that matches none of these returns `unclassified`, which raises an exception instead
 * of failing quietly. A wrong guess here would corrupt every settlement row downstream.
 */
export function classifyCharge(charge: ClassifiableCharge): Classification {
    const onConnectedLedger = charge.stripeAccountId !== charge.platformAccountId;
    const signals = {
        on_connected_ledger: onConnectedLedger,
        on_behalf_of: charge.onBehalfOf,
        transfer_destination: charge.transferDestination,
        transfer_id: charge.transferId,
        application_fee_id: charge.applicationFeeId,
        source_transfer_id: charge.sourceTransferId,
        has_transfer_data_amount: charge.transferDataAmountMinor !== null,
    } as const;

    if (onConnectedLedger && charge.sourceTransferId !== null) {
        return {
            chargeType: 'separate',
            confidence: 0.95,
            signals,
            reason:
                'Charge sits on the connected account ledger and carries a source_transfer, so the funds arrived by a standalone transfer.',
        };
    }

    if (onConnectedLedger) {
        return {
            chargeType: 'direct',
            confidence: charge.applicationFeeId ? 1.0 : 0.9,
            signals,
            reason: charge.applicationFeeId
                ? 'Charge is on the connected account ledger with an application fee: a direct charge with a platform take.'
                : 'Charge is on the connected account ledger with no platform transfer: a direct charge.',
        };
    }

    if (charge.transferDestination !== null) {
        return {
            chargeType: 'destination',
            confidence: charge.transferId ? 1.0 : 0.85,
            signals,
            reason: charge.transferId
                ? 'Charge is on the platform ledger with transfer_data.destination and a settled transfer: a destination charge.'
                : 'Charge is on the platform ledger with transfer_data.destination but the transfer has not settled yet.',
        };
    }

    if (charge.onBehalfOf !== null) {
        return {
            chargeType: 'destination',
            confidence: 0.7,
            signals,
            reason:
                'Charge is on the platform ledger with on_behalf_of but no transfer_data. Treated as a destination charge pending the transfer.',
        };
    }

    if (charge.transferId !== null) {
        return {
            chargeType: 'separate',
            confidence: 0.8,
            signals,
            reason:
                'Charge is on the platform ledger and a separate transfer references it: separate charges and transfers.',
        };
    }

    return {
        chargeType: 'unclassified',
        confidence: 0,
        signals,
        reason:
            'Charge is on the platform ledger with no destination, no on_behalf_of and no linked transfer. No Connect shape fits.',
    };
}
