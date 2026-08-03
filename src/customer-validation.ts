// SPDX-License-Identifier: GPL-3.0-only

import type {
  ExpressionHostConfigurationFailure,
  FieldValidationRule,
  JsonValue,
  ProductDefinition,
} from "@elqora/dgp-spec";
import { createProductInterpreter } from "@elqora/dgp-core";

import type { ExpressionExecutor } from "./expression.js";
import type { OrderingInputState } from "./store.js";

export interface CustomerInputIssue {
  field_id: string;
  code: string;
  message: string;
  rule_index: number | null;
}

export type CustomerValidationResult =
  | { ok: true; issues: [] }
  | { ok: false; kind: "customer_input"; issues: CustomerInputIssue[] }
  | { ok: false; kind: "host_configuration"; failure: ExpressionHostConfigurationFailure };

function equal(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function testRule(actual: JsonValue, rule: FieldValidationRule): boolean {
  switch (rule.op) {
    case "eq": return rule.value !== undefined && equal(actual, rule.value);
    case "neq": return rule.value !== undefined && !equal(actual, rule.value);
    case "gt": return typeof actual === "number" && typeof rule.value === "number" && actual > rule.value;
    case "gte": return typeof actual === "number" && typeof rule.value === "number" && actual >= rule.value;
    case "lt": return typeof actual === "number" && typeof rule.value === "number" && actual < rule.value;
    case "lte": return typeof actual === "number" && typeof rule.value === "number" && actual <= rule.value;
    case "between": return typeof actual === "number" && rule.min !== undefined && rule.max !== undefined && actual >= rule.min && actual <= rule.max;
    case "in": return rule.values?.some((value) => equal(actual, value)) === true;
    case "nin": return rule.values?.every((value) => !equal(actual, value)) === true;
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    case "match": {
      if (typeof actual !== "string" || rule.pattern === undefined) return false;
      try { return new RegExp(rule.pattern, rule.pattern_flags).test(actual); } catch { return false; }
    }
  }
}

function missing(value: JsonValue, selected: readonly string[]): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0)
    ? selected.length === 0
    : false;
}

export function validateCustomerInput(
  definition: ProductDefinition,
  filterId: string,
  state: Readonly<OrderingInputState>,
  selectedTriggerIds: readonly string[],
  executor: ExpressionExecutor,
): CustomerValidationResult {
  const interpreter = createProductInterpreter(definition);
  const visibility = interpreter.resolveVisibility(filterId, selectedTriggerIds);
  const issues: CustomerInputIssue[] = [];
  for (const fieldId of visibility.fieldIds) {
    const field = interpreter.index.getField(fieldId);
    if (field === undefined) continue;
    const value = state.values[fieldId] ?? null;
    const selected = state.selections[fieldId] ?? [];
    if (field.required === true && missing(value, selected)) {
      issues.push({ field_id: fieldId, code: "required", message: `${field.label} is required.`, rule_index: null });
    }
    for (const [index, rule] of (field.validation ?? []).entries()) {
      let actual: JsonValue = value;
      if (rule.value_by === "length") actual = typeof value === "string" || Array.isArray(value) ? value.length : 0;
      if (rule.value_by === "eval") {
        const execution = executor.execute(rule.expression, { value, values: Object.values(state.values) }, `/fields/${fieldId}/validation/${index}/expression`);
        if (!execution.ok) return { ok: false, kind: "host_configuration", failure: execution.failure };
        actual = execution.value;
      }
      if (!testRule(actual, rule)) {
        issues.push({
          field_id: fieldId,
          code: rule.code ?? "validation_failed",
          message: rule.message ?? `${field.label} is invalid.`,
          rule_index: index,
        });
      }
    }
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, kind: "customer_input", issues };
}
