# DGP Ordering

DGP Ordering is the customer-facing orchestration runtime for Digital Goods Protocol product definitions. It turns already-published definitions into context-aware input flows and produces normalized `OrderSnapshot` payloads for DGP hosts and handlers.

## Responsibilities

- Customer input and selection state
- Context-aware form and option orchestration
- Customer-entered value validation
- Quantity and service selection resolution
- Order snapshot construction and hydration
- Framework bindings and default inputs when introduced

DGP Ordering trusts the publication boundary. Definition coherence, visibility-cycle analysis, rate coherence, and other editorial diagnostics belong to DGP Validation and DGP Workspace.

## Ecosystem

- [DGP Spec](https://github.com/elqora/dgp-spec) owns canonical contracts.
- [DGP Core](https://github.com/elqora/dgp-core) supplies interpretation primitives.
- [DGP Validation](https://github.com/elqora/dgp-validation) protects publication boundaries without becoming an ordering dependency.
- [DGP Workspace](https://github.com/elqora/dgp-workspace) authors and publishes definitions.
- [DGP SDK](https://github.com/elqora/dgp-sdk) consumes order snapshots for backend execution.
- [Digital Service Engine](https://github.com/timeax/digital-service-engine) is the legacy migration source and behavioral reference.

## Status

Repository scaffold only. Ordering extraction and migration will be planned separately.

## License

GPL-3.0.
