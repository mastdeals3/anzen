# SAPJ Accounting Bible

**Version:** Phase 2 audit baseline — 2026-07-25  
**Status:** Documentation only. This file makes no runtime, SQL, schema, or UI change.

## 1. Accounting source-of-truth rule

Financial statements and GL balances must be derived only from active journal lines:

```sql
journal_entries.is_posted = true
AND COALESCE(journal_entries.is_reversed, false) = false
```

This is the rule implemented by `20260724090000_active_journal_reporting_filters.sql` for `get_trial_balance` and `get_balance_sheet`.

Business-document reports, tax registers, and bank-statement views are **subledgers/projections**. They are operationally valid only when they reconcile to the active GL; they are not substitutes for it.

## 2. Canonical report classes

| Class | Reports | Canonical source | Reversed / inactive handling |
|---|---|---|---|
| Financial statements | Trial Balance, Balance Sheet, P&L | `get_trial_balance`, `get_balance_sheet` → active `journal_entries` + `journal_entry_lines` | Excluded |
| GL detail | Account Ledger (non-bank), CA Cash Ledger, CA General Ledger, CA Trial Balance, Petty Cash balance | Active journal lines | Excluded |
| Audit register | Journal Register, Journal Entry viewers | `journal_entries`, `journal_entry_lines`, `vw_journal_voucher` | Not consistently excluded; audit-only, not financial totals |
| Subledgers | Party, Customer, Supplier, AR, AP, Ageing | invoices, vouchers, allocations, expenses, credit notes | No journal-state filter; must reconcile to A/R or A/P GL |
| Bank controls | Bank Ledger, Bank Reconciliation | `bank_statement_lines` and document matches | Not a GL source; JE state only matters where a JE is matched |
| Statutory tax | PPN/PPh/tax-payment reports | tax views, periods, payment and invoice/expense records | Tax-engine statuses, not GL journal status |
| Dashboard | revenue, payment, profit, approval widgets | invoices, COGS RPC, workflow tables | No active-journal filter |

## 3. Required reconciliation contracts

1. A/R subledgers (Customer Ledger, Receivables, Ageing) reconcile to active A/R account 1120.
2. A/P subledgers (Supplier Ledger, Payables) reconcile to active A/P account 2110.
3. Cash Ledger and Petty Cash reconcile to their active GL accounts; Bank Ledger reconciles the statement balance to bank GL, rather than replacing it.
4. Tax registers reconcile statutory totals to PPN/PPh control accounts and tax payment journals.
5. Dashboard finance figures must be labelled as document-based KPIs unless moved to the active-GL reporting contract.

## 4. Multi-currency policy observed

`FinancialReports.tsx` passes a user-editable USD→IDR rate to the trial-balance and balance-sheet RPC overloads. Those RPCs convert only selected `purchase_invoice` and `payment` journals. They do not provide a complete transaction-currency or revaluation model for sales, expenses, bank/cash, manual journals, tax, or subledgers. Therefore **multi-currency reporting is partial, not fully reconciled**.

Operational bank reports retain a selected bank's native statement amounts. Other document and dashboard reports display IDR without a conversion/revaluation contract.

## 5. Non-negotiable interpretation rules

- Never use Journal Register totals unless it explicitly filters active journals.
- Never treat a bank statement line as a second GL transaction after the matched document JE exists.
- Do not infer a posted journal from a document payment status.
- Do not aggregate across currencies without an explicit reporting-rate/revaluation policy.
- Do not treat a PO register as a purchase-invoice/AP report.

See [ACCOUNTING_AUDIT.md](ACCOUNTING_AUDIT.md) for the complete report-by-report evidence and risk assessment.

## 6. Workflow design rules (Phase 3 audit)

- The primary document should be created once, then post and settle through a visible lifecycle; it should not require the accountant to recreate the same fact in another module.
- Defaults must come from master data, the originating document, and bank-import context. Accountants should only decide exceptions.
- Use business terms in primary navigation: **Supplier Bill**, **Customer Invoice**, **Receive Payment**, **Pay Bill**, **Transfer Money**, and **Bank Reconciliation**. Keep voucher/contra terminology in accounting detail where required.
- Each worklist must show the next action, status, linked journal, linked bank line, and exception reason in one place.
- A workflow may use a direct document subledger, but it must expose its journal/posting state and its reconciliation status to the relevant control account.

The current workflow evidence and UX-only recommendations are maintained in [ACCOUNTING_WORKFLOWS.md](ACCOUNTING_WORKFLOWS.md).

## 7. Stabilization implementation — 2026-07-25

The reporting contract is now implemented in `20260725090000_finance_stabilization_reporting_contracts.sql`:

- Trial Balance, Balance Sheet, the Trial-Balance-derived P&L, and `get_pnl_summary` share active-journal (`posted` and not reversed) filtering and the centralized reporting-rate multiplier.
- `get_customer_ar_open_items` is the authoritative AR worklist source for Receivables and Ageing. It accepts only active invoice/receipt/credit-note journals and nets approved credit notes, including oldest-first application of an unallocated customer credit.
- `get_control_account_reconciliation` compares AR 1120 and AP 2110 active GL balances with their subledgers; AR and AP worklists display its exception state.
- Dashboard financial totals use active GL; invoice charts remain expressly labelled as operational KPIs.
- Bank Ledger remains statement-native but now displays its selected bank GL balance and the reconciling difference. It is not presented as a replacement GL ledger.

The reporting-rate multiplier covers the currency-bearing source rows available in the current model (purchase invoices, payment vouchers, bank-backed receipts/transfers and bank-reconciliation entries). A transaction-currency/revaluation design for manual journals and source types with no stored currency remains required before claiming full multi-currency accounting.

Purchase Batch is deliberately unchanged.
