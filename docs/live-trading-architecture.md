# Live Trading Architecture (Future, Disabled)

Stage A remains paper-only. This document defines a safe expansion path without enabling live orders.

## Planned modules

- Spot trading adapter
- Futures trading adapter (isolated mode only, leverage policy enforced)
- Options adapter (where supported by the selected Binance product/API)
- Unified order model
- Pre-trade risk engine
- Position/order reconciliation
- Kill switch and circuit breakers
- Manual approval gate
- Audit log
- API credential vault integration
- Paper/live environment separation

## Hard safety gates

1. Live trading is disabled by default.
2. Stage A cannot send real orders.
3. No withdrawal permission should ever be requested.
4. Live mode requires an explicit user approval action.
5. Risk limits must be validated server-side before order submission.
6. Kill switch must block new orders immediately.
7. Futures/options must remain separate from Spot risk accounting.
8. Every live order must have an audit record and client order ID.
9. Testnet/paper mode must be selectable independently of live mode.

## Rollout

Stage A: paper only.
Stage B: manual-approved micro live, only after review of paper results.
Stage C: controlled automation, only after Stage B review and explicit enablement.
