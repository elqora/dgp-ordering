// SPDX-License-Identifier: GPL-3.0-only

import type { HandlerService, ProductDefinition } from "@elqora/dgp-spec";
import { describe, expect, it } from "vitest";

import {
  bindField,
  buildOrderSnapshot,
  createBrowserJavaScriptExpressionExecutor,
  createFormStore,
  createInputRegistry,
  createOrderingSession,
  resolveQuantity,
  validateCustomerInput,
  resolveOrderingSelection,
} from "../src/index.js";

const service: HandlerService = {
  id: 101,
  name: "Primary",
  description: null,
  category: null,
  rate: 25,
  min: 10,
  max: 10_000,
  capabilities: {},
  meta: {},
  state: "enabled",
  state_reason: null,
};

function definition(): ProductDefinition {
  return {
    id: "campaign",
    name: "Campaign",
    schema_version: "1",
    filters: [{ id: "root", label: "Root", service_id: 101, quantity_default: 3 }],
    fields: [
      {
        id: "quantity",
        type: "number",
        label: "Quantity",
        name: "quantity",
        bind_id: "root",
        required: true,
        quantity: { value_by: "value", clamp: { min: 1, max: 100 } },
      },
      {
        id: "package",
        type: "choice",
        label: "Package",
        bind_id: "root",
        multiple: true,
        options: [
          { id: "premium", label: "Premium", service_id: 101 },
          {
            id: "rush",
            label: "Rush",
            pricing_role: "utility",
            utility: { rate: 10, mode: "percent", percent_base: "service_total" },
          },
        ],
      },
    ],
    order_for_tags: {},
    includes_for_buttons: {},
    excludes_for_buttons: {},
    option_effects_for_buttons: {},
    value_effects_for_triggers: {},
    fallbacks: { global: { "101": [102] } },
    description: null,
    notices: [],
    meta: {},
  };
}

describe("headless form state", () => {
  it("provides framework-neutral field bindings and subscriptions", () => {
    const store = createFormStore({ values: {}, selections: {} });
    const binding = bindField(store, "package");
    let notifications = 0;
    const unsubscribe = binding.subscribe(() => notifications += 1);
    binding.set_value("premium");
    binding.set_selected_option_ids(["premium"]);
    unsubscribe();
    expect(binding.get_value()).toBe("premium");
    expect(binding.get_selected_option_ids()).toEqual(["premium"]);
    expect(notifications).toBe(2);
  });
});

describe("trusted browser expressions", () => {
  it("returns structured failures for missing, throwing, and invalid expressions", () => {
    const executor = createBrowserJavaScriptExpressionExecutor();
    expect(executor.execute(undefined, { value: null, values: [] }, "/x")).toMatchObject({ ok: false, failure: { code: "expression_source_missing", path: "/x" } });
    expect(executor.execute({ language: "javascript", body: "throw new Error('bad')" }, { value: null, values: [] }, "/x")).toMatchObject({ ok: false, failure: { code: "expression_execution_failed" } });
    expect(executor.execute({ language: "javascript", body: "return undefined" }, { value: null, values: [] }, "/x")).toMatchObject({ ok: false, failure: { code: "expression_result_invalid" } });
  });

  it("accepts repeated JSON references but rejects cycles", () => {
    const executor = createBrowserJavaScriptExpressionExecutor();
    expect(executor.execute(
      { language: "javascript", body: "const shared = { ok: true }; return { left: shared, right: shared }" },
      { value: null, values: [] },
      "/x",
    )).toMatchObject({ ok: true });
    expect(executor.execute(
      { language: "javascript", body: "const cycle = {}; cycle.self = cycle; return cycle" },
      { value: null, values: [] },
      "/x",
    )).toMatchObject({ ok: false, failure: { code: "expression_result_invalid" } });
  });
});

describe("customer ordering", () => {
  it("does not let a stale hidden selection bootstrap its own visibility", () => {
    const product = definition();
    product.filters[0]!.excludes = ["hidden"];
    product.fields.push({
      id: "hidden", type: "choice", label: "Hidden", bind_id: "root",
      options: [{ id: "stale", label: "Stale" }],
    });
    product.includes_for_buttons = { stale: ["hidden"] };
    const resolved = resolveOrderingSelection(product, "root", [], { hidden: ["stale"] });
    expect(resolved.trigger_ids).toEqual([]);
    expect(resolved.selections).toEqual({});
    expect(resolved.visibility.fieldIds).not.toContain("hidden");
  });

  it("normalizes selections and applies then clears value effects", () => {
    const product = definition();
    product.value_effects_for_triggers = {
      premium: {
        quantity: { value: 7, mode: "always", clear_on_deactivate: true },
      },
    };
    const registry = createInputRegistry([{ type: "choice", cardinality: "multiple" }]);
    const session = createOrderingSession(product, "root", { values: {}, selections: {} }, registry);
    session.set_selected_option_ids("package", ["premium", "rush"]);
    expect(session.store.get()).toMatchObject({ values: { quantity: 7 }, selections: { package: ["premium", "rush"] } });
    session.set_selected_option_ids("package", []);
    expect(session.store.get().values.quantity).toBeNull();
    expect(session.get_context()?.visibility.fieldIds).toEqual(["quantity", "package"]);
  });

  it("validates visible customer fields without publication diagnostics", () => {
    const result = validateCustomerInput(
      definition(),
      "root",
      { values: {}, selections: {} },
      [],
      createBrowserJavaScriptExpressionExecutor(),
    );
    expect(result).toMatchObject({ ok: false, kind: "customer_input", issues: [{ field_id: "quantity", code: "required" }] });
  });

  it("uses the accepted quantity precedence and records provenance", () => {
    const result = resolveQuantity(
      definition(),
      "root",
      { values: { quantity: 200 }, selections: {} },
      [],
      1,
      createBrowserJavaScriptExpressionExecutor(),
    );
    expect(result).toMatchObject({ ok: true, quantity: 100, source: { kind: "field_rule", node_id: "quantity" } });
  });

  it("builds canonical service evidence and exact advisory utilities", () => {
    const result = buildOrderSnapshot({
      definition: definition(),
      filter_id: "root",
      state: {
        values: { quantity: 5 },
        selections: { package: ["premium", "rush"] },
      },
      services: [service],
      built_at: "2026-08-03T12:00:00.000Z",
    });
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        version: "1",
        product_id: "campaign",
        quantity: 5,
        service_ids: [101],
        service_ids_by_node: { premium: [101] },
        utilities: [{ node_id: "rush", inputs: { base_amount: 25 }, advisory_amount: 2.5 }],
      },
    });
  });

  it("never constructs a snapshot after an expression failure", () => {
    const product = definition();
    const quantityField = product.fields[0];
    if (quantityField === undefined) throw new Error("missing test field");
    quantityField.quantity = {
      value_by: "eval",
      expression: { language: "javascript", body: "return 'not a number'" },
    };
    const result = buildOrderSnapshot({
      definition: product,
      filter_id: "root",
      state: { values: { quantity: 5 }, selections: {} },
      services: [service],
    });
    expect(result).toMatchObject({ ok: false, kind: "host_configuration", failure: { code: "expression_result_invalid" } });
    expect("snapshot" in result).toBe(false);
  });

  it("refuses schema-invalid host snapshot configuration", () => {
    expect(buildOrderSnapshot({
      definition: definition(), filter_id: "root",
      state: { values: { quantity: 5 }, selections: {} }, services: [service],
      built_at: "not-a-date",
    })).toMatchObject({ ok: false, kind: "host_configuration", failure: { code: "ordering_configuration_invalid", path: "/built_at" } });
    expect(buildOrderSnapshot({
      definition: definition(), filter_id: "root",
      state: { values: { quantity: 5 }, selections: {} }, services: [],
      host_min: 1.5,
    })).toMatchObject({ ok: false, kind: "host_configuration", failure: { code: "ordering_configuration_invalid", path: "/host_min" } });
  });
});
