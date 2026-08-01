# Agent guidance: DGP Ordering

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository orchestrates customer interactions over valid, published product definitions and builds DGP order snapshots.

## Dependencies

- May depend on sibling `dgp-spec` and `dgp-core`.
- Must not depend on `dgp-validation` or `dgp-workspace`.
- Framework bindings must remain separable from the headless ordering state and behavior.

## Boundaries

- Validate customer-entered values, not product-definition coherence.
- Do not expose visibility, rate-coherence, constraint, or publication diagnostics to customers.
- Preserve the SDK's rate and charge model; do not treat catalog rate as a replacement pricing system.

## References

- Legacy ordering sources: `D:\Projects\GitHub\digital-service-ui-builder\src\react\hooks`, `src\react\inputs`, and `src\utils\build-order-snapshot`.
- Backend order contract: `D:\Projects\GitHub\elqora\dgp-sdk` and sibling `dgp-sdk`.
- Sibling repositories: `dgp-spec`, `dgp-core`, `dgp-validation`, and `dgp-workspace`.
