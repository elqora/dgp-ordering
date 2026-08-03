// SPDX-License-Identifier: GPL-3.0-only

import type {
  ExpressionHostConfigurationFailure,
  JsonValue,
  OrderSnapshotQuantitySource,
  ProductDefinition,
  QuantityRule,
} from "@elqora/dgp-spec";
import { createProductInterpreter } from "@elqora/dgp-core";

import type { ExpressionExecutor } from "./expression.js";
import type { OrderingInputState } from "./store.js";

export type QuantityResolution =
  | { ok: true; quantity: number; source: OrderSnapshotQuantitySource }
  | { ok: false; failure: ExpressionHostConfigurationFailure };

function numericValue(value: JsonValue, rule: QuantityRule): number | undefined {
  if (rule.value_by === "length") {
    if (typeof value === "string" || Array.isArray(value)) return value.length;
    return undefined;
  }
  if (rule.value_by === "value") {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

function transform(value: number | undefined, rule: QuantityRule): number | undefined {
  let result = value;
  if (result === undefined || !Number.isFinite(result)) result = rule.fallback;
  if (result === undefined || !Number.isFinite(result)) return undefined;
  result *= rule.multiply ?? 1;
  if (rule.clamp?.min !== undefined) result = Math.max(rule.clamp.min, result);
  if (rule.clamp?.max !== undefined) result = Math.min(rule.clamp.max, result);
  return Number.isFinite(result) ? result : undefined;
}

export function resolveQuantity(
  definition: ProductDefinition,
  filterId: string,
  state: Readonly<OrderingInputState>,
  selectedTriggerIds: readonly string[],
  hostDefault: number,
  executor: ExpressionExecutor,
): QuantityResolution {
  const interpreter = createProductInterpreter(definition);
  const visibility = interpreter.resolveVisibility(filterId, selectedTriggerIds);
  for (const fieldId of visibility.fieldIds) {
    const field = interpreter.index.getField(fieldId);
    if (field?.quantity === undefined) continue;
    const raw = state.values[fieldId] ?? null;
    let resolved: number | undefined;
    if (field.quantity.value_by === "eval") {
      const execution = executor.execute(
        field.quantity.expression,
        { value: raw, values: Object.values(state.values) },
        `/fields/${fieldId}/quantity/expression`,
      );
      if (!execution.ok) return execution;
      if (typeof execution.value !== "number" || !Number.isFinite(execution.value)) {
        return {
          ok: false,
          failure: {
            kind: "host_configuration",
            code: "expression_result_invalid",
            path: `/fields/${fieldId}/quantity/expression`,
            message: "A quantity expression must return a finite number.",
            meta: {},
          },
        };
      }
      resolved = execution.value;
    } else {
      resolved = numericValue(raw, field.quantity);
    }
    const quantity = transform(resolved, field.quantity);
    if (quantity !== undefined) {
      return {
        ok: true,
        quantity,
        source: {
          kind: "field_rule",
          node_id: fieldId,
          rule: field.quantity,
          defaulted_from_host: false,
        },
      };
    }
  }

  for (const triggerId of selectedTriggerIds) {
    const option = interpreter.index.getOption(triggerId);
    if (option?.quantity_default !== undefined) {
      return { ok: true, quantity: option.quantity_default, source: { kind: "option_default", node_id: triggerId, rule: null, defaulted_from_host: false } };
    }
    const field = interpreter.index.getField(triggerId);
    if (field?.quantity_default !== undefined) {
      return { ok: true, quantity: field.quantity_default, source: { kind: "field_default", node_id: triggerId, rule: null, defaulted_from_host: false } };
    }
  }
  const filter = interpreter.index.getFilter(filterId);
  if (filter?.quantity_default !== undefined) {
    return { ok: true, quantity: filter.quantity_default, source: { kind: "filter_default", node_id: filterId, rule: null, defaulted_from_host: false } };
  }
  return {
    ok: true,
    quantity: hostDefault,
    source: { kind: "host_default", node_id: null, rule: null, defaulted_from_host: true },
  };
}
