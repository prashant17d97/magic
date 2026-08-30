import {z} from "zod";
import {
    CurrencyCode,
    CursorQuerySchema,
    ExceptionStatusSchema,
    IsoDateTime,
    MinorAmount,
    pageSchema,
    SeveritySchema,
    Uuid,
} from './primitives.js';

/**
 * A repeated query-string key arrives as a scalar when sent once and an array when sent twice.
 * Normalising at the boundary means no consumer downstream has to handle both shapes.
 */
function asArray<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(item).optional(),
  );
}

export const ExceptionSortSchema = z.enum(['last_seen_at', 'severity', 'exposure_minor', 'first_seen_at']);

/**
 * Filters are an explicit allowlist rather than a filter DSL. An operator's queue view is a
 * known, finite set of questions, and a predictable query cost matters more than expressiveness.
 */
export const ExceptionQuerySchema = CursorQuerySchema.extend({
    status: asArray(ExceptionStatusSchema),
    severity: asArray(SeveritySchema),
    rule_id: z.string().max(120).optional(),
    account_id: z.string().max(120).optional(),
    assignee_id: Uuid.optional(),
    currency: CurrencyCode.optional(),
    layer: z.coerce.number().int().min(1).max(3).optional(),
    q: z.string().max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    sort: ExceptionSortSchema.default('last_seen_at'),
    direction: z.enum(['asc', 'desc']).default('desc'),
});
export type ExceptionQuery = z.input<typeof ExceptionQuerySchema>;
export type ParsedExceptionQuery = z.output<typeof ExceptionQuerySchema>;

export const ExceptionListItemSchema = z.object({
    id: Uuid,
    rule_id: z.string(),
    rule_name: z.string(),
    rule_version: z.number().int(),
    layer: z.number().int(),
    severity: SeveritySchema,
    status: ExceptionStatusSchema,
    stripe_account_id: z.string(),
    account_display_name: z.string().nullable(),
    subject_type: z.string(),
    subject_id: z.string(),
    exposure_minor: MinorAmount.nullable(),
    currency: CurrencyCode.nullable(),
    narrative: z.string(),
    assigned_to: Uuid.nullable(),
    assignee_name: z.string().nullable(),
    first_seen_at: IsoDateTime,
    last_seen_at: IsoDateTime,
});
export type ExceptionListItem = z.infer<typeof ExceptionListItemSchema>;

export const ExceptionPageSchema = pageSchema(ExceptionListItemSchema);
export type ExceptionPage = z.infer<typeof ExceptionPageSchema>;

export const ExceptionEventSchema = z.object({
    id: z.string(),
    from_status: ExceptionStatusSchema.nullable(),
    to_status: z.string(),
    actor_type: z.enum(['user', 'system']),
    actor_user_id: Uuid.nullable(),
    actor_name: z.string().nullable(),
    note: z.string().nullable(),
    created_at: IsoDateTime,
});

export const ExceptionDetailSchema = ExceptionListItemSchema.extend({
    scope_key: z.string(),
    fingerprint: z.string(),
    expected: z.record(z.string(), z.unknown()),
    actual: z.record(z.string(), z.unknown()),
    evidence: z.record(z.string(), z.unknown()),
    rule_trace: z.object({
        rule_id: z.string(),
        rule_version: z.number().int(),
        layer: z.number().int(),
        maturity_seconds: z.number().int(),
        evaluated_at: IsoDateTime,
        parameters: z.record(z.string(), z.unknown()),
        mode: z.string(),
    }),
    linked_objects: z.array(z.object({label: z.string(), id: z.string(), kind: z.string()})),
    matched_order: z
        .object({
            id: Uuid,
            external_order_id: z.string(),
            total_minor: MinorAmount,
            currency: CurrencyCode,
            tier: z.string()
        })
        .nullable(),
    history: z.array(ExceptionEventSchema),
    resolution_note: z.string().nullable(),
    resolved_at: IsoDateTime.nullable(),
});
export type ExceptionDetail = z.infer<typeof ExceptionDetailSchema>;

/** `ignored` and `resolved` both demand a note. A finding closed without a reason is not closed. */
export const ExceptionTransitionSchema = z
    .object({
        to: ExceptionStatusSchema,
        note: z.string().max(2000).optional(),
    })
    .refine((v) => !(v.to === 'resolved' || v.to === 'ignored') || String(v.note ?? '').trim().length >= 3, {
        message: 'A note is required when resolving or ignoring an exception.',
        path: ['note'],
    });
export type ExceptionTransition = z.infer<typeof ExceptionTransitionSchema>;

export const BulkIgnoreSchema = z.object({
    ids: z.array(Uuid).min(1).max(200),
    note: z.string().min(3).max(2000),
});

export const BulkAssignSchema = z.object({
    ids: z.array(Uuid).min(1).max(200),
    assignee_id: Uuid.nullable(),
});

export const ExceptionCountsSchema = z.object({
    by_status: z.record(z.string(), z.number().int()),
    by_severity: z.record(z.string(), z.number().int()),
    open_exposure: z.array(z.object({
        severity: SeveritySchema,
        currency: CurrencyCode,
        total_minor: MinorAmount,
        count: z.number().int()
    })),
});
export type ExceptionCounts = z.infer<typeof ExceptionCountsSchema>;
