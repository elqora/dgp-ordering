// SPDX-License-Identifier: GPL-3.0-only

import type {
  HandlerService,
  ExpressionHostConfigurationFailure,
  JsonValue,
  OrderSnapshot,
  OrderSnapshotMode,
  OrderSnapshotUtility,
  ProductDefinition,
  ProductField,
  ServiceId,
  UtilityDefinition,
} from "@elqora/dgp-spec";
import { ORDER_SNAPSHOT_VERSION } from "@elqora/dgp-spec";
import { createProductInterpreter, walkFieldOptions } from "@elqora/dgp-core";

import { validateCustomerInput, type CustomerInputIssue } from "./customer-validation.js";
import { createBrowserJavaScriptExpressionExecutor, type ExpressionExecutor } from "./expression.js";
import { resolveQuantity } from "./quantity.js";
import { resolveOrderingSelection } from "./selection.js";
import type { OrderingInputState } from "./store.js";

export interface BuildOrderSnapshotOptions {
  definition: ProductDefinition;
  filter_id: string;
  trigger_ids?: readonly string[];
  state: Readonly<OrderingInputState>;
  services: readonly HandlerService[];
  mode?: OrderSnapshotMode;
  host_quantity_default?: number;
  host_min?: number;
  host_max?: number;
  built_at?: string;
  meta?: OrderSnapshot["meta"];
  expression_executor?: ExpressionExecutor;
  advisory_service_amounts?: Readonly<Record<string, number>>;
}

export type BuildOrderSnapshotResult =
  | { ok: true; snapshot: OrderSnapshot }
  | { ok: false; kind: "customer_input"; issues: CustomerInputIssue[] }
  | {
      ok: false;
      kind: "host_configuration";
      failure: OrderingHostConfigurationFailure;
    };

export type OrderingHostConfigurationFailure = ExpressionHostConfigurationFailure | {
  kind: "host_configuration";
  code: "ordering_configuration_invalid";
  path: string;
  message: string;
  meta: ExpressionHostConfigurationFailure["meta"];
};

function configurationFailure(path: string, message: string): BuildOrderSnapshotResult {
  return { ok: false, kind: "host_configuration", failure: { kind: "host_configuration", code: "ordering_configuration_invalid", path, message, meta: {} } };
}

function isJsonSafe(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonSafe(entry, active))
    : Object.getPrototypeOf(value) === Object.prototype
      && Object.values(value as Record<string, unknown>).every((entry) => isJsonSafe(entry, active));
  active.delete(value);
  return valid;
}

function pushUnique(target: string[], seen: Set<string>, values: Iterable<string>): void {
  for (const value of values) if (!seen.has(value)) { seen.add(value); target.push(value); }
}

function normalizedContext(options: BuildOrderSnapshotOptions): {
  triggerIds: string[];
  fieldIds: string[];
  selections: Record<string, string[]>;
} {
  const resolved = resolveOrderingSelection(
    options.definition,
    options.filter_id,
    options.trigger_ids ?? [],
    options.state.selections,
    { mode: options.mode ?? "prod" },
  );
  return { triggerIds: resolved.trigger_ids, fieldIds: resolved.visibility.fieldIds, selections: resolved.selections };
}

function nodeUtility(
  interpreter: ReturnType<typeof createProductInterpreter>,
  nodeId: string,
): { utility: UtilityDefinition; fieldId: string | undefined } | undefined {
  const node = interpreter.index.getNode(nodeId);
  if (node.kind === "field" && node.field.utility !== undefined) return { utility: node.field.utility, fieldId: node.id };
  if (node.kind === "option" && node.option.utility !== undefined) return { utility: node.option.utility, fieldId: node.field.id };
  return undefined;
}

function effectivePricingRole(
  interpreter: ReturnType<typeof createProductInterpreter>,
  nodeId: string,
): "base" | "utility" {
  const node = interpreter.index.getNode(nodeId);
  if (node.kind === "field") return node.field.pricing_role ?? "base";
  if (node.kind === "option") return node.option.pricing_role ?? node.field.pricing_role ?? "base";
  return "base";
}

function isServiceSelector(field: ProductField): boolean {
  return (field.button === true && field.service_id !== undefined)
    || walkFieldOptions(field).some(({ option }) => option.service_id !== undefined);
}

function numericUtilityValue(value: JsonValue, valueBy: "value" | "length" | undefined): number | undefined {
  if (valueBy === "length") return typeof value === "string" || Array.isArray(value) ? value.length : undefined;
  if (Array.isArray(value)) return numericUtilityValue(value[0] ?? null, "value");
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function serviceKey(id: ServiceId): string { return String(id); }

function isDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function buildOrderSnapshot(options: BuildOrderSnapshotOptions): BuildOrderSnapshotResult {
  const builtAt = options.built_at ?? new Date().toISOString();
  if (!isDateTime(builtAt)) return configurationFailure("/built_at", "The snapshot build timestamp must be a valid date-time string.");
  if (!Number.isFinite(options.host_quantity_default ?? 1) || (options.host_quantity_default ?? 1) <= 0) {
    return configurationFailure("/host_quantity_default", "The host quantity default must be finite and greater than zero.");
  }
  if (options.host_min !== undefined && !Number.isInteger(options.host_min)) return configurationFailure("/host_min", "The host minimum must be an integer.");
  if (options.host_max !== undefined && !Number.isInteger(options.host_max)) return configurationFailure("/host_max", "The host maximum must be an integer.");
  if (!isJsonSafe(options.meta ?? {})) return configurationFailure("/meta", "Snapshot meta must be JSON-compatible.");
  if (Object.values(options.advisory_service_amounts ?? {}).some((amount) => !Number.isFinite(amount))) {
    return configurationFailure("/advisory_service_amounts", "Advisory service amounts must be finite.");
  }
  const interpreter = createProductInterpreter(options.definition);
  if (interpreter.index.getFilter(options.filter_id) === undefined) {
    return configurationFailure("/filter_id", "The active filter must exist in the published definition.");
  }
  const executor = options.expression_executor ?? createBrowserJavaScriptExpressionExecutor();
  const context = normalizedContext(options);
  const customer = validateCustomerInput(
    options.definition,
    options.filter_id,
    options.state,
    context.triggerIds,
    executor,
    options.mode ?? "prod",
  );
  if (!customer.ok) {
    return customer.kind === "host_configuration"
      ? { ok: false, kind: customer.kind, failure: customer.failure }
      : { ok: false, kind: customer.kind, issues: customer.issues };
  }
  const quantity = resolveQuantity(
    options.definition,
    options.filter_id,
    options.state,
    context.triggerIds,
    options.host_quantity_default ?? 1,
    executor,
  );
  if (!quantity.ok) return { ok: false, kind: "host_configuration", failure: quantity.failure };

  const selectedNodes: string[] = [];
  const selectedSeen = new Set<string>();
  pushUnique(selectedNodes, selectedSeen, context.triggerIds);
  const selectedServices: Array<{ id: ServiceId; nodeId: string; index: number; rate: number }> = [];
  const serviceIdsByNode: Record<string, ServiceId[]> = {};
  const catalog = new Map(options.services.map((service) => [serviceKey(service.id), service]));
  for (const [index, nodeId] of selectedNodes.entries()) {
    if (effectivePricingRole(interpreter, nodeId) === "utility" || nodeUtility(interpreter, nodeId) !== undefined) continue;
    const serviceId = interpreter.serviceBindingForNode(nodeId);
    if (serviceId === undefined) continue;
    serviceIdsByNode[nodeId] = [serviceId];
    const rate = catalog.get(serviceKey(serviceId))?.rate;
    selectedServices.push({ id: serviceId, nodeId, index, rate: rate === null || rate === undefined ? Number.NEGATIVE_INFINITY : rate });
  }
  const serviceIds: ServiceId[] = [];
  const serviceSeen = new Set<string>();
  if (selectedServices.length > 0) {
    let primary = selectedServices[0]!;
    for (const candidate of selectedServices.slice(1)) if (candidate.rate > primary.rate) primary = candidate;
    for (const selected of [primary, ...selectedServices.filter((candidate) => candidate !== primary).sort((a, b) => a.index - b.index)]) {
      const key = serviceKey(selected.id);
      if (!serviceSeen.has(key)) { serviceSeen.add(key); serviceIds.push(selected.id); }
    }
  }
  if (serviceIds.length === 0) {
    const serviceId = interpreter.serviceBindingForNode(options.filter_id);
    if (serviceId !== undefined) {
      serviceIds.push(serviceId);
      serviceIdsByNode[options.filter_id] = [serviceId];
    }
  }

  const chosen = serviceIds.map((id) => catalog.get(serviceKey(id))).filter((service): service is HandlerService => service !== undefined);
  const baseAmounts = serviceIds.map((id) => options.advisory_service_amounts?.[serviceKey(id)] ?? catalog.get(serviceKey(id))?.rate ?? 0);
  const serviceTotal = baseAmounts.reduce((sum, value) => sum + value, 0);
  const utilities: OrderSnapshotUtility[] = [];
  const utilityNodeIds: string[] = [];
  const utilitySeen = new Set<string>();
  for (const fieldId of context.fieldIds) {
    const field = interpreter.index.getField(fieldId);
    if (field?.utility !== undefined && (field.pricing_role ?? "base") === "utility") {
      pushUnique(utilityNodeIds, utilitySeen, [fieldId]);
    }
    for (const optionId of context.selections[fieldId] ?? []) {
      if (effectivePricingRole(interpreter, optionId) === "utility" && nodeUtility(interpreter, optionId) !== undefined) {
        pushUnique(utilityNodeIds, utilitySeen, [optionId]);
      }
    }
  }
  for (const nodeId of utilityNodeIds) {
    const resolved = nodeUtility(interpreter, nodeId);
    if (resolved === undefined) continue;
    const definition = resolved.utility;
    const raw = resolved.fieldId === undefined ? null : options.state.values[resolved.fieldId] ?? null;
    const valueBy = definition.mode === "per_value" ? definition.value_by ?? "value" : undefined;
    const value = definition.mode === "per_value" ? numericUtilityValue(raw, valueBy) : undefined;
    if (definition.mode === "per_value" && value === undefined) {
      return {
        ok: false,
        kind: "customer_input",
        issues: [{ field_id: resolved.fieldId ?? nodeId, code: "utility_value_invalid", message: "The utility value must resolve to a finite number.", rule_index: null }],
      };
    }
    let baseAmount: number | null = null;
    if (definition.mode === "percent") {
      baseAmount = definition.percent_base === "base_service"
        ? (baseAmounts[0] ?? 0)
        : definition.percent_base === "all"
          ? serviceTotal + utilities.reduce((sum, utility) => sum + utility.advisory_amount, 0)
          : serviceTotal;
    }
    const amount = definition.mode === "flat" ? definition.rate
      : definition.mode === "per_quantity" ? definition.rate * quantity.quantity
        : definition.mode === "per_value" ? definition.rate * (value ?? 0)
          : (baseAmount ?? 0) * definition.rate / 100;
    if (!Number.isFinite(amount)) return configurationFailure(`/utilities/${nodeId}`, "The advisory utility calculation produced a non-finite result.");
    utilities.push({
      node_id: nodeId,
      mode: definition.mode,
      rate: definition.rate,
      percent_base: definition.percent_base ?? null,
      label: definition.label ?? null,
      inputs: {
        quantity: quantity.quantity,
        value: value ?? null,
        value_by: valueBy ?? null,
        base_amount: baseAmount,
      },
      advisory_amount: amount,
    });
  }

  const form: Record<string, JsonValue> = {};
  for (const fieldId of context.fieldIds) {
    const field = interpreter.index.getField(fieldId);
    if (field?.name !== undefined && field.button !== true && !isServiceSelector(field)) {
      const value = options.state.values[fieldId];
      if (value !== undefined) form[field.name] = value;
    }
  }
  const mins = chosen.map((service) => service.min);
  const maxes = chosen.map((service) => service.max);
  const minimum = mins.length > 0 ? Math.min(...mins) : options.host_min ?? 1;
  const maximum = maxes.length > 0 ? Math.max(...maxes) : options.host_max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
    return configurationFailure("/min", "Resolved quantity bounds must be integers with min less than or equal to max.");
  }
  return {
    ok: true,
    snapshot: {
      version: ORDER_SNAPSHOT_VERSION,
      mode: options.mode ?? "prod",
      built_at: builtAt,
      product_id: options.definition.id,
      definition_schema_version: options.definition.schema_version,
      selection: {
        filter_id: options.filter_id,
        trigger_ids: context.triggerIds,
        fields: context.fieldIds.map((fieldId) => ({
          field_id: fieldId,
          field_type: interpreter.index.getField(fieldId)?.type ?? "unknown",
          selected_option_ids: [...(context.selections[fieldId] ?? [])],
        })),
      },
      inputs: { form, selections: context.selections },
      quantity: quantity.quantity,
      quantity_source: quantity.source,
      min: minimum,
      max: maximum,
      service_ids: serviceIds,
      service_ids_by_node: serviceIdsByNode,
      fallbacks: options.definition.fallbacks,
      utilities,
      meta: options.meta ?? {},
    },
  };
}
