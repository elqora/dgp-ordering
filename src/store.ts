// SPDX-License-Identifier: GPL-3.0-only

import type { JsonValue } from "@elqora/dgp-spec";

export interface OrderingInputState {
  values: Record<string, JsonValue>;
  selections: Record<string, string[]>;
}

export type StoreListener<T> = (state: Readonly<T>) => void;

export interface FormStore<T> {
  get(): Readonly<T>;
  set(next: T | ((current: Readonly<T>) => T)): void;
  subscribe(listener: StoreListener<T>): () => void;
  reset(): void;
}

export function createFormStore<T>(initial: T): FormStore<T> {
  let state = initial;
  const listeners = new Set<StoreListener<T>>();
  return {
    get: () => state,
    set(next) {
      state = typeof next === "function"
        ? (next as (current: Readonly<T>) => T)(state)
        : next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = initial;
      for (const listener of listeners) listener(state);
    },
  };
}

export interface FieldBinding {
  field_id: string;
  get_value(): JsonValue;
  set_value(value: JsonValue): void;
  get_selected_option_ids(): string[];
  set_selected_option_ids(option_ids: string[]): void;
  subscribe(listener: () => void): () => void;
}

export function bindField(store: FormStore<OrderingInputState>, fieldId: string): FieldBinding {
  return {
    field_id: fieldId,
    get_value: () => store.get().values[fieldId] ?? null,
    set_value(value) {
      store.set((current) => ({
        values: { ...current.values, [fieldId]: value },
        selections: { ...current.selections },
      }));
    },
    get_selected_option_ids: () => [...(store.get().selections[fieldId] ?? [])],
    set_selected_option_ids(optionIds) {
      store.set((current) => ({
        values: { ...current.values },
        selections: { ...current.selections, [fieldId]: [...optionIds] },
      }));
    },
    subscribe(listener) {
      return store.subscribe(listener);
    },
  };
}
