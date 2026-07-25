# SAPJ Finance Reporting Architecture

**Audit snapshot:** 2026-07-25. Documentation-only Phase 2 output.

## Reporting dependency map

```text
Business documents / settlement workflow
  sales_invoices, purchase_invoices, finance_expenses,
  receipt_vouchers, payment_vouchers, credit_notes,
  petty_cash_transactions, fund_transfers, tax_payments
                 │
                 ▼
    journal_entries ──► journal_entry_lines ──► chart_of_accounts
                 │                 │
                 │                 ├─ get_trial_balance → Trial Balance / P&L
                 │                 ├─ get_balance_sheet → Balance Sheet
                 │                 ├─ Account Ledger / CA GL/Cash/Bank reports
                 │                 └─ Petty Cash GL balance
                 │
                 └─ audit-only Journal Register / viewers

Operational source layers (separate from GL):
  voucher_allocations → AR/AP/party/ageing projections
  bank_statement_lines → Bank Ledger / Bank Reconciliation
  tax periods + tax views → statutory tax reports
  sales invoices + COGS RPC → dashboard finance widgets
```

## Active GL boundary

The active reporting boundary is `is_posted=true AND is_reversed=false`. It is enforced in the active-journal reporting migration and in Account Ledger's non-bank query. It is **not** consistently enforced in Journal Register/viewer, bank-statement, document-subledger, tax, or dashboard paths.

## Component-to-source map

| Component / report | Sources |
|---|---|
| FinancialReports (TB/P&L/BS) | `get_reporting_usd_rate`, `get_trial_balance`, `get_balance_sheet` |
| Account Ledger | `chart_of_accounts`; active `journal_entry_lines` / joined `journal_entries`; bank-account branch uses `bank_statement_lines` |
| CA Reports | COA; active JE lines for Cash/Bank/General Ledger/TB; all JE lines for Journal Register; direct `sales_invoices` for Sales Register; direct `purchase_orders` for Purchase Register |
| Party Ledger | `sales_invoices`, `receipt_vouchers`, `credit_notes`, `purchase_invoices`, `finance_expenses`, `payment_vouchers` |
| Receivables / Ageing | `sales_invoices`, `receipt_vouchers`, `voucher_allocations`, `get_invoice_paid_amount`, `get_overdue_balances` |
| Payables | `purchase_invoices`, `finance_expenses`, `payment_vouchers`, `voucher_allocations`, `get_outstanding_expense_bills` |
| Bank Ledger / Reconciliation | `bank_statement_lines`, bank accounts, source document lookups, matching fields, selected JEs |
| Petty Cash | `petty_cash_transactions`, `vw_fund_transfers_detailed`, `get_petty_cash_balance`, JE and bank-line links |
| Tax Reports | `vw_input_ppn_report`, `vw_output_ppn_report`, `vw_ppn_net_by_period`, `vw_pph_by_period_type`, `vw_outstanding_tax`, `vw_monthly_tax_summary`, `tax_payments`, `faktur_pajak`, `audit_logs` |
| Dashboard widgets | `sales_invoices`, `finance_expenses`, `petty_cash_transactions`, `get_cogs_for_period`, `get_overdue_balances`, tax dashboard views |

## Architectural conclusions

- Active GL financial reporting is structurally sound for journal state but its FX conversion coverage is incomplete.
- Document-based subledgers are not consistently bound to active JEs and need explicit control-account reconciliations.
- Bank reporting is statement-driven. This is suitable for reconciliation, but it is not a General Ledger bank report.
- Journal audit views retain inactive/reversed entries and cannot be used to establish financial totals.
- The Purchase Register is a PO register in implementation, not a purchase-invoice register.

The evidence, severity, and fix sequence are maintained in [ACCOUNTING_AUDIT.md](ACCOUNTING_AUDIT.md).

## Stabilized dependency map — 2026-07-25

```text
active journal_entries + journal_entry_lines
  ├─ get_journal_reporting_multiplier
  │   ├─ get_trial_balance ───────────────► Trial Balance / P&L
  │   ├─ get_balance_sheet ───────────────► Balance Sheet
  │   └─ get_pnl_summary ────────────────► legacy summary consumers
  ├─ get_customer_ar_open_items ─────────► Receivables / Ageing
  │   └─ approved credit notes + active receipts net A/R
  ├─ get_control_account_reconciliation ─► AR/AP exception banners
  └─ get_finance_dashboard_summary ──────► dashboard financial totals

bank_statement_lines + selected bank COA
  └─ Bank Ledger statement detail + active-GL comparison
```

The statement, tax, party-ledger and journal-audit paths remain operational/audit views until their own active-GL reconciliation contracts are implemented. Purchase Batch is excluded from this stabilization change.
