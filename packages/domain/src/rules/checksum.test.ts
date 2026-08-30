import {describe, expect, it} from 'vitest';
import {canonicalise, checksumOf, fingerprint} from './checksum.js';

describe('canonicalise', () => {
    it('is insensitive to key insertion order', () => {
        expect(canonicalise({b: 1, a: 2})).toBe(canonicalise({a: 2, b: 1}));
    });

    it('renders BigInt as a decimal string rather than throwing', () => {
        expect(canonicalise({amount: 9_007_199_254_740_993n})).toBe('{"amount":"9007199254740993"}');
    });

    it('drops undefined members so an optional field cannot change the checksum', () => {
        expect(checksumOf({a: 1, b: undefined})).toBe(checksumOf({a: 1}));
    });

    it('preserves array order because order is meaningful in a posting list', () => {
        expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
    });
});

describe('fingerprint', () => {
    it('is stable for the same rule, subject and scope', () => {
        expect(fingerprint('L1.PAYOUT.CHECKSUM', 'po_1', 'payout:po_1')).toBe(
            fingerprint('L1.PAYOUT.CHECKSUM', 'po_1', 'payout:po_1'),
        );
    });

    it('separates the same rule across different scopes', () => {
        expect(fingerprint('L1.PAYOUT.CHECKSUM', 'po_1', 'payout:po_1')).not.toBe(
            fingerprint('L1.PAYOUT.CHECKSUM', 'po_1', 'payout:po_2'),
        );
    });
});
