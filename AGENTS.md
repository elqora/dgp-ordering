# Agent guidance: DGP Ordering

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository orchestrates customer interactions over valid, published `ProductDefinition` documents and constructs canonical `OrderSnapshot` payloads.

## Dependencies

- May depend on sibling `dgp-spec` and `dgp-core`.
- Must not depend on Validation, the Form Palette adapter, Workspace, Studio, Form Palette, or a host application.
- Framework bindings must remain separable from headless ordering behavior.

## Owned behavior

- Customer input state, selections, context-aware visibility integration, quantity resolution, customer-field validation, service resolution, and snapshot construction.
- Neutral form-store, field-binding, input-registry, and component-adapter contracts that hosts can implement without Form Palette.
- Exact browser utility calculations preserved from accepted behavior and serialized as advisory snapshot data.
- An injectable expression-executor contract and a default browser JavaScript executor.

## Expression contract

- Quantity and customer-field expressions are trusted host-authored browser JavaScript function bodies with arguments and return contracts declared by Spec.
- Do not require backend or non-browser SDKs to execute them.
- Missing source, thrown exceptions, and invalid results produce structured host-configuration failures.
- Do not construct or return a valid `OrderSnapshot` after an expression failure.
- Hosts may replace the executor, but replacements must preserve the ratified inputs, outputs, and failure semantics.

## Pricing and validation boundaries

- Utility calculations and their exact snapshot results are advisory. They must never become authoritative rates, final prices, or charges.
- SDK handlers validate submitted inputs and remain authoritative for rates, pricing, charges, and fulfillment.
- Validate customer-entered values, not definition coherence. Ordering must not depend on `dgp-validation` or expose editorial diagnostics to customers.
- Form Palette hooks, `InputField`, built-in descriptors, and convenience providers belong to sibling `dgp-ordering-form-palette`.

## Clean-break rule

Consume canonical v1 definitions only. Do not add legacy snapshot builders, field aliases, adapters, deprecated fields, or compatibility modes. This representation clean break does not permit reduced customer-order behavior; legacy code and tests remain binding behavioral evidence by default.

## Migration completeness

- Preserve proven behavior for default-value hydration, customer state, selection normalization, visible and hidden state, validation rules, quantity precedence, expressions, service evidence, field- and option-level utilities, bounds, fallbacks, and complete `OrderSnapshot` construction.
- Expression arguments, argument ordering, return handling, and failures are observable behavior. Any change requires explicit recorded user approval followed by Spec ratification; do not infer new semantics locally.
- Preserve advisory calculations exactly while keeping SDK handlers authoritative for final rates, prices, charges, and fulfillment.
- Port or replace the applicable legacy order-flow and snapshot tests, including contextual, recursive-option, stale-state, default-value, utility, and expression cases.
- Mark missing behavior as **pending migration**. Do not call Ordering complete or publish another stable release based only on a neutral store, one snapshot path, boundary checks, or happy-path tests.

## Protocol lifecycle and operations

- Spec owns shared representation, SDK owns backend pricing and fulfillment semantics, and the legacy engine supplies ordering behavior evidence to retain or improve. Ordering owns customer orchestration behavior without redefining shared contracts.
- Ratified means the versioned plain TypeScript contract, required JSON fixtures, rationale, and stable status are merged into `dgp-spec/main`; generated JSON Schemas must also be current once tooling exists. Released means that ratified Spec version is tagged and published.
- Update Ordering only after Spec ratification, Core/SDK alignment, and affected Validation work. Commit and release this repository independently before releasing its Form Palette adapter.
- Ordering may implement ratified unreleased contracts, but stable releases require the corresponding released Spec version.
- The package supports Node.js 22 or newer. Use `npm install`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run check:boundaries`; `npm run check` is the repository completion command.
- No generated outputs are committed. The verification gate must prevent Validation, Form Palette, Workspace, Studio, React, host-application, independently authored shared-contract, and dependency-boundary drift; passing it does not establish migration completeness.

## References

- Contract authority: sibling `../dgp-spec`; interpretation dependency: sibling `../dgp-core`.
- Shared-contract guide: sibling `../dgp-spec/CONTRACTS.md`.
- Backend authority for pricing and fulfillment: sibling `../dgp-sdk`.
- Legacy ordering evidence: `D:\Projects\GitHub\digital-service-ui-builder\src\react\hooks`, `src\react\inputs`, and `src\utils\build-order-snapshot`.
- Form Palette destination: sibling `../dgp-ordering-form-palette`.
- Studio source evidence: `D:\Projects\GitHub\service-builder`; destination: sibling `../dgp-studio`.
- Sibling: `../dgp-workspace`.

This repository remains GPL-3.0-only. Future manifests and source headers must use that exact SPDX identifier.
