// SPDX-License-Identifier: GPL-3.0-only

import type { ProductDefinition } from "@elqora/dgp-spec";
import { createProductInterpreter, type ResolvedVisibility } from "@elqora/dgp-core";

export interface ResolvedOrderingSelection {
  trigger_ids: string[];
  selections: Record<string, string[]>;
  visibility: ResolvedVisibility;
}

export interface ResolveOrderingSelectionOptions {
  mode?: "prod" | "dev";
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Resolve only triggers whose owning fields are reachable without self-bootstrapping. */
export function resolveOrderingSelection(
  definition: ProductDefinition,
  filterId: string,
  explicitTriggerIds: readonly string[],
  requestedSelections: Readonly<Record<string, readonly string[]>>,
  options: ResolveOrderingSelectionOptions = {},
): ResolvedOrderingSelection {
  const interpreter = createProductInterpreter(definition);
  const requestedExplicit = [...new Set(explicitTriggerIds)];
  const rejected = new Set<string>();
  let triggerIds: string[] = [];
  let selections: Record<string, string[]> = {};
  let visibility = interpreter.resolveVisibility(filterId, []);
  const limit = definition.fields.length + Object.values(requestedSelections).flat().length + requestedExplicit.length + 2;

  for (let iteration = 0; iteration < limit; iteration += 1) {
    const visibleFields = new Set(visibility.fieldIds);
    const nextSelections: Record<string, string[]> = {};
    const nextTriggers: string[] = [];
    const seen = new Set<string>();
    const explicitOptionsByField = new Map<string, string[]>();
    const add = (id: string): void => { if (!seen.has(id)) { seen.add(id); nextTriggers.push(id); } };

    for (const triggerId of requestedExplicit) {
      if (rejected.has(triggerId)) continue;
      const owner = interpreter.index.getOptionOwner(triggerId);
      const field = interpreter.index.getField(triggerId);
      if (owner !== undefined && visibleFields.has(owner.id)
        && (visibility.optionsByFieldId[owner.id] ?? []).includes(triggerId)) {
        const selected = explicitOptionsByField.get(owner.id) ?? [];
        selected.push(triggerId);
        explicitOptionsByField.set(owner.id, selected);
        add(triggerId);
      } else if (field?.button === true && visibleFields.has(field.id)) add(triggerId);
      else if (triggerIds.includes(triggerId)) rejected.add(triggerId);
    }

    for (const fieldId of visibility.fieldIds) {
      const field = interpreter.index.getField(fieldId);
      const allowed = new Set(visibility.optionsByFieldId[fieldId] ?? []);
      let selected = [...new Set([
        ...(requestedSelections[fieldId] ?? []),
        ...(explicitOptionsByField.get(fieldId) ?? []),
      ])]
        .filter((id) => !rejected.has(id) && allowed.has(id));
      if (options.mode !== "dev" && field?.multiple !== true && selected.length > 1) {
        selected = selected.slice(-1);
      }
      for (const previous of selections[fieldId] ?? []) if (!selected.includes(previous)) rejected.add(previous);
      if (selected.length > 0) nextSelections[fieldId] = selected;
      for (const id of selected) add(id);
    }

    const nextVisibility = interpreter.resolveVisibility(filterId, nextTriggers);
    if (same(triggerIds, nextTriggers) && same(visibility.fieldIds, nextVisibility.fieldIds)) {
      return { trigger_ids: nextTriggers, selections: nextSelections, visibility: nextVisibility };
    }
    triggerIds = nextTriggers;
    selections = nextSelections;
    visibility = nextVisibility;
  }

  return { trigger_ids: triggerIds, selections, visibility };
}
