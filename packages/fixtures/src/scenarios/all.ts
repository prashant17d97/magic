import type { Scenario } from '../types.js';
import { CORE_SCENARIOS } from './index.js';
import { MONEY_LOSS_SCENARIOS } from './money-loss.js';
import { AGGREGATE_AND_ORDER_SCENARIOS } from './aggregate-and-orders.js';

/**
 * The corpus. Because every scenario is deterministic and carries its own expectation, this
 * doubles as the demo script: the system catches fourteen classes of error before anyone points
 * it at a client's real account.
 */
export const SCENARIOS: readonly Scenario[] = [
  ...CORE_SCENARIOS,
  ...MONEY_LOSS_SCENARIOS,
  ...AGGREGATE_AND_ORDER_SCENARIOS,
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export { CORE_SCENARIOS, MONEY_LOSS_SCENARIOS, AGGREGATE_AND_ORDER_SCENARIOS };
