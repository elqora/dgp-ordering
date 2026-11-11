// SPDX-License-Identifier: GPL-3.0-only

import type { ProductDefinition } from "@elqora/dgp-spec";
import { createProductInterpreter, walkFieldOptions, type ResolvedVisibility } from "@elqora/dgp-core";

import type { VisibilityExpressionExecutionResult, VisibilityExpressionExecutor } from "./visibility-expression.js";

export interface ResolvedOrderingSelection {
  trigger_ids: string[];
  selections: Record<string, string[]>;
  visibility: ResolvedVisibility;
  configuration_failure?: Extract<VisibilityExpressionExecutionResult, { ok: false }> ["failure"];
}

export interface ResolveOrderingSelectionOptions {
  mode?: "prod" | "dev";
  preview?: unknown;
  visibility_expression_executor?: VisibilityExpressionExecutor;
  visibility_override?: ResolvedVisibility;
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function withExpressionVisibility(
  definition: ProductDefinition,
  base: ResolvedVisibility,
  preview: unknown,
  executor: VisibilityExpressionExecutor,
): { visibility: ResolvedVisibility } | { failure: Extract<VisibilityExpressionExecutionResult, { ok: false }> ["failure"] } {
  const visible = new Set(base.fieldIds);
  const forced = new Set(base.forcedFieldIds);
  for (const field of definition.fields) {
    if (field.visibility_expression === undefined) continue;
    const result = executor.execute(field.visibility_expression, preview, `/fields/${field.id}/visibility_expression`);
    if (!result.ok) return { failure: result.failure };
    if (result.value) {
      if (!visible.has(field.id)) forced.add(field.id);
      visible.add(field.id);
    } else {
      visible.delete(field.id);
      forced.delete(field.id);
    }
  }

  const baseVisibleFieldIds = base.fieldIds.filter((fieldId) => visible.has(fieldId));
  const baseVisible = new Set(baseVisibleFieldIds);
  const fieldIds = [
    ...baseVisibleFieldIds,
    ...definition.fields.map((field) => field.id).filter((fieldId) => visible.has(fieldId) && !baseVisible.has(fieldId)),
  ];
  const optionsByFieldId: Record<string, string[]> = {};
  for (const field of definition.fields) {
    if (!visible.has(field.id)) continue;
    const orderedOptionIds = walkFieldOptions(field).map((visit) => visit.optionId);
    const allowed = new Set(base.optionsByFieldId[field.id] ?? orderedOptionIds);
    for (const visit of walkFieldOptions(field)) {
      if (visit.option.visibility_expression === undefined) continue;
      const result = executor.execute(
        visit.option.visibility_expression,
        preview,
        `/fields/${field.id}/options/${visit.optionId}/visibility_expression`,
      );
      if (!result.ok) return { failure: result.failure };
      if (result.value) allowed.add(visit.optionId);
      else allowed.delete(visit.optionId);
    }
    if (orderedOptionIds.length > 0) optionsByFieldId[field.id] = orderedOptionIds.filter((id) => allowed.has(id));
  }
  return {
    visibility: {
      fieldIds,
      optionsByFieldId,
      forcedFieldIds: fieldIds.filter((id) => forced.has(id)),
    },
  };
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
  let visibility = options.visibility_override ?? interpreter.resolveVisibility(filterId, []);
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

    let nextVisibility = options.visibility_override ?? interpreter.resolveVisibility(filterId, nextTriggers);
    if (options.preview !== undefined && options.visibility_expression_executor !== undefined) {
      const evaluated = withExpressionVisibility(definition, nextVisibility, options.preview, options.visibility_expression_executor);
      if ("failure" in evaluated) return { trigger_ids: nextTriggers, selections: nextSelections, visibility: nextVisibility, configuration_failure: evaluated.failure };
      nextVisibility = evaluated.visibility;
    }
    if (same(triggerIds, nextTriggers) && same(visibility.fieldIds, nextVisibility.fieldIds)) {
      return { trigger_ids: nextTriggers, selections: nextSelections, visibility: nextVisibility };
    }
    triggerIds = nextTriggers;
    selections = nextSelections;
    visibility = nextVisibility;
  }

  return { trigger_ids: triggerIds, selections, visibility };
}
