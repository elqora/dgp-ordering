// SPDX-License-Identifier: GPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  BrowserJavaScriptExpression,
  FieldValidationRule,
  HandlerService,
  JsonValue,
  ProductDefinition,
  ProductField,
} from "@elqora/dgp-spec";
import { Ajv } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  buildOrderSnapshot,
  createBrowserJavaScriptExpressionExecutor,
  createInputRegistry,
  createOrderingSession,
  createOrderingSessionFromSnapshot,
  hydrateOrderingInputState,
  normalizeExpressionInput,
  resolveOrderingSelection,
  resolveQuantity,
  validateCustomerInput,
} from "../src/index.js";

function product(fields: ProductField[] = []): ProductDefinition {
  return {
    id: "product",
    name: "Product",
    schema_version: "1",
    filters: [{ id: "root", label: "Root" }],
    fields,
    order_for_tags: {},
    includes_for_buttons: {},
    excludes_for_buttons: {},
    option_effects_for_buttons: {},
    value_effects_for_triggers: {},
    fallbacks: null,
    description: null,
    notices: [],
    meta: {},
  };
}

function field(overrides: Partial<ProductField> = {}): ProductField {
  return {
    id: "input",
    type: "text",
    label: "Input",
    name: "input",
    bind_id: "root",
    ...overrides,
  };
}

function service(id: number | string, rate: number | null, min = 1, max = 100): HandlerService {
  return {
    id,
    name: `Service ${id}`,
    description: null,
    category: null,
    rate,
    min,
    max,
    capabilities: {},
    meta: {},
    state: "enabled",
    state_reason: null,
  };
}

const executor = createBrowserJavaScriptExpressionExecutor();
const snapshotSchemaPath = fileURLToPath(import.meta.resolve(
  "@elqora/dgp-spec/schemas/order-snapshot.schema.json",
));
const ajv = new Ajv({ strict: false, allErrors: true });
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(ajv);
const validateSnapshotSchema = ajv.compile(JSON.parse(readFileSync(snapshotSchemaPath, "utf8")) as object);

describe("portable browser-expression conformance", () => {
  interface ExpressionCase {
    id: string;
    purpose: "customer_validation" | "quantity";
    expression: BrowserJavaScriptExpression | null;
    raw_input: { kind: "missing" } | { kind: "present"; value: JsonValue };
    expected: {
      ok: boolean;
      arguments: { value: JsonValue; values: JsonValue[] };
      value: JsonValue;
      failure_code: string | null;
    };
  }

  const fixturePath = fileURLToPath(import.meta.resolve(
    "@elqora/dgp-spec/fixtures/semantic/browser-javascript-expression-execution.json",
  ));
  const suite = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: ExpressionCase[] };

  for (const fixture of suite.cases.filter((entry) => entry.purpose === "customer_validation")) {
    it(`executes ${fixture.id}`, () => {
      const raw = fixture.raw_input.kind === "present" ? fixture.raw_input.value : undefined;
      const input = normalizeExpressionInput(raw);
      expect(input).toEqual(fixture.expected.arguments);
      const result = executor.execute(fixture.expression ?? undefined, input, "/fixture");
      if (fixture.expected.ok) expect(result).toEqual({ ok: true, value: fixture.expected.value });
      else expect(result).toMatchObject({ ok: false, failure: { code: fixture.expected.failure_code } });
    });
  }

  it("enforces the quantity-specific finite-number result contract", () => {
    for (const fixture of suite.cases.filter((entry) => entry.purpose === "quantity")) {
      const definition = product([field({
        quantity: { value_by: "eval", expression: fixture.expression! },
      })]);
      const raw = fixture.raw_input.kind === "present" ? fixture.raw_input.value : undefined;
      const result = resolveQuantity(
        definition,
        "root",
        { values: raw === undefined ? {} : { input: raw }, selections: {} },
        [],
        1,
        executor,
      );
      if (fixture.expected.ok) expect(result).toMatchObject({ ok: true, quantity: fixture.expected.value });
      else expect(result).toMatchObject({ ok: false, failure: { code: fixture.expected.failure_code } });
    }
  });
});

describe("quantity parity", () => {
  it.each([
    ["numeric string", { value_by: "value" } as const, "12", 12],
    ["string length", { value_by: "length" } as const, "abcd", 4],
    ["array length", { value_by: "length" } as const, [1, 2, 3], 3],
  ])("resolves %s", (_name, rule, raw, expected) => {
    expect(resolveQuantity(
      product([field({ quantity: rule })]), "root",
      { values: { input: raw }, selections: {} }, [], 1, executor,
    )).toMatchObject({ ok: true, quantity: expected, source: { kind: "field_rule", node_id: "input" } });
  });

  it("applies multiply, clamp, and a rule fallback", () => {
    const definition = product([field({
      quantity: { value_by: "value", multiply: 3, fallback: 4, clamp: { min: 2, max: 10 } },
    })]);
    expect(resolveQuantity(definition, "root", { values: { input: "bad" }, selections: {} }, [], 1, executor))
      .toMatchObject({ ok: true, quantity: 4 });
    expect(resolveQuantity(definition, "root", { values: { input: 8 }, selections: {} }, [], 1, executor))
      .toMatchObject({ ok: true, quantity: 10 });
  });

  it("does not fall through to a later field rule after the first visible rule is invalid", () => {
    const definition = product([
      field({ id: "first", quantity: { value_by: "value" } }),
      field({ id: "second", quantity: { value_by: "value" } }),
    ]);
    definition.filters[0]!.quantity_default = 6;
    expect(resolveQuantity(
      definition, "root", { values: { first: "bad", second: 99 }, selections: {} }, [], 1, executor,
    )).toMatchObject({ ok: true, quantity: 6, source: { kind: "filter_default" } });
  });

  it("uses option, button-field, filter, then host defaults in order", () => {
    const definition = product([
      field({
        id: "choice", type: "choice", multiple: true,
        options: [{ id: "option", label: "Option", quantity_default: 8 }],
      }),
      field({ id: "button", type: "button", button: true, quantity_default: 7 }),
    ]);
    definition.filters[0]!.quantity_default = 6;
    const state = { values: {}, selections: { choice: ["option"] } };
    expect(resolveQuantity(definition, "root", state, ["option", "button"], 5, executor))
      .toMatchObject({ quantity: 8, source: { kind: "option_default" } });
    expect(resolveQuantity(definition, "root", { values: {}, selections: {} }, ["button"], 5, executor))
      .toMatchObject({ quantity: 7, source: { kind: "field_default" } });
    expect(resolveQuantity(definition, "root", { values: {}, selections: {} }, [], 5, executor))
      .toMatchObject({ quantity: 6, source: { kind: "filter_default" } });
    delete definition.filters[0]!.quantity_default;
    expect(resolveQuantity(definition, "root", { values: {}, selections: {} }, [], 5, executor))
      .toMatchObject({ quantity: 5, source: { kind: "host_default" } });
  });

  it("returns a structured failure instead of silently using defaults after an expression failure", () => {
    const definition = product([field({
      quantity: {
        value_by: "eval",
        expression: { language: "javascript", body: "throw new Error('bad')" },
        fallback: 9,
      },
    })]);
    expect(resolveQuantity(definition, "root", { values: { input: 1 }, selections: {} }, [], 5, executor))
      .toMatchObject({ ok: false, failure: { code: "expression_execution_failed" } });
  });
});

describe("customer-field validation parity", () => {
  const passing: Array<[string, FieldValidationRule, JsonValue]> = [
    ["eq", { op: "eq", value: "a" }, "a"],
    ["neq", { op: "neq", value: "a" }, "b"],
    ["gt", { op: "gt", value: 2 }, "3"],
    ["gte", { op: "gte", value: 3 }, 3],
    ["lt", { op: "lt", value: 3 }, 2],
    ["lte", { op: "lte", value: 3 }, "3"],
    ["between", { op: "between", min: 2, max: 4 }, 3],
    ["in", { op: "in", values: ["a", "b"] }, "b"],
    ["nin", { op: "nin", values: ["a", "b"] }, "c"],
    ["truthy", { op: "truthy" }, "yes"],
    ["falsy", { op: "falsy" }, 0],
    ["match", { op: "match", pattern: "^abc$", pattern_flags: "i" }, "ABC"],
  ];

  it.each(passing)("preserves the %s operator", (_name, rule, raw) => {
    expect(validateCustomerInput(
      product([field({ validation: [rule] })]), "root",
      { values: { input: raw }, selections: {} }, [], executor,
    )).toEqual({ ok: true, issues: [] });
  });

  it("supports length/eval subjects, custom output, and one issue per field", () => {
    const definition = product([field({ validation: [
      { op: "gte", value_by: "length", value: 2, code: "too_short", message: "Too short" },
      {
        op: "eq", value_by: "eval", value: "AB",
        expression: { language: "javascript", body: "return String(value).toUpperCase()" },
      },
    ] })]);
    expect(validateCustomerInput(definition, "root", { values: { input: "x" }, selections: {} }, [], executor))
      .toEqual({ ok: false, kind: "customer_input", issues: [{ field_id: "input", code: "too_short", message: "Too short", rule_index: 0 }] });
    expect(validateCustomerInput(definition, "root", { values: { input: "ab" }, selections: {} }, [], executor))
      .toEqual({ ok: true, issues: [] });
  });

  it("compares JSON objects structurally rather than by property insertion order", () => {
    expect(validateCustomerInput(
      product([field({ validation: [{ op: "eq", value: { first: 1, second: 2 } }] })]),
      "root",
      { values: { input: { second: 2, first: 1 } }, selections: {} },
      [], executor,
    )).toEqual({ ok: true, issues: [] });
  });

  it("validates required visible fields but ignores hidden fields", () => {
    const definition = product([
      field({ id: "visible", required: true }),
      field({ id: "hidden", required: true }),
    ]);
    definition.filters[0]!.excludes = ["hidden"];
    expect(validateCustomerInput(definition, "root", { values: {}, selections: {} }, [], executor))
      .toMatchObject({ ok: false, issues: [{ field_id: "visible", code: "required" }] });
  });

  it("uses field-local expression arguments and propagates host failures", () => {
    const definition = product([field({ validation: [{
      op: "eq", value_by: "eval", value: 1,
      expression: { language: "javascript", body: "throw new Error(String(values.length))" },
    }] })]);
    expect(validateCustomerInput(
      definition, "root", { values: { input: 1, unrelated: 2 }, selections: {} }, [], executor,
    )).toMatchObject({ ok: false, kind: "host_configuration", failure: {
      code: "expression_execution_failed", meta: { error: "1" },
    } });
  });
});

describe("ordering state, defaults, and effects", () => {
  it("normalizes non-multiple selections by mode and supports recursive options", () => {
    const definition = product([field({
      type: "choice",
      options: [{ id: "parent", label: "Parent", children: [{ id: "child", label: "Child" }] }, { id: "other", label: "Other" }],
    })]);
    expect(resolveOrderingSelection(definition, "root", [], { input: ["parent", "child", "other"] }))
      .toMatchObject({ selections: { input: ["other"] }, trigger_ids: ["other"] });
    expect(resolveOrderingSelection(definition, "root", [], { input: ["parent", "child", "other"] }, { mode: "dev" }))
      .toMatchObject({ selections: { input: ["parent", "child", "other"] } });
  });

  it("hydrates defaults only when no state was supplied and resolves registry variants", () => {
    const definition = product([field({
      type: "choice", variant: "cards", default_value: "high",
      options: [{ id: "low", label: "Low" }, { id: "high", label: "High" }],
    })]);
    const registry = createInputRegistry([
      { type: "choice", variant: "default", cardinality: "single" },
      { type: "choice", variant: "cards", cardinality: "multiple", options: true },
    ]);
    expect(registry.resolve("choice", "cards")?.variant).toBe("cards");
    expect(registry.resolve("choice", "missing")?.variant).toBe("default");
    expect(createOrderingSession(definition, "root", undefined, registry).store.get())
      .toEqual({ values: { input: "high" }, selections: { input: ["high"] } });
    expect(createOrderingSession(
      definition, "root", { values: { input: "low" }, selections: { input: ["low"] } }, registry,
    ).store.get()).toEqual({ values: { input: "low" }, selections: { input: ["low"] } });
  });

  it("rehydrates canonical snapshots by field name without applying fresh-flow defaults", () => {
    const definition = product([
      field({ id: "quantity", name: "quantity", default_value: 100 }),
      field({
        id: "quality", type: "choice", name: "quality", default_value: "high",
        options: [{ id: "low", label: "Low" }, { id: "high", label: "High" }],
      }),
    ]);
    const built = buildOrderSnapshot({
      definition, filter_id: "root",
      state: { values: { quantity: 250, quality: "low" }, selections: { quality: ["low"] } },
      services: [], built_at: "2026-08-03T12:00:00.000Z",
    });
    if (!built.ok) throw new Error("expected snapshot");
    expect(hydrateOrderingInputState(definition, built.snapshot)).toMatchObject({
      filter_id: "root", state: { values: { quantity: 250, quality: "low" }, selections: { quality: ["low"] } },
    });
    expect(createOrderingSessionFromSnapshot(definition, built.snapshot).store.get()).toEqual({
      values: { quantity: 250, quality: "low" }, selections: { quality: ["low"] },
    });
  });

  it("applies only visible value effects, synchronizes option values, and preserves user overrides", () => {
    const definition = product([
      field({ id: "toggle", type: "button", button: true }),
      field({ id: "package", type: "choice", options: [{ id: "premium", label: "Premium" }] }),
      field({ id: "quality", type: "choice", options: [{ id: "high", label: "High" }] }),
      field({ id: "runs", type: "number" }),
      field({ id: "result" }),
      field({ id: "hidden" }),
    ]);
    definition.filters[0]!.excludes = ["hidden"];
    definition.value_effects_for_triggers = {
      toggle: {
        runs: { value: 5, mode: "if_empty", clear_on_deactivate: true },
        hidden: { value: "ignored" },
      },
      premium: { quality: { value: "high" } },
      high: { result: { value: "chained" } },
    };
    const session = createOrderingSession(definition, "root");
    session.set_trigger_ids(["toggle"]);
    expect(session.store.get().values).toMatchObject({ runs: 5 });
    expect(session.store.get().values.hidden).toBeUndefined();
    session.set_value("runs", 7);
    session.set_trigger_ids([]);
    expect(session.store.get().values.runs).toBe(7);
    session.bind_field("package").set_selected_option_ids(["premium"]);
    expect(session.store.get()).toMatchObject({
      values: { quality: "high", result: "chained" }, selections: { package: ["premium"], quality: ["high"] },
    });
  });

  it("applies the active filter value effect without implicitly firing ancestor filters", () => {
    const definition = product([field({ id: "value" })]);
    definition.filters.push({ id: "child", label: "Child", bind_id: "root" });
    definition.fields[0]!.bind_id = ["root", "child"];
    definition.value_effects_for_triggers = {
      root: { value: { value: "ancestor" } },
      child: { value: { value: "active" } },
    };
    expect(createOrderingSession(definition, "child").store.get().values.value).toBe("active");
  });
});

describe("complete snapshot evidence", () => {
  it("preserves service ordering, input filtering, bounds, fallbacks, and every utility mode", () => {
    const definition = product([
      field({
        id: "packages", type: "choice", name: "package", multiple: true,
        options: [
          { id: "slow", label: "Slow", service_id: "svc-low" },
          { id: "fast", label: "Fast", service_id: 2 },
          { id: "duplicate", label: "Duplicate", service_id: "2" },
          { id: "rush", label: "Rush", pricing_role: "utility", utility: { mode: "percent", rate: 10, percent_base: "service_total" } },
        ],
      }),
      field({ id: "flat", pricing_role: "utility", utility: { mode: "flat", rate: 4 }, name: "flat" }),
      field({ id: "per_quantity", pricing_role: "utility", utility: { mode: "per_quantity", rate: 3 } }),
      field({ id: "per_value", pricing_role: "utility", utility: { mode: "per_value", rate: 2, value_by: "value" } }),
      field({ id: "hidden", name: "hidden" }),
    ]);
    definition.filters[0]!.excludes = ["hidden"];
    definition.filters[0]!.quantity_default = 2;
    definition.fallbacks = { nodes: { fast: [3] }, global: { "2": [4] } };
    const result = buildOrderSnapshot({
      definition,
      filter_id: "root",
      state: {
        values: { flat: "kept", per_value: 3, hidden: "stale" },
        selections: { packages: ["slow", "fast", "duplicate", "rush"] },
      },
      services: [service("svc-low", 10, 5, 50), service(2, 30, 10, 100)],
      advisory_service_amounts: { "svc-low": 10, "2": 30 },
      built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        service_ids: [2, "svc-low"],
        service_ids_by_node: { slow: ["svc-low"], fast: [2], duplicate: ["2"] },
        min: 5,
        max: 100,
        inputs: { form: { flat: "kept" }, selections: { packages: ["slow", "fast", "duplicate", "rush"] } },
        fallbacks: { nodes: { fast: [3] }, global: { "2": [4] } },
        utilities: [
          { node_id: "rush", inputs: { base_amount: 40 }, advisory_amount: 4 },
          { node_id: "flat", advisory_amount: 4 },
          { node_id: "per_quantity", advisory_amount: 6 },
          { node_id: "per_value", inputs: { value: 3, value_by: "value" }, advisory_amount: 6 },
        ],
      },
    });
    if (!result.ok) throw new Error("expected snapshot");
    expect(validateSnapshotSchema(result.snapshot), JSON.stringify(validateSnapshotSchema.errors)).toBe(true);
  });

  it("uses the filter service only when no visible selected base service exists", () => {
    const definition = product([field({
      id: "hidden_choice", type: "choice",
      options: [{ id: "hidden_option", label: "Hidden", service_id: 2 }],
    })]);
    definition.filters[0]!.service_id = 1;
    definition.filters[0]!.excludes = ["hidden_choice"];
    expect(buildOrderSnapshot({
      definition, filter_id: "root",
      state: { values: {}, selections: { hidden_choice: ["hidden_option"] } },
      services: [service(1, 10), service(2, 20)], built_at: "2026-08-03T12:00:00.000Z",
    })).toMatchObject({ ok: true, snapshot: {
      selection: { trigger_ids: [] }, inputs: { selections: {} }, service_ids: [1], service_ids_by_node: { root: [1] },
    } });
  });

  it("derives canonical field selections from explicit option triggers", () => {
    const definition = product([field({
      id: "package", type: "choice", multiple: true,
      options: [{ id: "selected", label: "Selected", service_id: 2 }],
    })]);
    const result = buildOrderSnapshot({
      definition, filter_id: "root", trigger_ids: ["selected"],
      state: { values: {}, selections: {} }, services: [service(2, 20)],
      built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, snapshot: {
      selection: { trigger_ids: ["selected"], fields: [{ field_id: "package", selected_option_ids: ["selected"] }] },
      inputs: { selections: { package: ["selected"] } },
      service_ids_by_node: { selected: [2] },
    } });
  });

  it("prunes option-effect-hidden selections while retaining visible recursive selections", () => {
    const definition = product([
      field({ id: "package", type: "choice", options: [{ id: "premium", label: "Premium" }] }),
      field({
        id: "quality", type: "choice", multiple: true,
        options: [
          { id: "low", label: "Low", service_id: 1 },
          { id: "parent", label: "Parent", children: [{ id: "nested", label: "Nested", service_id: 2 }] },
        ],
      }),
    ]);
    definition.option_effects_for_buttons = { premium: { quality: { include: ["parent", "nested"] } } };
    const result = buildOrderSnapshot({
      definition, filter_id: "root",
      state: { values: {}, selections: { package: ["premium"], quality: ["low", "nested"] } },
      services: [service(1, 10), service(2, 20)], built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, snapshot: {
      inputs: { selections: { package: ["premium"], quality: ["nested"] } },
      service_ids: [2], service_ids_by_node: { nested: [2] },
    } });
  });

  it("uses a parent field value for option per-value utilities and ignores utility service bindings", () => {
    const definition = product([field({
      id: "extras", type: "choice", multiple: true,
      options: [{
        id: "extra", label: "Extra", service_id: 99, pricing_role: "utility",
        utility: { mode: "per_value", rate: 2, value_by: "length", label: "Extra length" },
      }],
    })]);
    definition.filters[0]!.service_id = 1;
    const result = buildOrderSnapshot({
      definition, filter_id: "root",
      state: { values: { extras: ["a", "b", "c"] }, selections: { extras: ["extra"] } },
      services: [service(1, 10), service(99, 50)], built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, snapshot: {
      service_ids: [1], service_ids_by_node: { root: [1] },
      utilities: [{
        node_id: "extra", label: "Extra length", inputs: { value: 3, value_by: "length" }, advisory_amount: 6,
      }],
    } });
  });

  it("calculates base-service and all percent bases in authored utility order", () => {
    const definition = product([
      field({
        id: "services", type: "choice", multiple: true,
        options: [{ id: "low", label: "Low", service_id: 1 }, { id: "high", label: "High", service_id: 2 }],
      }),
      field({ id: "flat_first", pricing_role: "utility", utility: { mode: "flat", rate: 4 } }),
      field({ id: "primary_percent", pricing_role: "utility", utility: { mode: "percent", rate: 10, percent_base: "base_service" } }),
      field({ id: "all_percent", pricing_role: "utility", utility: { mode: "percent", rate: 10, percent_base: "all" } }),
    ]);
    const result = buildOrderSnapshot({
      definition, filter_id: "root", state: { values: {}, selections: { services: ["low", "high"] } },
      services: [service(1, 10), service(2, 30)], built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, snapshot: { utilities: [
      { node_id: "flat_first", advisory_amount: 4 },
      { node_id: "primary_percent", inputs: { base_amount: 30 }, advisory_amount: 3 },
      { node_id: "all_percent", inputs: { base_amount: 47 }, advisory_amount: 4.7 },
    ] } });
  });

  it("rejects invalid host defaults and never emits a snapshot", () => {
    const result = buildOrderSnapshot({
      definition: product(), filter_id: "root", state: { values: {}, selections: {} }, services: [],
      host_quantity_default: 0,
    });
    expect(result).toMatchObject({ ok: false, kind: "host_configuration", failure: { path: "/host_quantity_default" } });
    expect("snapshot" in result).toBe(false);
    expect(buildOrderSnapshot({
      definition: product(), filter_id: "missing", state: { values: {}, selections: {} }, services: [],
    })).toMatchObject({ ok: false, failure: { path: "/filter_id" } });
    expect(buildOrderSnapshot({
      definition: product(), filter_id: "root", state: { values: {}, selections: {} }, services: [],
      built_at: "2026-08-03",
    })).toMatchObject({ ok: false, failure: { path: "/built_at" } });
  });
});
