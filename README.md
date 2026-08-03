# DGP Ordering

DGP Ordering is the customer-facing orchestration runtime for Digital Goods Protocol product definitions. It turns already-published definitions into context-aware input flows and produces normalized `OrderSnapshot` payloads for DGP hosts and handlers.

## Responsibilities

- Customer input and selection state
- Context-aware form and option orchestration
- Customer-entered value validation
- Quantity and service selection resolution
- Order snapshot construction and hydration
- Neutral form-store, field-binding, input-registry, and component-adapter contracts
- Framework-neutral host integration contracts; concrete bindings live in adapter packages

DGP Ordering trusts the publication boundary. Definition coherence, visibility-cycle analysis, rate coherence, and other editorial diagnostics belong to DGP Validation and DGP Workspace.

## Ecosystem

- [DGP Spec](https://github.com/elqora/dgp-spec) owns canonical contracts.
- [DGP Core](https://github.com/elqora/dgp-core) supplies interpretation primitives.
- [DGP Validation](https://github.com/elqora/dgp-validation) protects publication boundaries without becoming an ordering dependency.
- [DGP Ordering Form Palette](https://github.com/elqora/dgp-ordering-form-palette) supplies the optional batteries-included Form Palette integration.
- [DGP Workspace](https://github.com/elqora/dgp-workspace) orchestrates editorial sessions and publication state.
- [DGP Studio](https://github.com/elqora/dgp-studio) authors, tests, previews, and publishes definitions.
- [DGP SDK](https://github.com/elqora/dgp-sdk) consumes order snapshots for backend execution.
- [Digital Service Engine](https://github.com/timeax/digital-service-engine) is the legacy migration source and behavioral reference.

## Runtime boundaries

Ordering consumes already-published canonical definitions. It uses DGP Core for
context and visibility, validates customer-entered values, resolves quantity and
service evidence, and constructs canonical snapshots. It never performs
publication validation or determines authoritative prices and charges.

The default browser JavaScript expression executor runs trusted host-authored
function bodies with the canonical `value` and `values` arguments. Hosts can
inject a replacement executor. Missing, throwing, and invalid expressions return
structured host-configuration failures and prevent snapshot construction.

Utility calculations record their exact browser result as `advisory_amount`.
Percent utilities use supplied advisory service amounts when present and otherwise
use handler catalog rates; handlers must independently calculate final charges.
The arithmetic is deterministic: flat uses `rate`, per-quantity uses
`rate × quantity`, per-value uses `rate × resolved value`, and percent uses
`base amount × rate ÷ 100`. The `all` percent base includes prior advisory
utility lines in authored selection order.

## Toolchain

DGP Ordering supports Node.js 22 or newer and npm with the committed lockfile.

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run check:boundaries
npm run build
npm run check
```

`npm run check` is the completion command. During coordinated development,
sibling Spec and Core packages may be connected with `npm link`; stable releases
replace those links with released semver dependencies and a registry-resolved
lockfile.

## License

GPL-3.0-only.
