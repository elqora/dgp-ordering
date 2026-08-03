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

Consume canonical v1 definitions only. Do not add legacy snapshot builders, field aliases, adapters, deprecated fields, or compatibility modes. Legacy code and tests are behavioral evidence only.

## Protocol lifecycle and operations

- Ratified means the versioned schema, required fixtures, rationale, and stable status are merged into `dgp-spec/main`; released means that ratified Spec version is tagged and published.
- Update Ordering only after Spec ratification, Core/SDK alignment, and affected Validation work. Commit and release this repository independently before releasing its Form Palette adapter.
- Ordering may implement ratified unreleased contracts, but stable releases require the corresponding released Spec version.
- This repository has no implementation manifest or operational commands yet. Do not invent install, test, lint, type-check, build, or generation commands.
- When its toolchain is introduced, document all real commands, supported runtimes, generated-output policy, completion criteria, and checks preventing Validation, Form Palette, Studio, React, legacy-field, and generated-binding drift.

## References

- Contract authority: sibling `../dgp-spec`; interpretation dependency: sibling `../dgp-core`.
- Backend authority for pricing and fulfillment: sibling `../dgp-sdk`.
- Legacy ordering evidence: `D:\Projects\GitHub\digital-service-ui-builder\src\react\hooks`, `src\react\inputs`, and `src\utils\build-order-snapshot`.
- Form Palette destination: sibling `../dgp-ordering-form-palette`.
- Studio source evidence: `D:\Projects\GitHub\service-builder`; destination: sibling `../dgp-studio`.
- Sibling: `../dgp-workspace`.

This repository remains GPL-3.0-only. Future manifests and source headers must use that exact SPDX identifier.
