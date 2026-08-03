# Ordering migration evidence

The first DGP Ordering slice retains proven customer-order behavior while
removing frontend pricing authority and Form Palette coupling.

| Concern | Legacy evidence | DGP v1 disposition |
| --- | --- | --- |
| Visible customer state | `src/utils/build-order-snapshot/inputs.ts`, React ordering hooks | Retain visible-field input and selection collection; use Core visibility and a framework-neutral store. |
| Selection normalization | `selection.ts`, field input hooks | Retain deterministic option order and rejection of unavailable options; move cardinality into the host input registry instead of opaque product metadata. |
| Quantity | `quantity.ts` and snapshot quantity tests | Retain field rule, selected option, selected field, active filter, then host-default precedence. Expression failures no longer fall through silently. |
| Customer validation | legacy field-validation functions | Retain customer rule operators for visible fields. Publication coherence diagnostics remain in Validation. |
| Services | `services.ts` and service-map tests | Retain selected-node origins and filter fallback. Retire rate-based primary-service authority; preserve deterministic authored selection order. |
| Utilities | `utilities.ts` and utility snapshot tests | Retain flat, per-quantity, per-value, and percent calculations and now record the exact advisory result. Handlers remain authoritative for charges. |
| Expressions | quantity and field expression paths | Retain trusted browser JavaScript function bodies behind an injectable executor. Missing, throwing, or invalid expressions return structured host-configuration failures and prevent snapshots. |
| Form integration | direct Form Palette hooks/components | Redesign as neutral store, binding, input-registry, and component-adapter contracts. Concrete Form Palette integration moves to its adapter package. |

Retired: legacy snapshot aliases, camel-case wire keys, swallowed expression
errors, editorial diagnostics, React/Form Palette runtime dependencies,
frontend rate ranking, and the redundant field `component` property.
