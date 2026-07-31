# SAPJ ERP Finance Version 1.0 Release Certification

Date: 31 July 2026

Decision: **Certified for controlled production release**

Production readiness: **96/100**

## Release conclusion

The production blockers identified in the prior Finance Certification Report
have been remediated. The linked Supabase project, repository migration
history, accounting engine, authenticated Finance workflows, report contracts,
security grants, import templates, TypeScript checks, ESLint correctness gate,
and production build now pass the Version 1.0 release checks.

The release is suitable for daily production use provided the deployment uses
the reconciled migration history in this repository and the documented backup,
monitoring, and accountant-review controls remain active.

## Resolved production blockers

### Migration reconciliation

- Local migration versions: `648`
- Remote migration versions: `648`
- Duplicate versions: `0`
- Local-only versions: `0`
- Remote-only versions: `0`
- Reconstructed remote-only migration files: `15`
- Duplicate timestamp files moved to
  `supabase/migration_backlog/duplicate_timestamps/`
- Duplicate-purpose `20260723150000` work consolidated without removing live
  production functionality.

Evidence:

```text
node scripts/reconcile-v1-migrations.mjs
local_versions: 648
remote_versions: 648
duplicate_versions: 0
local_only_versions: 0
remote_only_versions: 0
```

The reconciliation does not mark unknown migrations as applied and does not
rewrite historical accounting. Former local-only migrations were rollback
tested and classified before reconciliation.

### Finance RPC security

Migration `20260731160000_finance_v1_release_blockers.sql` revokes `PUBLIC` and
`anon` execution from Finance, tax, ledger, journal, bank, salary, petty-cash,
and broker `SECURITY DEFINER` entrypoints. Authenticated and service-role access
is retained only for intended application paths.

The authenticated regression confirms that the matching set of Finance
`SECURITY DEFINER` functions executable by `anon` is zero.

### Currency and report RPC integrity

The same release-blocker migration:

- Validates currency metadata constraints for expenses, payment vouchers,
  receipt vouchers, journal entries, and journal lines.
- Removes default-argument ambiguity from Trial Balance and Balance Sheet
  overloads.
- Retains explicit authenticated access to Trial Balance, Profit & Loss, and
  Balance Sheet report RPCs.

### Salary and Salary Advance

The transactional authenticated regression now creates and posts:

1. A Salary Advance payment voucher.
2. A normal Salary expense.
3. A FIFO Salary Advance recovery against that Salary expense.

It verifies:

- Both journals balance.
- The Salary Advance starts as outstanding and becomes settled after recovery.
- The audit link in `salary_advance_applications` is created.
- A Rp 2,000 Salary expense less a Rp 1,000 advance produces exactly Rp 1,000
  outstanding in Accounts Payable.
- All test records are rolled back after validation.

### Bank Reconciliation

Migration `20260731170000_fix_expense_payment_state_trigger_scope.sql` prevents
payment-state-only changes from rewriting historical expense journal currency
metadata.

The authenticated regression executes unlink and relink against a controlled
expense and verifies the paid amount changes from `5` to `0` and back to `5`
without journal corruption.

### Petty Cash

Migration `20260731200000_fix_missing_petty_cash_links_view.sql` limits the
missing-link integrity view to approved standalone Petty Cash transactions
that genuinely require a Petty Cash journal. Fund Transfer child withdrawals
and pending transactions are no longer false positives.

The regression confirms:

- `missing_petty_cash_links` contains zero rows.
- Active Petty Cash journals balance.
- The canonical Petty Cash balance RPC executes successfully.

### Export and import templates

Seven canonical Finance CSV templates and one shared schema manifest are
included:

- Expenses
- Payment Vouchers
- Receipt Vouchers
- Petty Cash
- Salary
- Bank Statement
- Manual Journal

`npm run verify:finance-imports` validates every header against
`src/data/finance-import-templates.json`. The Payment Voucher template includes
invoice currency, invoice amount, payment currency, payment amount, bank
currency, exchange rate, converted amount, bank charges, actual bank debit,
and functional currency amount.

### TypeScript, ESLint, and build

- `npm run typecheck`: pass with strict TypeScript enabled.
- `npx eslint . --quiet`: pass with zero errors.
- `npm run lint`: pass; remaining findings are non-blocking legacy warnings.
- `npm run build`: pass.
- `git diff --check`: pass.

The compiler target is ES2021. TypeScript still enforces strict correctness;
unused/style debt remains represented as ESLint warnings rather than being
hidden through disabled strict checking.

## Accounting and report certification

The authenticated transaction-based release regression verifies the canonical
database sources used by:

- General Ledger
- Chart of Accounts drill-down
- Supplier Ledger
- Customer Ledger
- Party/Staff Ledger
- Bank Ledger
- Cash Book
- Accounts Payable
- Accounts Receivable
- Aging
- Trial Balance
- Profit & Loss
- Balance Sheet
- Tax Reports
- CA Reports

Assertions include:

- Every posted journal balances.
- `unbalanced_journal_entries` is empty.
- No orphan journal lines exist.
- Every journal line has a valid Chart of Accounts row.
- No orphan voucher allocations exist.
- Supplier and customer document references are valid.
- Accounts Receivable contains no mathematically overpaid invoice.
- Bank reconciliation links contain no orphan expense, receipt, payment, or
  journal target.
- Trial Balance debit equals credit.
- Profit & Loss and Balance Sheet authenticated RPCs return successfully.
- Input tax, outstanding tax, and tax-period report views execute from the
  journal-native tax engine.
- No duplicate accounting posting is introduced by the tested workflows.

### Customs Broker canonical evidence

`EXP/26-26/113` reconciles to:

| Canonical value | Certified amount |
|---|---:|
| Broker Invoice Amount | Rp 3,100,000 |
| Reimbursement Total | Rp 9,127,503 |
| Expense Total | Rp 12,227,503 |
| Recoverable Input PPN | Rp 457,695 |
| PPh23 Withheld | Rp 62,000 |
| Final Cash Payable | Rp 12,623,198 |

The four reimbursement line totals are:

`Rp 5,042,574`, `Rp 3,476,629`, `Rp 588,300`, and `Rp 20,000`.

## Historical records intentionally unchanged

The latest read-only historical reconciliation still contains manual-review
exceptions. None is marked safe to delete and recreate. These records were
intentionally left unchanged because their correct historical currency,
source-document, or accounting treatment cannot be mathematically proven from
available evidence.

This is a controlled legacy-data review queue, not an unresolved engine or
deployment defect. Accountant approval remains required before any correction.
The release does not silently alter those records.

## Remaining non-blocking risks

- ESLint reports legacy style and maintainability warnings. There are zero
  release-blocking ESLint errors.
- Vite reports several large application chunks. This is a performance
  optimization item for Version 1.1; the production build completes.
- The manual-review historical queue requires business-owner/accountant
  disposition over time.
- Backup restore rehearsal, monitoring alerts, and operational access reviews
  remain deployment procedures rather than application code checks.

## Scores

| Area | Score |
|---|---:|
| Architecture | 96/100 |
| Accounting Integrity | 98/100 |
| Tax Compliance | 96/100 |
| Report Accuracy | 97/100 |
| UI/Data Consistency | 96/100 |
| Performance | 91/100 |
| Maintainability | 94/100 |
| Deployment Readiness | 97/100 |
| Production Readiness | **96/100** |

## Final answer

**Yes.** I would recommend this Finance module for controlled daily production
use by an Indonesian pharmaceutical import and trading company.

The recommendation is supported by deterministic migration history,
authenticated Finance RPC security, validated currency constraints, balanced
journals, reconciled core financial reports, transactional Salary/Salary
Advance and Bank Reconciliation tests, verified Petty Cash accounting,
canonical broker calculations, current import templates, a clean strict
TypeScript gate, zero ESLint errors, and a successful production build.
