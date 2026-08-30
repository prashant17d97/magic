import {createHash} from 'node:crypto';

/**
 * Canonical serialisation with sorted keys and BigInt rendered as a decimal string. Two snapshots
 * built from the same rows produce the same bytes regardless of row order out of the database or
 * key insertion order in the assembling code — which is what the determinism test actually checks.
 */
export function canonicalise(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'bigint') return `"${value.toString()}"`;
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
    }
    return 'null';
}

export function checksumOf(value: unknown): string {
    return createHash('sha256').update(canonicalise(value)).digest('hex');
}

/** Stable identity for a finding across re-runs, so a resolved exception is never resurrected. */
export function fingerprint(ruleId: string, subjectId: string, scopeKey: string): string {
    return createHash('sha256').update(`${ruleId}|${subjectId}|${scopeKey}`).digest('hex');
}
