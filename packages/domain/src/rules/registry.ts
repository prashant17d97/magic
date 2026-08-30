import type {Rule, RuleSettings} from './types.js';
import {LAYER_1_RULES} from './layer1/index.js';
import {LAYER_2_RULES} from './layer2/index.js';
import {LAYER_3_RULES} from './layer3/index.js';
import {checksumOf} from './checksum.js';

/**
 * The registry is ordered and frozen. Rules run in a fixed sequence so a run's exception set is
 * reproducible down to insertion order, and the version checksum changes the moment a rule's
 * identity, severity, maturity or defaults change — which is what makes a rule version meaningful.
 */
export const ALL_RULES: readonly Rule[] = Object.freeze([
    ...LAYER_1_RULES,
    ...LAYER_2_RULES,
    ...LAYER_3_RULES,
]);

const BY_ID = new Map(ALL_RULES.map((rule) => [rule.id, rule]));

export function ruleById(id: string): Rule | undefined {
    return BY_ID.get(id);
}

export function rulesForLayer(layer: 1 | 2 | 3): readonly Rule[] {
    return ALL_RULES.filter((rule) => rule.layer === layer);
}

export function defaultSettings(rule: Rule): RuleSettings {
    return {
        enabled: true,
        severity: rule.severity,
        maturitySeconds: rule.maturitySeconds,
        parameters: rule.defaultParameters,
    };
}

/** A serialisable snapshot of the registry, stored verbatim on every `rule_versions` row. */
export function ruleSetDefinition() {
    return ALL_RULES.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        layer: rule.layer,
        charge_types: rule.chargeTypes ? [...rule.chargeTypes] : null,
        severity: rule.severity,
        maturity_seconds: rule.maturitySeconds,
        mode: rule.mode,
        default_parameters: rule.defaultParameters,
    }));
}

export function ruleSetChecksum(): string {
    return checksumOf(ruleSetDefinition());
}
