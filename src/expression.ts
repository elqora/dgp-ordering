// SPDX-License-Identifier: GPL-3.0-only

import type {
  BrowserJavaScriptExpression,
  BrowserJavaScriptExpressionInput,
  ExpressionHostConfigurationFailure,
  JsonValue,
} from "@elqora/dgp-spec";

export type ExpressionResult =
  | { ok: true; value: JsonValue }
  | { ok: false; failure: ExpressionHostConfigurationFailure };

export interface ExpressionExecutor {
  execute(
    expression: BrowserJavaScriptExpression | undefined,
    input: BrowserJavaScriptExpressionInput,
    path: string,
  ): ExpressionResult;
}

function failure(
  code: ExpressionHostConfigurationFailure["code"],
  path: string,
  message: string,
  meta: ExpressionHostConfigurationFailure["meta"] = {},
): ExpressionResult {
  return { ok: false, failure: { kind: "host_configuration", code, path, message, meta } };
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value) ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

export function createBrowserJavaScriptExpressionExecutor(): ExpressionExecutor {
  return {
    execute(expression, input, path) {
      if (expression === undefined || expression.body.trim() === "") {
        return failure("expression_source_missing", path, "The browser JavaScript expression body is missing.");
      }
      try {
        // Expressions are deliberately trusted host-authored JavaScript function bodies.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const evaluate = Function(
          "value",
          "values",
          `"use strict";\n${expression.body}`,
        ) as (value: JsonValue, values: JsonValue[]) => unknown;
        const value = evaluate(input.value, input.values);
        if (!isJsonValue(value)) {
          return failure("expression_result_invalid", path, "The browser JavaScript expression returned a non-JSON value.");
        }
        return { ok: true, value };
      } catch (error) {
        return failure(
          "expression_execution_failed",
          path,
          "The browser JavaScript expression failed during execution.",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    },
  };
}
