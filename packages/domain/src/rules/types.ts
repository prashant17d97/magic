import type {ChargeType, Severity} from '@magic/contracts';
import type {Finding, ReconSnapshot} from '../ledger/types.js';

export type RuleParams = Readonly<Record<string, unknown>>;

export interface RuleSettings {
    readonly enabled: boolean;
    readonly severity: Severity;
    readonly maturitySeconds: number;
    readonly parameters: RuleParams;
}

export interface Rule {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly layer: 1 | 2 | 3;
    readonly chargeTypes?: readonly ChargeType[];
    readonly severity: Severity;
    readonly maturitySeconds: number;
    readonly mode: 'transactional' | 'aggregate' | 'both';
    readonly defaultParameters: RuleParams;

    evaluate(snapshot: ReconSnapshot, params: RuleParams): Finding[];
}

export function numberParam(params: RuleParams, key: string, fallback: number): number {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function bigintParam(params: RuleParams, key: string, fallback: bigint): bigint {
    const value = params[key];
    if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
    return fallback;
}

/** Seconds elapsed between an object's creation and the snapshot instant. Rules never read a clock. */
export function ageSeconds(asOf: string, createdAt: string): number {
    return Math.floor((Date.parse(asOf) - Date.parse(createdAt)) / 1000);
}
