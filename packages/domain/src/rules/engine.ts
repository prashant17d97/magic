import type {Severity} from '@magic/contracts';
import type {Finding, ReconSnapshot} from '../ledger/types.js';
import {ALL_RULES} from './registry.js';
import {fingerprint} from './checksum.js';
import {ageSeconds, type Rule, type RuleSettings} from './types.js';

export interface EvaluatedFinding extends Finding {
    readonly layer: 1 | 2 | 3;
    readonly ruleVersion: number;
    readonly fingerprint: string;
    readonly scopeKey: string;
    readonly maturitySeconds: number;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly mode: string;
}

export interface EvaluationResult {
    readonly findings: readonly EvaluatedFinding[];
    readonly rulesEvaluated: readonly string[];
    readonly rulesSuppressed: readonly { ruleId: string; reason: string }[];
    readonly objectsEvaluated: number;
}

export interface EvaluateOptions {
    readonly ruleVersion: number;
    readonly settings: ReadonlyMap<string, RuleSettings>;
    readonly rules?: readonly Rule[];
}

/**
 * Suppression driven by account state, not by a hard-coded exemption list. An account with
 * payouts paused legitimately has no payout, and flagging it would burn the operator's trust in
 * week one — which is the failure mode the PRD names as the one that decides adoption.
 */
function suppressionReason(rule: Rule, snapshot: ReconSnapshot): string | null {
    const state = snapshot.accountState;

    if (!state.payoutsEnabled && rule.id.startsWith('L1.PAYOUT')) {
        return 'Payouts are disabled on this account, so a missing payout is expected.';
    }
    if (!state.chargesEnabled && rule.layer === 2) {
        return 'Charges are disabled on this account, so no new postings are expected.';
    }
    if (rule.mode !== 'both' && rule.mode !== snapshot.mode) {
        return `Rule runs in ${rule.mode} mode; this run is ${snapshot.mode}.`;
    }
    return null;
}

/**
 * Runs the three layers in order. A Layer 1 failure short-circuits the layers below it for the
 * same subject: if the ledger does not add up, an order-matching finding on the same charge is
 * noise, and stacking three findings on one broken object is how a queue loses credibility.
 */
export function evaluate(snapshot: ReconSnapshot, options: EvaluateOptions): EvaluationResult {
    const rules = options.rules ?? ALL_RULES;
    const evaluated: string[] = [];
    const suppressed: { ruleId: string; reason: string }[] = [];
    const findings: EvaluatedFinding[] = [];
    const failedSubjects = new Set<string>();

    for (const layer of [1, 2, 3] as const) {
        /**
         * Layer 3 is tenant-wide, so it runs only in the platform-scope pass.
         *
         * An order can be paid by a charge on any connected account, so neither a per-account
         * window nor a single payout holds enough context to judge it. Evaluating it in those
         * narrower runs raises the same order-side finding once per account and once per
         * deposit, which is how a queue teaches an operator to stop reading it.
         */
        if (layer === 3 && snapshot.scopeType !== 'platform') {
          suppressed.push({
            ruleId: 'L3.*',
            reason: 'Layer 3 is evaluated once per tenant on the platform-scope run.',
          });
          continue;
        }

        const layerFindings: EvaluatedFinding[] = [];

        for (const rule of rules.filter((r) => r.layer === layer)) {
            const settings = options.settings.get(rule.id);
            if (settings && !settings.enabled) {
                suppressed.push({ruleId: rule.id, reason: 'Disabled for this tenant.'});
                continue;
            }

            const reason = suppressionReason(rule, snapshot);
            if (reason !== null) {
                suppressed.push({ruleId: rule.id, reason});
                continue;
            }

            const parameters = {...rule.defaultParameters, ...(settings?.parameters ?? {})};
            const severity: Severity = settings?.severity ?? rule.severity;
            const maturitySeconds = settings?.maturitySeconds ?? rule.maturitySeconds;

            evaluated.push(rule.id);

            for (const finding of rule.evaluate(snapshot, parameters)) {
                if (layer > 1 && failedSubjects.has(finding.subjectId)) continue;

                layerFindings.push({
                    ...finding,
                    severity,
                    layer,
                    ruleVersion: options.ruleVersion,
                    scopeKey: snapshot.scopeKey,
                    fingerprint: fingerprint(finding.ruleId, finding.subjectId, snapshot.scopeKey),
                    maturitySeconds,
                    parameters,
                    mode: rule.mode,
                });
            }
        }

        for (const finding of layerFindings) {
            if (layer === 1) failedSubjects.add(finding.subjectId);
            findings.push(finding);
        }
    }

    return {
        findings: sortFindings(findings),
        rulesEvaluated: evaluated,
        rulesSuppressed: suppressed,
        objectsEvaluated:
            snapshot.charges.length +
            snapshot.balanceTransactions.length +
            snapshot.transfers.length +
            snapshot.refunds.length +
            snapshot.settlements.length +
            snapshot.orders.length,
    };
}

const SEVERITY_ORDER: Record<Severity, number> = {critical: 0, high: 1, medium: 2, low: 3};

/**
 * A total order over findings. Without one, two runs over the same data could differ only in row
 * order and still fail the byte-equality determinism test for no real reason.
 */
export function sortFindings(findings: readonly EvaluatedFinding[]): EvaluatedFinding[] {
    return [...findings].sort((a, b) => {
        if (a.layer !== b.layer) return a.layer - b.layer;
        const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (severity !== 0) return severity;
        if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
        return a.fingerprint < b.fingerprint ? -1 : 1;
    });
}

/** True when the rule's maturity window has elapsed for an object created at `createdAt`. */
export function isMature(snapshot: ReconSnapshot, createdAt: string, maturitySeconds: number): boolean {
    return ageSeconds(snapshot.asOf, createdAt) >= maturitySeconds;
}
