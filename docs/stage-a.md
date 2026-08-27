# Stage A — Paper Trading Specification

## Objective
Validate a deterministic trading strategy with zero real-money exposure before any live Binance integration.

## Rules
1. Starting virtual equity is ₹2,000.
2. Only BTCUSDT and ETHUSDT are eligible.
3. Risk per trade is capped at 1% of current virtual equity.
4. Maximum 3 new trades per trading day.
5. Trading pauses after 3 consecutive losing trades.
6. No futures and no leverage.
7. Fees and slippage are simulated on every completed trade.
8. A trade is counted only after it is fully closed.
9. Target is 100 completed paper trades.
10. No Binance API credentials are accepted by Stage A.

## Required report
After 100 completed trades calculate net P&L, win rate, profit factor, maximum drawdown, average R:R, total fees/slippage, and equity curve.

## Gate to Stage B
Stage B must not be enabled automatically. Results must be reviewed first, and live trading remains disabled in Stage A.
