# Agent guidance: DGP Ordering

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository orchestrates customer interactions over valid, published product definitions and builds DGP order snapshots.

## Dependencies

- May depend on sibling `dgp-spec` and `dgp-core`.
- Must not depend on `dgp-validation` or `dgp-workspace`.
- Framework bindings must remain separable from headless ordering state and behavior.

## Boundaries

- Own customer input state, selections, quantity resolution, browser-side customer-field validation, and `OrderSnapshot` construction.
- Preserve intentional `eval` expressions as browser JavaScript authored by trusted hosts or administrators and tested through Studio.
- Do not require backend or non-browser SDKs to execute browser JavaScript expressions.
- Do not redesign, sandbox, remove, or silently change expression failure behavior without an explicit compatibility decision.
- Validate customer-entered values, not product-definition coherence.
- Do not expose visibility, rate-coherence, constraint, or publication diagnostics to customers.
- Preserve the SDK's rate and charge model; do not treat catalog rate as a replacement pricing system.
- Do not own Studio expression editors, previews, or publication-test UI.

## References

- Legacy ordering sources: `D:\Projects\GitHub\digital-service-ui-builder\src\react\hooks`, `src\react\inputs`, and `src\utils\build-order-snapshot`.
- Current Studio and expression-authoring reference: `D:\Projects\GitHub\service-builder`.
- Backend order authority: sibling `../dgp-sdk` at `D:\Projects\GitHub\elqora\digital-goods-protocol\dgp-sdk`.
- Sibling repositories: `../dgp-spec`, `../dgp-core`, `../dgp-validation`, and `../dgp-workspace`.
