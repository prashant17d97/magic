import {z} from 'zod';
import {
    ChargeTypeSchema,
    CurrencyCode,
    CursorQuerySchema,
    IsoDateTime,
    MatchTierSchema,
    MinorAmount,
    pageSchema,
    RoleSchema,
    RunModeSchema,
    RunScopeSchema,
    RunStatusSchema,
    SettlementStatusSchema,
    SeveritySchema,
    Uuid,
} from './primitives.js';

export const HealthSummarySchema = z.object({
    completeness: z.object({
        percent: z.number(),
        accounts_checked: z.number().int(),
        total_drift: z.number().int(),
        accounts_with_drift: z.number().int(),
        last_checked_at: IsoDateTime.nullable(),
    }),
    ingestion: z.object({
        lag_p95_seconds: z.number(),
        events_last_hour: z.number().int(),
        pending_events: z.number().int(),
        failed_events: z.number().int(),
    }),
    queues: z.object({
        total_depth: z.number().int(),
        dlq_depth: z.number().int(),
        by_queue: z.array(z.object({queue: z.string(), depth: z.number().int(), active: z.number().int()})),
    }),
    last_run: z
        .object({
            id: Uuid,
            finished_at: IsoDateTime.nullable(),
            objects_evaluated: z.number().int(),
            status: RunStatusSchema,
            checksum_delta_minor: MinorAmount.nullable(),
        })
        .nullable(),
    exposure: z.array(
        z.object({
            severity: SeveritySchema,
            currency: CurrencyCode,
            total_minor: MinorAmount,
            count: z.number().int(),
        }),
    ),
    trend: z.array(z.object({date: z.string(), opened: z.number().int(), resolved: z.number().int()})),
    accounts_needing_attention: z.array(
        z.object({
            stripe_account_id: z.string(),
            display_name: z.string().nullable(),
            reason: z.enum(['payouts_paused', 'charges_disabled', 'sync_failing', 'completeness_drift', 'negative_balance']),
            detail: z.string(),
            open_exceptions: z.number().int(),
            exposure_minor: MinorAmount.nullable(),
            currency: CurrencyCode.nullable(),
        }),
    ),
    recent_runs: z.array(
        z.object({
            id: Uuid,
            stripe_account_id: z.string(),
            account_display_name: z.string().nullable(),
            payout_id: z.string().nullable(),
            status: RunStatusSchema,
            checksum_delta_minor: MinorAmount.nullable(),
            currency: CurrencyCode.nullable(),
            exceptions_opened: z.number().int(),
            finished_at: IsoDateTime.nullable(),
        }),
    ),
});
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

export const RunQuerySchema = CursorQuerySchema.extend({
    account_id: z.string().optional(),
    status: RunStatusSchema.optional(),
    scope_type: RunScopeSchema.optional(),
});

export const RunListItemSchema = z.object({
    id: Uuid,
    stripe_account_id: z.string(),
    account_display_name: z.string().nullable(),
    scope_type: RunScopeSchema,
    payout_id: z.string().nullable(),
    mode: RunModeSchema,
    status: RunStatusSchema,
    rule_version: z.number().int(),
    objects_evaluated: z.number().int(),
    exceptions_opened: z.number().int(),
    exceptions_closed: z.number().int(),
    checksum_delta_minor: MinorAmount.nullable(),
    currency: CurrencyCode.nullable(),
    snapshot_checksum: z.string().nullable(),
    triggered_by: z.string(),
    started_at: IsoDateTime.nullable(),
    finished_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
});
export type RunListItem = z.infer<typeof RunListItemSchema>;
export const RunPageSchema = pageSchema(RunListItemSchema);

export const RunDetailSchema = RunListItemSchema.extend({
    payout_amount_minor: MinorAmount.nullable(),
    reconstructed_minor: MinorAmount.nullable(),
    balance_transaction_count: z.number().int(),
    error: z.string().nullable(),
    exceptions: z.array(
        z.object({
            id: Uuid,
            rule_id: z.string(),
            severity: SeveritySchema,
            narrative: z.string(),
            exposure_minor: MinorAmount.nullable(),
            currency: CurrencyCode.nullable(),
        }),
    ),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const CreateRunSchema = z.object({
    account_id: z.string().min(1),
    payout_id: z.string().optional(),
    mode: RunModeSchema.optional(),
});

export const SettlementQuerySchema = CursorQuerySchema.extend({
    account_id: z.string().optional(),
    charge_type: ChargeTypeSchema.optional(),
    status: SettlementStatusSchema.optional(),
    match_tier: MatchTierSchema.optional(),
    currency: CurrencyCode.optional(),
    q: z.string().max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

export const SettlementListItemSchema = z.object({
    id: Uuid,
    charge_id: z.string(),
    charge_type: ChargeTypeSchema,
    merchant_account_id: z.string(),
    merchant_display_name: z.string().nullable(),
    funds_holder_account_id: z.string(),
    currency: CurrencyCode,
    customer_gross_minor: MinorAmount,
    processing_fee_minor: MinorAmount,
    platform_revenue_minor: MinorAmount,
    merchant_net_minor: MinorAmount,
    refunded_minor: MinorAmount,
    settlement_status: SettlementStatusSchema,
    payout_id: z.string().nullable(),
    match_tier: MatchTierSchema.nullable(),
    match_confidence: z.string().nullable(),
    charged_at: IsoDateTime,
});
export type SettlementListItem = z.infer<typeof SettlementListItemSchema>;
export const SettlementPageSchema = pageSchema(SettlementListItemSchema);

export const SettlementDetailSchema = SettlementListItemSchema.extend({
    fee_bearer: z.string().nullable(),
    settled_at: IsoDateTime.nullable(),
    computed_at: IsoDateTime,
    charge_type_confidence: z.string().nullable(),
    charge_type_signals: z.record(z.string(), z.unknown()).nullable(),
    postings: z.array(
        z.object({
            account_id: z.string(),
            kind: z.string(),
            amount_minor: MinorAmount,
            currency: CurrencyCode,
            source: z.string(),
            actual: z.boolean(),
        }),
    ),
    linked_objects: z.array(z.object({label: z.string(), id: z.string(), kind: z.string()})),
    open_exceptions: z.array(
        z.object({id: Uuid, rule_id: z.string(), severity: SeveritySchema, narrative: z.string()}),
    ),
});
export type SettlementDetail = z.infer<typeof SettlementDetailSchema>;

export const AccountListItemSchema = z.object({
    id: Uuid,
    stripe_account_id: z.string(),
    display_name: z.string().nullable(),
    account_type: z.string().nullable(),
    country: z.string().nullable(),
    default_currency: CurrencyCode.nullable(),
    charges_enabled: z.boolean(),
    payouts_enabled: z.boolean(),
    requirements_disabled_reason: z.string().nullable(),
    synced_at: IsoDateTime.nullable(),
    completeness_drift: z.number().int(),
    open_exception_count: z.number().int(),
    open_exposure_minor: MinorAmount.nullable(),
});
export type AccountListItem = z.infer<typeof AccountListItemSchema>;
export const AccountPageSchema = pageSchema(AccountListItemSchema);

export const CompletenessPointSchema = z.object({
    object_type: z.string(),
    window_start: IsoDateTime,
    window_end: IsoDateTime,
    remote_count: z.number().int(),
    local_count: z.number().int(),
    drift: z.number().int(),
    checked_at: IsoDateTime,
});

export const RuleSettingSchema = z.object({
    rule_id: z.string(),
    name: z.string(),
    description: z.string(),
    layer: z.number().int(),
    charge_types: z.array(ChargeTypeSchema).nullable(),
    mode: z.string(),
    default_severity: SeveritySchema,
    default_maturity_seconds: z.number().int(),
    enabled: z.boolean(),
    severity: SeveritySchema,
    maturity_seconds: z.number().int(),
    parameters: z.record(z.string(), z.unknown()),
    raised_30d: z.number().int(),
    ignored_30d: z.number().int(),
    ignore_rate: z.number(),
});
export type RuleSetting = z.infer<typeof RuleSettingSchema>;

export const RulePatchSchema = z.object({
    enabled: z.boolean().optional(),
    severity: SeveritySchema.optional(),
    maturity_seconds: z.number().int().min(0).max(2_592_000).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
});

export const ExportRequestSchema = z.object({
    kind: z.enum(['exceptions', 'settlements', 'runs', 'audit']),
    format: z.enum(['csv', 'xlsx']),
    filters: z.record(z.string(), z.unknown()).default({}),
});

export const ExportSchema = z.object({
    id: Uuid,
    kind: z.string(),
    format: z.string(),
    status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']),
    row_count: z.number().int().nullable(),
    requested_by_name: z.string().nullable(),
    download_url: z.string().nullable(),
    expires_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
    error: z.string().nullable().optional(),
});
export type ExportRecord = z.infer<typeof ExportSchema>;
export const ExportPageSchema = pageSchema(ExportSchema);

export const AuditQuerySchema = CursorQuerySchema.extend({
    resource_type: z.string().optional(),
    resource_id: z.string().optional(),
    actor_user_id: Uuid.optional(),
    action: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

export const AuditEntrySchema = z.object({
    id: z.string(),
    actor_type: z.enum(['user', 'system', 'api']),
    actor_user_id: Uuid.nullable(),
    actor_name: z.string().nullable(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    ip_address: z.string().nullable(),
    request_id: z.string().nullable(),
    created_at: IsoDateTime,
});
export const AuditPageSchema = pageSchema(AuditEntrySchema);

export const MemberSchema = z.object({
    id: Uuid,
    user_id: Uuid,
    email: z.string(),
    display_name: z.string(),
    role: RoleSchema,
    account_scope: z.array(z.string()).nullable(),
    status: z.enum(['active', 'disabled']),
    last_login_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
});
export type Member = z.infer<typeof MemberSchema>;

export const MemberPatchSchema = z.object({
    role: RoleSchema.optional(),
    account_scope: z.array(z.string()).nullable().optional(),
});

export const SavedViewSchema = z.object({
    id: Uuid,
    name: z.string().min(1).max(80),
    resource: z.enum(['exceptions', 'settlements', 'runs']),
    query: z.record(z.string(), z.unknown()),
    shared: z.boolean(),
    owner_user_id: Uuid,
    created_at: IsoDateTime,
});
export const SavedViewCreateSchema = SavedViewSchema.pick({name: true, resource: true, query: true, shared: true});

export const DlqJobSchema = z.object({
    id: z.string(),
    original_queue: z.string(),
    job_key: z.string(),
    error_message: z.string(),
    failed_at: IsoDateTime,
    attempts: z.number().int(),
    payload: z.record(z.string(), z.unknown()),
});

export const SessionSchema = z.object({
    user: z.object({id: Uuid, email: z.string(), display_name: z.string()}),
    tenant: z.object({id: Uuid, slug: z.string(), display_name: z.string(), timezone: z.string()}),
    role: RoleSchema,
    account_scope: z.array(z.string()).nullable(),
    permissions: z.array(z.string()),
    available_tenants: z.array(z.object({id: Uuid, slug: z.string(), display_name: z.string(), role: RoleSchema})),
});
export type SessionPayload = z.infer<typeof SessionSchema>;

export const SignInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
});
