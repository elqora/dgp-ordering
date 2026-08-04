// SPDX-License-Identifier: GPL-3.0-only

import type { JsonValue, ProductDefinition } from "@elqora/dgp-spec";
import { createProductInterpreter, type ResolvedProductContext } from "@elqora/dgp-core";

import { bindField, createFormStore, type FieldBinding, type FormStore, type OrderingInputState } from "./store.js";
import { createInputRegistry, type InputRegistry } from "./registry.js";
import { resolveOrderingSelection } from "./selection.js";

export interface OrderingSession {
  readonly store: FormStore<OrderingInputState>;
  readonly registry: InputRegistry;
  get_filter_id(): string;
  set_filter_id(filter_id: string): void;
  get_trigger_ids(): string[];
  set_trigger_ids(trigger_ids: readonly string[]): void;
  get_context(): ResolvedProductContext | undefined;
  bind_field(field_id: string): FieldBinding;
  set_value(field_id: string, value: JsonValue): void;
  set_selected_option_ids(field_id: string, option_ids: readonly string[]): void;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function empty(value: JsonValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function createOrderingSession(
  definition: ProductDefinition,
  initial_filter_id: string,
  initial_state: OrderingInputState = { values: {}, selections: {} },
  registry: InputRegistry = createInputRegistry(),
): OrderingSession {
  const interpreter = createProductInterpreter(definition);
  const store = createFormStore(initial_state);
  let filterId = initial_filter_id;
  let explicitTriggerIds: string[] = [];
  let activeTriggerIds: string[] = [];
  let priorEffects = new Map<string, ReturnType<typeof interpreter.resolveValueEffects>[number]>();

  const reconcile = (): void => {
    const requestedSelections: Record<string, string[]> = {};
    for (const field of definition.fields) {
      let selected = [...(store.get().selections[field.id] ?? [])];
      const cardinality = registry.resolve(field.type)?.cardinality;
      if (cardinality === "single") selected = selected.slice(0, 1);
      if (cardinality === "scalar") selected = [];
      if (selected.length > 0) requestedSelections[field.id] = selected;
    }
    const resolved = resolveOrderingSelection(definition, filterId, explicitTriggerIds, requestedSelections);
    const nextSelections = resolved.selections;
    activeTriggerIds = resolved.trigger_ids;
    const nextEffects = new Map(
      interpreter.resolveValueEffects(filterId, activeTriggerIds)
        .map((effect) => [`${effect.triggerId}\u0000${effect.targetFieldId}`, effect]),
    );
    const values = { ...store.get().values };
    for (const [key, previous] of priorEffects) {
      if (!nextEffects.has(key) && previous.effect.clear_on_deactivate === true) values[previous.targetFieldId] = null;
    }
    for (const resolved of nextEffects.values()) {
      if (resolved.effect.mode !== "if_empty" || empty(values[resolved.targetFieldId] ?? null)) {
        values[resolved.targetFieldId] = resolved.effect.value;
      }
    }
    priorEffects = nextEffects;
    store.set({ values, selections: nextSelections });
  };

  reconcile();
  return {
    store,
    registry,
    get_filter_id: () => filterId,
    set_filter_id(next) { filterId = next; reconcile(); },
    get_trigger_ids: () => [...activeTriggerIds],
    set_trigger_ids(next) { explicitTriggerIds = unique(next); reconcile(); },
    get_context: () => interpreter.resolveContext(filterId, activeTriggerIds),
    bind_field: (fieldId) => bindField(store, fieldId),
    set_value(fieldId, value) {
      const current = store.get();
      store.set({ values: { ...current.values, [fieldId]: value }, selections: { ...current.selections } });
      reconcile();
    },
    set_selected_option_ids(fieldId, optionIds) {
      const current = store.get();
      store.set({ values: { ...current.values }, selections: { ...current.selections, [fieldId]: [...optionIds] } });
      reconcile();
    },
  };
}
