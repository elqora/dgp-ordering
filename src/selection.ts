// SPDX-License-Identifier: GPL-3.0-only

import type { ProductDefinition } from "@elqora/dgp-spec";
import { createProductInterpreter, type ResolvedVisibility } from "@elqora/dgp-core";

export interface ResolvedOrderingSelection {
  trigger_ids: string[];
  selections: Record<string, string[]>;
  visibility: ResolvedVisibility;
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
    const add = (id: string): void => { if (!seen.has(id)) { seen.add(id); nextTriggers.push(id); } };

    for (const triggerId of requestedExplicit) {
      if (rejected.has(triggerId)) continue;
      const owner = interpreter.index.getOptionOwner(triggerId);
      const field = interpreter.index.getField(triggerId);
      const ownerId = owner?.id ?? (field?.button === true ? field.id : undefined);
      if (ownerId !== undefined && visibleFields.has(ownerId)) add(triggerId);
      else if (triggerIds.includes(triggerId)) rejected.add(triggerId);
    }

    for (const fieldId of visibility.fieldIds) {
      const allowed = new Set(visibility.optionsByFieldId[fieldId] ?? []);
      const selected = [...new Set(requestedSelections[fieldId] ?? [])]
        .filter((id) => !rejected.has(id) && allowed.has(id));
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
