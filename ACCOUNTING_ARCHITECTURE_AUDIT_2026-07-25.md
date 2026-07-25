# SAPJ ERP Accounting Architecture Audit — Phase 1

**Audit date:** 2026-07-25  
**Scope:** Read-only audit of the deployed migration source (`supabase/migrations`), React/Supabase consumers, and build.  
**Changes made:** None to business logic, schema, or UI. No tables created. `npm run build` passes.

## Audit boundary and definitions

`Active journal` means `journal_entries.is_posted = true AND COALESCE(is_reversed,false) = false`. This is the accounting population mandated by `20260724090000_active_journal_reporting_filters.sql`.

`Projection` means a report calculated from a business-document or bank-statement table rather than active `journal_entry_lines`. It can be useful operationally, but is not a GL financial statement.

`Legacy` means a screen/report still bypassing the active-journal reporting boundary, or using a predecessor document/table as its ledger.

## Dependency map

```text
Finance UI / Sales / Credit Notes / Tax UI / Bank Reconciliation
   │
   ├─ document and workflow tables
   │  purchase_orders, purchase_invoices(+items), finance_expenses,
   │  receipt_vouchers, payment_vouchers, voucher_allocations,
   │  sales_invoices(+items), credit_notes(+items),
   │  petty_cash_transactions, fund_transfers, tax_payments,
   │  bank_statement_lines, bank_reconciliations(+items)
   │
   ├─ posting triggers / RPCs
   │  post_*_journal, save_purchase_invoice,
   │  save_payment_voucher_with_allocations, record_tax_payment,
   │  record_non_customer_bank_receipt
   │
   ▼
journal_entries ──► journal_entry_lines ──► Chart of Accounts balances
   │                         │
   │                         ├─ active GL: Trial Balance, P&L, Balance Sheet,
   │                         │  Account Ledger, CA cash/bank/GL/TB reports
   │                         └─ audit register: Journal Entry Viewer / CA Journal Register
   │
   └─ links back to source rows / bank_statement_lines / audit_logs

Separate operational projections (not GL): Party Ledger, Receivables,
Payables, Ageing, Sales & Purchase registers, sales dashboards, Tax views,
and Bank Ledger/Reconciliation.
```

## Per-document matrix

| Document | What creates it now | Required / implemented journal | Tables changed by creation/posting | Current consumers | Should consume it | Audit finding |
|---|---|---|---|---|---|---|
| Purchase | `PurchaseOrders.tsx` writes `purchase_orders` / items; approval changes status | **No GL JE.** A PO is a commitment; inventory/AP arise at purchase invoice/GRN, not PO | `purchase_orders`, purchase-order items, audit/workflow tables | CA **Purchase Register** actually queries `purchase_orders` | Procurement commitment/open-PO report only | Label says “purchase invoices” but source is PO: legacy/mislabelled projection. No financial statement should consume it. |
| Purchase Invoice | `PurchaseInvoiceManager` calls `save_purchase_invoice`; protected delete RPC removes descendants | Dr inventory/expense; Dr Input PPN (1150); Dr stamp duty expense if applicable; Cr A/P (2110). Current before-trigger also links invoice `journal_entry_id` | `purchase_invoices`, `purchase_invoice_items`, `journal_entries`, `journal_entry_lines`, `tax_periods`/tax computation, `voucher_allocations` payment state, batches/inventory links | Party Ledger, Payables, Tax Input PPN views, CA Purchase Register **does not**, active GL reports | AP, supplier ledger, Input PPN, TB/P&L/BS, purchase register, reconciliation | Purchase Register is wrong source (PO). Party/AP are document projections, not GL. |
| Expense | `ExpenseManager` inserts/updates `finance_expenses`; import-container automation can create import rows | Approved paid: Dr category/asset/PIB accounts + Input PPN/stamp/bank charges; Cr bank/cash/petty cash. Approved bill: same debits; Cr A/P. PPh withheld is Cr 2132. | `finance_expenses`, `journal_entries`, `journal_entry_lines`, tax periods/views, container allocation fields; bank-line match/payment-state links | Payables, Party Ledger, Tax Input/PPh, bank reconciliation, dashboard expense KPI, active GL reports | AP, expense/PPN/PPh registers, TB/P&L/BS, supplier/staff ledger, bank reconciliation | GL posting is strict as of 2026-07-23. Payables/Party Ledger are projections and must reconcile to AP GL. |
| Receipt | `ReceiptVoucherManager` writes `receipt_vouchers` and allocations | Dr bank/cash; Cr A/R (1120), tagged customer; allocations settle sales invoices | `receipt_vouchers`, `voucher_allocations`, `sales_invoices.paid_amount/balance/payment_status`, `journal_*`, bank statement links | Receivables, Party Ledger, CA Sales Register payment date, Bank Ledger/Reconciliation, active GL reports | AR, customer ledger, cash/bank, TB/BS, ageing (indirectly through invoice settlement) | Legacy AR/Party screens read vouchers/invoices directly, without active-JE gate. |
| Payment | `PaymentVoucherManager` / reconciliation use `save_payment_voucher_with_allocations` | Dr A/P (or staff payable/advance adjustment); Cr bank/cash; Cr PPh payable for withholding. Gross voucher amount is allocated to invoice/bill. | `payment_vouchers`, `voucher_allocations`, purchase-invoice and expense paid state, `journal_*`, bank-line links | Payables, Party Ledger, PPh Register, Bank Reconciliation, active GL reports | AP, supplier/staff ledger, PPh payable, cash/bank, TB/BS | Direct-document ledger consumers remain; their status must not be treated as proof of posted GL. |
| Contra | `FundTransferManager` writes `fund_transfers`; undo/reverse RPCs manage status and linked journals | Dr destination bank/cash/petty cash; Cr source bank/cash/petty cash. FX difference must be explicit when amounts differ. | `fund_transfers`, `journal_*`, bank statement links, audit logs. New design prevents fund-transfer projections in petty cash. | Bank Ledger/Reconciliation, Account Ledger, Journal Register, active GL reports | Cash/bank/petty cash GL, TB/BS, bank reconciliation | Historical petty-cash projection rows are explicitly excluded from posting. Do not report them as transactions. |
| Journal | `GeneralJournalEntry` inserts `journal_entries` then `journal_entry_lines` directly | User-entered balanced Dr=Cr; must be posted, reversible, and linked to source only when it is the authoritative document | `journal_entries`, `journal_entry_lines`, bank statement link only for approved supported flows | Journal viewers, Account Ledger, active GL reports, Bank Reconciliation | GL/TB/P&L/BS and auditable journal register | General journal is the only UI for loans/adjustments; no dedicated Loan or Capital document table/screen exists. |
| Sales Invoice | `Sales.tsx` inserts/updates `sales_invoices` / items; before trigger posts | Dr A/R; Cr revenue (4100); Cr Output PPN (2130); Cr stamp-duty recovery (6950 where used); Dr COGS / Cr inventory | `sales_invoices`, items, `journal_*`, inventory/batches, tax periods/faktur, receipt allocation payment state | Sales reports/dashboard, Receivables, Party Ledger, Ageing, Tax Output PPN, active GL reports | AR, revenue/COGS/inventory, Output PPN, TB/P&L/BS, customer ledger/ageing | Most sales screens/reports are document projections and omit the active-JE validity condition. |
| Credit Note | `CreditNotes.tsx` writes `credit_notes` / items then approves | Dr sales returns (4300); Dr Output PPN reversal; Cr A/R. If stock returned: Dr inventory / Cr COGS (second JE) | `credit_notes`, items, tax period, `journal_*`, inventory/batches, bank-link cleanup on reversal/delete | Party Ledger, tax period/output PPN calculation, active GL reports | AR, sales-return/PPN/COGS/inventory, TB/P&L/BS, customer ledger/ageing | Fully integrated only from 2026-07-14. Ageing/Receivables do not directly subtract approved credit notes: legacy risk. |
| Debit Note | No UI, table, migration, posting function, or report consumer found | If supplier debit note: Dr A/P / Cr inventory-expense/Input PPN as appropriate; if customer debit note: mirror additional sales invoice | **None implemented** | None | AP/AR, tax, GL after a source document exists | Unsupported document; do not simulate with untyped manual journal if an operational debit-note lifecycle is required. |
| Petty Cash | `PettyCashManager` writes `petty_cash_transactions`; transfers use `fund_transfers` instead | Inflow: Dr petty cash 1102 / Cr selected bank or source GL. Expense: Dr mapped expense / Cr 1102. Fund-transfer projection rows produce no JE. | `petty_cash_transactions`, optional documents/files, `journal_*`, bank-line links | Petty Cash balance, Account Ledger, Bank Reconciliation, active GL reports | Cash ledger, TB/BS, expense P&L, bank reconciliation | Current balance is GL-backed. UI history contains non-posting transfer projections and must be labelled/non-financial. |
| Bank Reconciliation | `BankReconciliationEnhanced` imports/edits `bank_statement_lines`, links a supported document or calls non-customer receipt RPC | **Normally no new JE:** matching proves settlement. Non-customer credit creates Dr bank / Cr capital, loan, interest, or income via `record_non_customer_bank_receipt`. | `bank_statement_lines`, `bank_reconciliations`, reconciliation items, matched-document fields; possibly `journal_*` | Bank Ledger/Reconciliation; screen offers document candidates | Bank reconciliation report, not TB/P&L/BS as its own transaction | It is a matching/control process. Treating a statement line as independent GL creates duplicates. |
| Fund Transfer | Same as Contra (separate named item in requested scope) | Same as Contra | Same as Contra | Same as Contra | Same as Contra | No separate finance document; it is the Contra implementation. |
| Loan | Only `GeneralJournalEntry` templates; bank reconciliation can classify a statement receipt as loan | Receipt: Dr bank / Cr 2210 (or 2220 director loan). Repayment: Dr loan liability / Cr bank; interest separately Dr finance expense / Cr bank | Manual: `journal_*`; reconciliation receipt: `bank_statement_lines` + `journal_*` | Account Ledger and active GL; bank reconciliation | Loan schedule/subledger, TB/BS, cash flow | No `loans` document/table/screen. Capital/loan classifications in Bank Reconciliation write journal-only records. |
| Capital Injection | Bank reconciliation “capital” classification creates a journal-only receipt | Dr bank / Cr capital/equity 3100 | `bank_statement_lines`, `journal_*` (the unused `capital_contributions` table is indexed but not a current creation path) | Account Ledger, active GL, Bank Reconciliation | Equity roll-forward, TB/BS, cash flow | No Capital Injection finance screen; `capital_contributions` is orphaned from the UI/posting engine. |
| Tax Payment | Tax Payments UI calls `record_tax_payment`, edit/delete RPCs | Dr tax payable (PPN/PPh liability); Cr selected bank. Payment is then matched to bank line; delete/repost reverses/refreshes JE | `tax_payments`, tax-period totals/status, `journal_*`, attachments, `bank_statement_lines`, audit logs | Tax Payments Register, Tax dashboard, Bank Reconciliation, active GL reports | Tax liability, bank, TB/BS, tax reconciliation | Tax payment register is direct-table operational evidence; financial statements must use active JE. |

## Report and screen lineage

### Active-journal consumers (correct accounting population)

| Consumer | Evidence / source | Result |
|---|---|---|
| Financial Reports: Trial Balance, P&L, Balance Sheet | `get_trial_balance` and `get_balance_sheet` rebuilt 2026-07-24 | Active posted, non-reversed `journal_entries` joined to lines. Correct authoritative statements. |
| Account Ledger (non-bank accounts) | `AccountLedger.tsx` filters `journal_entries.is_posted=true` and `is_reversed=false` | Active GL lines. Correct. |
| CA Cash Ledger, Bank Ledger, General Ledger, CA Trial Balance | `CAReports.tsx` filters posted/non-reversed (except its Journal Register) | Active GL lines. Correct for financial ledger use. |
| Petty Cash balance | `get_petty_cash_balance()` | Active posted 1102 movement. Correct. |

### Reports/screens reading inactive journals

These are audit-history views, not financial reports. They need an explicit “includes drafts/reversals” label or a default active-only filter before being used as a register total.

| Consumer | Why |
|---|---|
| `CAReports` → **Journal Register** | Fetches all `journal_entries` in date range without `is_posted` / `is_reversed` filter, then reads lines. |
| `JournalEntryViewer.tsx` | Fetches all `journal_entries` by date. |
| `JournalEntryViewerEnhanced.tsx` / `vw_journal_voucher` path | No active-status filter is applied in the screen query; intended as voucher/audit viewer. |
| Bank Reconciliation candidate and detail queries | Read JEs for matching/audit, not a financial report; status is not consistently used as an eligibility filter. |

### Projection and direct-voucher consumers

| Consumer | Reads | Classification / risk |
|---|---|---|
| Party Ledger | `sales_invoices`, `receipt_vouchers`, `credit_notes`, `purchase_invoices`, `finance_expenses`, `payment_vouchers` | Direct voucher/document ledger. Does not prove a JE exists/active; credit-note coverage is customer-only and no debit notes exist. |
| Receivables and Ageing | `sales_invoices`, receipt allocations/RPCs | AR projection. Excludes credit-note netting from its own source logic. |
| Payables | purchase invoices + `get_outstanding_expense_bills` + allocations | AP projection. Must reconcile to 2110 GL, not replace it. |
| CA Sales Register | `sales_invoices` + `voucher_allocations` / receipts | Sales projection. |
| CA Purchase Register | **`purchase_orders`** | Procurement projection with a misleading “purchase invoices” description. |
| Sales dashboard, RevenueChart, Sales Profit/Reports | sales invoices and report RPCs | Sales projection. Audit/report functions need their own active-JE reconciliation test. |
| Bank Ledger | `bank_statement_lines` plus document lookups | Bank-statement projection, not a GL bank ledger despite the name. |
| Tax reports | `vw_input_ppn_report`, `vw_output_ppn_report`, monthly/tax-period views, `tax_payments` | Tax-engine/document projections. They intentionally read tax document fields; GL is a reconciliation target. |
| Bank Reconciliation | statement lines plus direct references to expenses, receipts, payments, transfers, petty cash, tax payments and JEs | Operational matching workflow; direct voucher reading is expected but must never feed TB/P&L/BS independently. |

## Answer to the ten required questions

1. **What creates each document?** The per-document matrix names every discovered UI/RPC/trigger creation path. Debit Note has none; Loan and Capital Injection are manual-journal or bank-statement classifications, not document modules.
2. **What journal should it generate?** The matrix states the required double-entry for each. Purchase order and bank matching do not create journals. Fund Transfer and Contra are one flow.
3. **Which tables update?** Matrix tables list source plus posting/settlement tables. Every posting source should reference the resulting `journal_entries` record where the schema provides a link.
4. **Which reports consume it?** Listed in the matrix and lineage tables.
5. **Which reports should consume it?** Listed in the matrix. Authoritative financial reports must consume active GL lines only.
6. **Which screens use legacy logic?** Party Ledger, Receivables, Payables, Ageing, CA Sales/Purchase Register, Bank Ledger, Journal viewers, sales dashboards/reports, and reconciliation are all direct-table or projection consumers. The most concrete defects are CA Purchase Register sourcing POs and AR/Ageing not directly accounting for approved credit notes.
7. **Which reports read inactive journals?** CA Journal Register, both Journal Entry viewers, and bank-reconciliation JE audit/match paths. The first three should not be treated as financial totals.
8. **Which reports read projections?** All entries in the Projection table above; operational tax reports are deliberately projections.
9. **Which reports read active journals?** Financial Reports, Account Ledger (non-bank), CA cash/bank/general-ledger/trial-balance, and Petty Cash balance.
10. **Which reports read voucher tables directly?** Party Ledger, Receivables, Payables, Ageing, CA sales/purchase registers, Bank Ledger/Reconciliation, tax screens, and sales/dashboard reports (detailed above).

## Architecture risks to resolve only after audit approval

1. **Single financial-report contract:** make active posted/non-reversed JE lines the sole financial-statement dataset; preserve direct-table screens as labelled subledgers/projections with reconciliations.
2. **Posting completeness gate:** document report rows should expose `journal_entry_id`, active status, and “unposted/failed” exceptions rather than silently appearing in operational ledgers.
3. **Credit note propagation:** reconcile AR/ageing/report projections with approved credit-note allocations or use the active A/R subledger.
4. **Purchase register correction:** either rename it “Purchase Order Register” or source posted `purchase_invoices`; do not change it blindly because the business meaning is currently ambiguous.
5. **Missing document models:** Debit Note, Loan, and Capital Injection lack dedicated lifecycle tables/screens. A new table is not justified until the required approval, settlement, tax, and reporting behavior is specified.
6. **Projection cleanup:** fund-transfer petty-cash rows are historical UI projections; exclude them from balances and avoid treating statement rows as GL transactions.

## Evidence anchors

- Active reporting boundary: `supabase/migrations/20260724090000_active_journal_reporting_filters.sql`.
- Strict expense/petty-cash posting: `supabase/migrations/20260723130000_strict_je_posting_and_repair_orphans.sql` and `20260723150000_petty_cash_accounting_architecture.sql`.
- Credit-note integration: `supabase/migrations/20260714190000_credit_note_accounting_integration.sql`.
- Non-customer capital/loan bank receipts: `supabase/migrations/20260723234500_record_non_customer_bank_receipt.sql`.
- UI routing and document modules: `src/pages/Finance.tsx`.
- Direct-report query paths: `src/components/finance/{CAReports,PartyLedger,ReceivablesManager,PayablesManager,AccountLedger,BankLedger,BankReconciliationEnhanced}.tsx`, `src/pages/reports/AgeingReport.tsx`, and `src/components/finance/tax/TaxReportsPanel.tsx`.
