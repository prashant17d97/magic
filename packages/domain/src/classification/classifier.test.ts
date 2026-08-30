import {describe, expect, it} from 'vitest';
import {type ClassifiableCharge, classifyCharge} from './classifier.js';

const PLATFORM = 'acct_platform';

function charge(overrides: Partial<ClassifiableCharge>): ClassifiableCharge {
    return {
        id: 'ch_test',
        stripeAccountId: PLATFORM,
        platformAccountId: PLATFORM,
        onBehalfOf: null,
        transferDestination: null,
        transferId: null,
        applicationFeeId: null,
        sourceTransferId: null,
        transferDataAmountMinor: null,
        ...overrides,
    };
}

describe('classifyCharge', () => {
    it('reads a charge on the connected ledger with an application fee as direct', () => {
        const result = classifyCharge(charge({stripeAccountId: 'acct_merchant', applicationFeeId: 'fee_1'}));
        expect(result.chargeType).toBe('direct');
        expect(result.confidence).toBe(1);
    });

    it('reads a platform charge with transfer_data as destination', () => {
        const result = classifyCharge(
            charge({transferDestination: 'acct_merchant', transferId: 'tr_1', transferDataAmountMinor: 900n}),
        );
        expect(result.chargeType).toBe('destination');
    });

    it('lowers confidence for a destination charge whose transfer has not settled', () => {
        const result = classifyCharge(charge({transferDestination: 'acct_merchant'}));
        expect(result.chargeType).toBe('destination');
        expect(result.confidence).toBeLessThan(1);
    });

    it('reads a connected-ledger charge with source_transfer as separate', () => {
        const result = classifyCharge(charge({stripeAccountId: 'acct_merchant', sourceTransferId: 'tr_9'}));
        expect(result.chargeType).toBe('separate');
    });

    it('returns unclassified rather than guessing when no Connect shape fits', () => {
        const result = classifyCharge(charge({}));
        expect(result.chargeType).toBe('unclassified');
        expect(result.confidence).toBe(0);
    });

    it('is deterministic across repeated calls', () => {
        const input = charge({stripeAccountId: 'acct_merchant', applicationFeeId: 'fee_1'});
        expect(JSON.stringify(classifyCharge(input))).toBe(JSON.stringify(classifyCharge(input)));
    });
});
