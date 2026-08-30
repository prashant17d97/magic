import {describe, expect, it} from 'vitest';
import {currencyExponent, CurrencyMismatchError, Money} from './money.js';

describe('Money', () => {
    it('refuses to combine differing currencies', () => {
        expect(() => Money.of(100n, 'USD').plus(Money.of(100n, 'EUR'))).toThrow(CurrencyMismatchError);
    });

    it('formats zero-decimal currencies without a fraction', () => {
        expect(Money.of(125000n, 'JPY').format()).toBe('125,000 JPY');
        expect(currencyExponent('JPY')).toBe(0);
    });

    it('formats three-decimal currencies with three places', () => {
        expect(Money.of(1234n, 'KWD').format()).toBe('1.234 KWD');
    });

    it('groups thousands and keeps the sign in front', () => {
        expect(Money.of(-123456789n, 'USD').format()).toBe('-1,234,567.89 USD');
    });

    it('rounds basis points half-up away from zero', () => {
        expect(Money.of(1000n, 'USD').percentBasisPoints(250).minor).toBe(25n);
        expect(Money.of(1005n, 'USD').percentBasisPoints(500).minor).toBe(50n);
        expect(Money.of(-1005n, 'USD').percentBasisPoints(500).minor).toBe(-50n);
    });

    it('survives amounts beyond Number.MAX_SAFE_INTEGER', () => {
        const huge = Money.of('9007199254740993', 'USD');
        expect(huge.plus(Money.of(1n, 'USD')).toMinorString()).toBe('9007199254740994');
    });

    it('compares within an explicit tolerance', () => {
        expect(Money.of(1000n, 'USD').withinTolerance(Money.of(1002n, 'USD'), 2n)).toBe(true);
        expect(Money.of(1000n, 'USD').withinTolerance(Money.of(1003n, 'USD'), 2n)).toBe(false);
    });

    it('sums an empty list to zero in the requested currency', () => {
        expect(Money.sum([], 'GBP').equals(Money.zero('GBP'))).toBe(true);
    });
});
