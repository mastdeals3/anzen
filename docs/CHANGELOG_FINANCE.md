# Finance Changelog

## 2026-07-25 — Phase 2 Finance Architecture Audit

### Added documentation

- `docs/ACCOUNTING_BIBLE.md` — source-of-truth and reconciliation rules.
- `docs/ACCOUNTING_ARCHITECTURE.md` — report dependency map and component lineage.
- `docs/ACCOUNTING_AUDIT.md` — complete report audit, severity assessment, consistency score, and proposed future fix order.
- `docs/CHANGELOG_FINANCE.md` — this entry.

### Explicit non-changes

- No business logic changed.
- No SQL changed.
- No migrations created or changed.
- No tables or views created.
- No UI changed.
- No accounting issue was fixed.

### Verification

- `npm run build` passed after the documentation update (Vite production build).

## 2026-07-25 — Phase 3 Finance Workflow Audit

### Added / updated documentation

- Added `docs/ACCOUNTING_WORKFLOWS.md` with all requested finance-module workflows, benchmark comparison, click estimates, automation opportunities, terminology findings, UX recommendations, top 20 improvements, and UX-only roadmap.
- Updated `docs/ACCOUNTING_BIBLE.md` with finance workflow design rules.
- Updated `docs/ACCOUNTING_AUDIT.md` with the Phase 3 outcome and workflow score.

### Explicit non-changes

- No code changed.
- No SQL changed.
- No migrations created or changed.
- No UX recommendation was implemented.

### Verification

- `npm run build` must be rerun after this documentation update.

## 2026-07-25 — Finance Stabilization Sprint

### Reporting and reconciliation

- Added `20260725090000_finance_stabilization_reporting_contracts.sql`.
- Centralized reporting-rate selection through `get_journal_reporting_multiplier`; TB, BS, P&L summary and the existing TB-derived P&L now apply the active posted/non-reversed journal contract.
- Added `get_customer_ar_open_items` to net active receipts and approved credit notes into AR/Ageing, including oldest-first handling of unallocated customer credit.
- Added `get_control_account_reconciliation` for AR 1120 and AP 2110 exception visibility.
- Added `get_finance_dashboard_summary` and switched dashboard financial totals to active GL/open-item sources.
- Added an active bank-GL-versus-statement comparison to Bank Ledger.

### Workflow clarity

- Renamed primary navigation/actions to Supplier Bills, Receive Payment, Pay Bills, Transfer Money, Top Up Petty Cash and Record Cash Expense.
- Made bank-match review/accept wording explicit.
- Added guided owner-contribution journal template alongside existing loan templates; no Loan or Capital table was introduced.

### Deliberate exclusions and remaining controls

- Purchase Batch workflow was not modified.
- Full transaction-currency and period-end FX revaluation remain future work.
- Tax-control reconciliation, journal-audit register mode, Party Ledger/Supplier Ledger control contracts, and dedicated Debit Note/Loan/Capital lifecycles remain open.
