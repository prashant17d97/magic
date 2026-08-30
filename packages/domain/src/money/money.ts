/**
 * A currency-aware amount held in minor units. Every arithmetic operation asserts that both
 * operands share a currency, so a cross-currency addition fails at the point of the mistake
 * rather than surfacing as an unexplainable reconciliation delta three layers later.
 */
export class CurrencyMismatchError extends Error {
    constructor(left: string, right: string) {
        super(`Cannot combine amounts in ${left} and ${right}. Reconciliation is per settlement currency.`);
        this.name = 'CurrencyMismatchError';
    }
}

/** Currencies whose minor-unit exponent differs from the two-decimal default. */
const EXPONENT_OVERRIDES: Record<string, number> = {
    BIF: 0, CLP: 0, DJF: 0, GNF: 0, JPY: 0, KMF: 0, KRW: 0, MGA: 0, PYG: 0,
    RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
    BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function currencyExponent(currency: string): number {
    return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

export class Money {
    readonly minor: bigint;
    readonly currency: string;

    private constructor(minor: bigint, currency: string) {
        this.minor = minor;
        this.currency = currency;
    }

    static of(minor: bigint | number | string, currency: string): Money {
        return new Money(BigInt(minor), currency.toUpperCase());
    }

    static zero(currency: string): Money {
        return new Money(0n, currency.toUpperCase());
    }

    /** Sums a list, returning zero in `currency` when the list is empty. */
    static sum(items: readonly Money[], currency: string): Money {
        return items.reduce((acc, item) => acc.plus(item), Money.zero(currency));
    }

    plus(other: Money): Money {
        this.assertSame(other);
        return new Money(this.minor + other.minor, this.currency);
    }

    minus(other: Money): Money {
        this.assertSame(other);
        return new Money(this.minor - other.minor, this.currency);
    }

    negated(): Money {
        return new Money(-this.minor, this.currency);
    }

    abs(): Money {
        return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency);
    }

    /**
     * Applies a basis-point rate with half-up rounding away from zero. Half-up is chosen because
     * it matches how Stripe presents application-fee percentages, so an expected posting derived
     * here lines up with the figure the platform sees in its own dashboard.
     */
    percentBasisPoints(basisPoints: number): Money {
        const scaled = this.minor * BigInt(Math.round(basisPoints));
        const divisor = 10_000n;
        const negative = scaled < 0n;
        const magnitude = negative ? -scaled : scaled;
        const rounded = (magnitude * 2n + divisor) / (divisor * 2n);
        return new Money(negative ? -rounded : rounded, this.currency);
    }

    isZero(): boolean {
        return this.minor === 0n;
    }

    isNegative(): boolean {
        return this.minor < 0n;
    }

    equals(other: Money): boolean {
        return this.currency === other.currency && this.minor === other.minor;
    }

    compare(other: Money): number {
        this.assertSame(other);
        return this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1;
    }

    withinTolerance(other: Money, toleranceMinor: bigint): boolean {
        return this.minus(other).abs().minor <= toleranceMinor;
    }

    toMinorString(): string {
        return this.minor.toString();
    }

    toJSON(): { amount_minor: string; currency: string } {
        return {amount_minor: this.minor.toString(), currency: this.currency};
    }

    /**
     * Renders without `Intl` so the domain stays free of locale data and produces byte-identical
     * output on every machine, which the determinism test depends on.
     */
    format(): string {
        const exponent = currencyExponent(this.currency);
        const negative = this.minor < 0n;
        const digits = (negative ? -this.minor : this.minor).toString().padStart(exponent + 1, '0');
        const whole = digits.slice(0, digits.length - exponent) || '0';
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
        return `${negative ? '-' : ''}${grouped}${fraction} ${this.currency}`;
    }

    private assertSame(other: Money): void {
        if (this.currency !== other.currency) throw new CurrencyMismatchError(this.currency, other.currency);
    }
}

export function abs(value: bigint): bigint {
    return value < 0n ? -value : value;
}
