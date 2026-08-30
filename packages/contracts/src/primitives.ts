import {z} from 'zod';

/**
 * Money crosses every boundary as a decimal string in minor units plus an ISO-4217 code.
 * BIGINT exceeds Number.MAX_SAFE_INTEGER and JSON numbers are IEEE 754 doubles, so a
 * number here would be a silent corruption bug rather than a rounding inconvenience.
 */
export const MinorAmount = z
    .string()
    .regex(/^-?\d{1,19}$/, 'minor amount must be an integer string');

export const CurrencyCode = z
    .string()
    .length(3)
    .regex(/^[A-Za-z]{3}$/)
    .transform((v) => v.toUpperCase());

export const MoneySchema = z.object({
    amount_minor: MinorAmount,
    currency: CurrencyCode,
});
export type Money = z.infer<typeof MoneySchema>;

export const Uuid = z.string().uuid();
export const IsoDateTime = z.string();

export const ChargeTypeSchema = z.enum(['direct', 'destination', 'separate', 'unclassified']);
export type ChargeType = z.infer<typeof ChargeTypeSchema>;

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

export const ExceptionStatusSchema = z.enum(['open', 'investigating', 'resolved', 'ignored']);
export type ExceptionStatus = z.infer<typeof ExceptionStatusSchema>;

export const MatchTierSchema = z.enum(['exact', 'strong', 'heuristic', 'unmatched']);
export type MatchTier = z.infer<typeof MatchTierSchema>;

export const SettlementStatusSchema = z.enum([
    'pending',
    'settled',
    'partially_refunded',
    'refunded',
    'disputed',
    'reversed',
]);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const RunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'superseded']);
export const RunModeSchema = z.enum(['transactional', 'aggregate']);
export const RunScopeSchema = z.enum(['payout', 'window', 'platform']);

export const RoleSchema = z.enum(['admin', 'member', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

/** Cursor pagination only. OFFSET at page 4000 is a table scan the operator never sees. */
export const CursorQuerySchema = z.object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function pageSchema<T extends z.ZodType>(item: T) {
    return z.object({
        data: z.array(item),
        next_cursor: z.string().nullable(),
        total_estimate: z.number().int().nullable().optional(),
    });
}

/** RFC 9457 problem details. Every non-2xx response in the system takes this shape. */
export const ProblemSchema = z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    trace_id: z.string().optional(),
    errors: z.record(z.string(), z.array(z.string())).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;
