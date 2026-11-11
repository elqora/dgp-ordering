// SPDX-License-Identifier: GPL-3.0-only

import type { BrowserJavaScriptExpression, ExpressionHostConfigurationFailure } from "@elqora/dgp-spec";

export type VisibilityExpressionExecutionResult =
  | { ok: true; value: boolean }
  | { ok: false; failure: ExpressionHostConfigurationFailure };

export interface VisibilityExpressionExecutor {
  execute(
    expression: BrowserJavaScriptExpression | undefined,
    preview: unknown,
    path: string,
  ): VisibilityExpressionExecutionResult;
}

function failure(
  code: ExpressionHostConfigurationFailure["code"],
  path: string,
  message: string,
  meta: ExpressionHostConfigurationFailure["meta"] = {},
): VisibilityExpressionExecutionResult {
  return { ok: false, failure: { kind: "host_configuration", code, path, message, meta } };
}

export function createBrowserVisibilityExpressionExecutor(): VisibilityExpressionExecutor {
  return {
    execute(expression, preview, path) {
      if (expression === undefined || expression.body.trim() === "") {
        return failure("expression_source_missing", path, "The visibility expression body is missing.");
      }
      try {
        // Expressions are deliberately trusted host-authored JavaScript function bodies.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const evaluate = Function("preview", expression.body) as (preview: unknown) => unknown;
        return { ok: true, value: Boolean(evaluate(preview)) };
      } catch (error) {
        return failure(
          "expression_execution_failed",
          path,
          "The visibility expression failed during execution.",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    },
  };
}
