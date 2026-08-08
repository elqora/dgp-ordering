// SPDX-License-Identifier: GPL-3.0-only

import type { JsonValue, OrderSnapshot, OrderSnapshotMode, ProductDefinition } from "@elqora/dgp-spec";
import { createProductInterpreter, fieldOptionIds, type ResolvedProductContext } from "@elqora/dgp-core";

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

export interface OrderingSessionOptions {
  mode?: OrderSnapshotMode;
  apply_defaults?: boolean;
}

export interface HydratedOrderingState {
  filter_id: string;
  trigger_ids: string[];
  state: OrderingInputState;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function empty(value: JsonValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function equal(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectionFromValue(value: JsonValue, allowed: readonly string[], multiple: boolean): string[] {
  const allowedSet = new Set(allowed);
  const candidates = Array.isArray(value) ? value : [value];
  const selected = candidates.filter((item): item is string => typeof item === "string" && allowedSet.has(item));
  const uniqueSelected = unique(selected);
  return multiple ? uniqueSelected : uniqueSelected.slice(-1);
}

function sameSelections(left: Readonly<Record<string, readonly string[]>>, right: Readonly<Record<string, readonly string[]>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => {
    const leftValues = left[key] ?? [];
    const rightValues = right[key] ?? [];
    return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
  });
}

/** Convert canonical snapshot evidence back into field-id keyed headless state. */
export function hydrateOrderingInputState(
  definition: ProductDefinition,
  snapshot: OrderSnapshot,
): HydratedOrderingState {
  const values: Record<string, JsonValue> = {};
  for (const field of definition.fields) {
    if (field.name !== undefined && Object.hasOwn(snapshot.inputs.form, field.name)) {
      values[field.id] = snapshot.inputs.form[field.name]!;
    }
  }
  const selections: Record<string, string[]> = {};
  for (const [fieldId, optionIds] of Object.entries(snapshot.inputs.selections)) {
    selections[fieldId] = unique(optionIds);
  }
  for (const selectedField of snapshot.selection.fields) {
    if (selections[selectedField.field_id] === undefined && selectedField.selected_option_ids.length > 0) {
      selections[selectedField.field_id] = unique(selectedField.selected_option_ids);
    }
  }
  return {
    filter_id: snapshot.selection.filter_id,
    trigger_ids: unique(snapshot.selection.trigger_ids),
    state: { values, selections },
  };
}

export function createOrderingSessionFromSnapshot(
  definition: ProductDefinition,
  snapshot: OrderSnapshot,
  registry: InputRegistry = createInputRegistry(),
): OrderingSession {
  const hydrated = hydrateOrderingInputState(definition, snapshot);
  const session = createOrderingSession(
    definition,
    hydrated.filter_id,
    hydrated.state,
    registry,
    { mode: snapshot.mode, apply_defaults: false },
  );
  session.set_trigger_ids(hydrated.trigger_ids);
  return session;
}

export function createOrderingSession(
  definition: ProductDefinition,
  initial_filter_id: string,
  initial_state: OrderingInputState = { values: {}, selections: {} },
  registry: InputRegistry = createInputRegistry(),
  options: OrderingSessionOptions = {},
): OrderingSession {
  const interpreter = createProductInterpreter(definition);
  const mode = options.mode ?? "prod";
  const initialValues = { ...initial_state.values };
  const initialSelections: Record<string, string[]> = Object.fromEntries(
    Object.entries(initial_state.selections).map(([fieldId, optionIds]) => [fieldId, [...optionIds]]),
  );
  if (options.apply_defaults !== false) {
    for (const field of definition.fields) {
      if (initialValues[field.id] !== undefined || field.default_value === undefined) continue;
      initialValues[field.id] = field.default_value;
      const allowed = fieldOptionIds(field);
      const selected = selectionFromValue(field.default_value, allowed, mode === "dev" || field.multiple === true);
      if (selected.length > 0 && initialSelections[field.id] === undefined) initialSelections[field.id] = selected;
    }
  }
  const store = createFormStore({ values: initialValues, selections: initialSelections });
  let filterId = initial_filter_id;
  let explicitTriggerIds: string[] = [];
  let activeTriggerIds: string[] = [];
  let priorEffects = new Map<string, ReturnType<typeof interpreter.resolveValueEffects>[number] & { appliedValue: JsonValue }>();

  const reconcile = (): void => {
    const requestedSelections: Record<string, string[]> = {};
    for (const field of definition.fields) {
      let selected = [...(store.get().selections[field.id] ?? [])];
      const cardinality = registry.resolve(field.type, field.variant)?.cardinality;
      if (cardinality === "scalar") selected = [];
      else if (mode !== "dev" && field.multiple !== true) selected = selected.slice(-1);
      if (selected.length > 0) requestedSelections[field.id] = selected;
    }
    const values = { ...store.get().values };
    let resolved = resolveOrderingSelection(definition, filterId, explicitTriggerIds, requestedSelections, { mode });
    let previousEffects = priorEffects;
    const effectLimit = definition.fields.length + interpreter.index.triggerIds().length + 2;
    for (let iteration = 0; iteration < effectLimit; iteration += 1) {
      const nextSelections = { ...resolved.selections };
      activeTriggerIds = resolved.trigger_ids;
      const visible = new Set(resolved.visibility.fieldIds);
      const activeEffects = interpreter.resolveValueEffects(filterId, activeTriggerIds)
        .filter((effect) => visible.has(effect.targetFieldId));
      const nextEffects = new Map<string, ReturnType<typeof interpreter.resolveValueEffects>[number] & { appliedValue: JsonValue }>();
      for (const [key, previous] of previousEffects) {
        const remainsActive = activeEffects.some((effect) => `${effect.triggerId}\u0000${effect.targetFieldId}` === key);
        const anotherOwnsTarget = activeEffects.some((effect) => effect.targetFieldId === previous.targetFieldId);
        if (!remainsActive && !anotherOwnsTarget && previous.effect.clear_on_deactivate === true
          && equal(values[previous.targetFieldId] ?? null, previous.appliedValue)) {
          values[previous.targetFieldId] = null;
          delete nextSelections[previous.targetFieldId];
        }
      }
      for (const effect of activeEffects) {
        const key = `${effect.triggerId}\u0000${effect.targetFieldId}`;
        if (effect.effect.mode !== "if_empty" || empty(values[effect.targetFieldId] ?? null)) {
          values[effect.targetFieldId] = effect.effect.value;
          const target = interpreter.index.getField(effect.targetFieldId);
          const selected = selectionFromValue(
            effect.effect.value,
            resolved.visibility.optionsByFieldId[effect.targetFieldId] ?? [],
            mode === "dev" || target?.multiple === true,
          );
          if (selected.length > 0) nextSelections[effect.targetFieldId] = selected;
          nextEffects.set(key, { ...effect, appliedValue: effect.effect.value });
        } else {
          const previous = previousEffects.get(key);
          if (previous !== undefined) nextEffects.set(key, previous);
        }
      }
      const nextResolved = resolveOrderingSelection(definition, filterId, explicitTriggerIds, nextSelections, { mode });
      previousEffects = nextEffects;
      if (sameSelections(resolved.selections, nextResolved.selections)
        && resolved.trigger_ids.length === nextResolved.trigger_ids.length
        && resolved.trigger_ids.every((triggerId, index) => triggerId === nextResolved.trigger_ids[index])) {
        resolved = nextResolved;
        break;
      }
      resolved = nextResolved;
    }
    activeTriggerIds = resolved.trigger_ids;
    priorEffects = previousEffects;
    store.set({ values, selections: resolved.selections });
  };

  reconcile();
  const setValue = (fieldId: string, value: JsonValue): void => {
    const current = store.get();
    store.set({ values: { ...current.values, [fieldId]: value }, selections: { ...current.selections } });
    reconcile();
  };
  const setSelectedOptionIds = (fieldId: string, optionIds: readonly string[]): void => {
    const current = store.get();
    store.set({ values: { ...current.values }, selections: { ...current.selections, [fieldId]: [...optionIds] } });
    reconcile();
  };
  return {
    store,
    registry,
    get_filter_id: () => filterId,
    set_filter_id(next) { filterId = next; reconcile(); },
    get_trigger_ids: () => [...activeTriggerIds],
    set_trigger_ids(next) { explicitTriggerIds = unique(next); reconcile(); },
    get_context: () => interpreter.resolveContext(filterId, activeTriggerIds),
    bind_field(fieldId) {
      const binding = bindField(store, fieldId);
      return {
        ...binding,
        set_value: (value) => setValue(fieldId, value),
        set_selected_option_ids: (optionIds) => setSelectedOptionIds(fieldId, optionIds),
      };
    },
    set_value: setValue,
    set_selected_option_ids: setSelectedOptionIds,
  };
}
