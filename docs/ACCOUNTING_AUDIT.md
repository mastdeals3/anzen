# SAPJ Finance Report Audit — Phase 2

**Date:** 2026-07-25  
**Scope:** Read-only analysis of the React client and `supabase/migrations` source of truth. No SQL, migration, UI, or business-logic changes were made.  
**Scoring:** architecture consistency only; it is not a live-data reconciliation result.

## Legend

- **Journal source:** reads `journal_entries`/`journal_entry_lines` or a reporting RPC backed by them.
- **Document source:** reads invoices, vouchers, allocations, expenses, tax, or bank-statement records directly.
- **R/I:** reversed/inactive journal behavior. `Yes` means excluded; `No` means included; `N/A` means the report does not read journals.
- **MC:** multi-currency support: `Partial` is not a complete accounting-currency solution.

## Report-by-report evidence

| Report | Source and tables/RPCs/views | Journal or document | R/I | MC | Reconciles with GL? | Inconsistency | Severity |
|---|---|---|---|---|---|---|---|
| Trial Balance | `FinancialReports.tsx` → `get_trial_balance(start,end,usd_rate)`; `journal_entries`, `journal_entry_lines`, COA | Journal | Yes / Yes | Partial | It **is** the GL control | FX RPC converts selected purchase-invoice/payment JEs only; no complete FX/revaluation coverage | High |
| Balance Sheet | `get_balance_sheet(as_of,usd_rate)`; active JE lines + COA; generated current-year earnings | Journal | Yes / Yes | Partial | It **is** the GL control | Same partial FX coverage; generated earnings needs cross-check to P&L period convention | High |
| Profit & Loss | Period/opening `get_trial_balance` output grouped by COA in `FinancialReports.tsx` | Journal | Yes / Yes | Partial | Yes, derived from TB | Depends on incomplete FX conversion and client-side classification/grouping | High |
| Account Ledger | Non-bank: `journal_entry_lines` joined to `journal_entries`, COA; bank branch: `bank_statement_lines` | Mixed | Yes / Yes for non-bank; N/A for bank | Native/none | Non-bank yes; bank branch no | One screen changes meaning by account type: bank is statement projection, non-bank is GL | Medium |
| Party Ledger | `sales_invoices`, `receipt_vouchers`, `credit_notes`, `purchase_invoices`, `finance_expenses`, `payment_vouchers` | Document | N/A | No | No automatic control-account reconciliation | Documents can appear regardless of JE posting; no debit-note model; staff logic is separate | High |
| Customer Ledger | Customer mode of Party Ledger: invoices, receipts, approved credit notes | Document | N/A | No | No | Payment status/receipt rows rather than active A/R journal; credit-note allocation/netting not a unified AR subledger | High |
| Supplier Ledger | Supplier mode of Party Ledger: purchase invoices, approved AP expense bills, payment vouchers | Document | N/A | No | No | A/P projection can diverge from active 2110 due to missing/failed/reversed JEs | High |
| Cash Ledger | CA Reports: active JEs/lines for COA 1101 and 1102 | Journal | Yes / Yes | No | Yes, active cash GL | Fixed IDR-style reporting; no currency translation/revaluation | Medium |
| Bank Ledger | `bank_statement_lines`, bank opening balance; linked expense/receipt/JE lookup for display | Document / bank statement | N/A | Native bank amount only | No automatic comparison to bank GL | Named "Ledger" but does not use active bank GL and can contain unmatched/non-accounting statement lines | High |
| Journal Register | CA Reports queries all `journal_entries` and lines in range | Journal | No / No | No | No, because it includes non-active history | Includes drafts/reversals without a report-level status label/filter | High |
| General Ledger | CA Reports active JE lines; Account Ledger non-bank detail | Journal | Yes / Yes | No/Partial only via financial RPC, not this report | Yes for active JE line totals | CA General Ledger has no currency reporting-rate logic | Medium |
| Petty Cash | `get_petty_cash_balance()` uses active 1102 JE movement; manager history reads transactions and transfer view | Mixed | Yes / Yes for balance; N/A for history | No | Balance yes; history no | Screen mixes authoritative GL balance with non-posting historical fund-transfer projections | Medium |
| Bank Reconciliation | `bank_statement_lines`, reconciliation records/items, matched expenses/receipts/payments/transfers/petty cash/tax payments/JEs; non-customer receipt RPC | Document / control | Not consistently filtered for JE candidates | Native statement currency | Reconciles bank statement operationally, not automatically to GL | Correctly a control process, but direct JE/document matching has no single active-GL reporting contract | Medium |
| Accounts Receivable | `sales_invoices`, `receipt_vouchers`, `voucher_allocations`; payment/balance RPCs | Document | N/A | No | No automatic A/R-1120 reconciliation | Open status and allocations may disagree with active/reversed receipt journals; credit-note netting is not a unified source | High |
| Accounts Payable | `purchase_invoices`, `finance_expenses`, `payment_vouchers`, allocations, `get_outstanding_expense_bills` | Document/RPC | N/A | No | No automatic A/P-2110 reconciliation | Purchase and expense bills use parallel paths; voucher/JE status is not a report gate | High |
| Ageing Reports | `sales_invoices`, `get_invoice_paid_amount`; dashboard uses `get_overdue_balances` | Document/RPC | N/A | No | No | Ageing is invoice-centric; approved credit notes are not directly netted in the component source logic | High |
| Tax Reports | Tax views: `vw_input_ppn_report`, `vw_output_ppn_report`, `vw_ppn_net_by_period`, `vw_pph_by_period_type`, `vw_outstanding_tax`, `vw_monthly_tax_summary`; `tax_payments`, `faktur_pajak`, `audit_logs` | Document/tax views | N/A | No | No stated tax-control-account reconciliation | Correct statutory-source design, but reports do not establish active tax JE completeness or FX treatment | Medium |
| Dashboard finance widgets | `sales_invoices`, `finance_expenses`, `petty_cash_transactions`, `get_cogs_for_period`, `get_overdue_balances`, RevenueChart, PaymentOverview, tax cards | Document/RPC | N/A | No | No | Revenue is invoice total, profit is invoice total minus COGS, and widgets ignore credits/reversals/active JE status; cannot be treated as P&L | High |

## Direct answers to required questions

1. **Data source and tables/RPCs/views:** shown per report in the matrix.
2. **Journals vs document tables:** shown in the `Journal or document` column.
3. **Reversed journals:** active GL reports exclude them. Journal Register/viewers do not. Document reports do not query journals, so journal reversal is not a source filter.
4. **Inactive journals:** active GL reports exclude unposted/reversed entries. Journal Register/viewers do not. Document and bank/tax projections are N/A.
5. **Multi-currency:** only TB/BS/P&L have a reporting-rate mechanism, and it is partial. Bank Ledger is native selected-bank currency. All other finance reports lack a stated conversion/revaluation implementation.
6. **GL reconciliation:** only active GL reports reconcile by construction. The remaining reports lack an implemented automatic reconciliation to their control accounts.
7. **Inconsistencies:** listed per report and consolidated below.

## Remaining issues

| Priority | Issue | Affected reports | Severity |
|---|---|---|---|
| P0 | Financial FX conversion covers only selected purchase/payment JE sources; no complete transaction-currency/revaluation policy | TB, BS, P&L | High |
| P0 | Journal Register/viewers include inactive/reversed journals and can be mistaken for financial totals | Journal Register, Journal viewers | High |
| P0 | AR/AP/Party/Ageing reports are document projections with no active-GL control-account reconciliation | Party, Customer, Supplier, AR, AP, Ageing | High |
| P0 | Customer ageing/receivables does not implement a unified approved-credit-note netting source | Customer Ledger, AR, Ageing, dashboard overdue | High |
| P1 | Bank Ledger is statement-based rather than active bank GL and does not present a statement-to-GL reconciliation | Bank Ledger, Account Ledger bank branch | High |
| P1 | Dashboard revenue/profit/payments are document KPIs, omit active-JE/reversal control and are not P&L | Dashboard finance widgets | High |
| P1 | Purchase Register label says purchase invoices but reads `purchase_orders` | CA Purchase Register | Medium |
| P1 | Petty Cash screen mixes GL balance with non-posting transfer-history projections | Petty Cash | Medium |
| P1 | Tax reports lack explicit reconciliation to active PPN/PPh tax-control journals | Tax Reports | Medium |
| P2 | CA cash/general ledger reports have no multi-currency presentation or translation policy | Cash Ledger, General Ledger | Medium |
| P2 | Bank Reconciliation is correctly operational but lacks a single active-JE eligibility/reporting contract | Bank Reconciliation | Medium |

## Prioritized fix plan — do not implement in Phase 2

1. Define and approve the single reporting-currency and period-end revaluation policy; then align every GL financial statement to it.
2. Define active-JE reconciliation datasets for A/R (1120), A/P (2110), bank, petty cash, and tax control accounts; retain document screens as subledgers.
3. Make the Journal Register/viewer mode explicit: active-only financial register versus all-status audit history.
4. Specify credit-note allocation/netting behavior for AR, customer ledger, ageing, and dashboard overdue metrics.
5. Separate Bank Ledger statement reporting from GL bank reporting, with a formal reconciliation view.
6. Reclassify/rename CA Purchase Register or re-source it after business confirmation.
7. Label dashboard values as operational KPIs until they consume approved financial-report datasets.
8. Add a tax-control reconciliation report after the accounting/revaluation policy is agreed.

## Overall report consistency score

**61 / 100 — conditionally consistent.**

The active-GL financial statement core is coherent regarding posted/reversed status. The score is reduced by incomplete FX treatment, inactive-journal audit registers, and widespread document/statement projections without automated control-account reconciliation. This score is an architecture assessment, not evidence that the live database balances.

## Evidence anchors

- `supabase/migrations/20260724090000_active_journal_reporting_filters.sql`
- `src/components/finance/FinancialReports.tsx`
- `src/components/finance/{AccountLedger,PartyLedger,BankLedger,CAReports,JournalEntryViewer,JournalEntryViewerEnhanced,PettyCashManager,BankReconciliationEnhanced}.tsx`
- `src/components/finance/tax/TaxReportsPanel.tsx`
- `src/components/finance/{ReceivablesManager,PayablesManager}.tsx`
- `src/pages/reports/AgeingReport.tsx`
- `src/pages/Dashboard.tsx`, `src/components/dashboard/{RevenueChart,PaymentOverview}.tsx`

---

## Phase 3 workflow audit summary — 2026-07-25

No code or data behavior changed. The workflow audit is in [ACCOUNTING_WORKFLOWS.md](ACCOUNTING_WORKFLOWS.md).

**Workflow score: 64 / 100.** The highest UX risks are duplicated Contra/Fund Transfer concepts, separate save/post/match workflows for common receipt/payment activity, free-form expense classification branches, dense bank-reconciliation choices, and the lack of guided Loan/Capital workflows.

The Phase 3 roadmap is UX-only and intentionally awaits approval before any implementation or data-model decision.

---

## Finance Stabilization Sprint — implementation status (2026-07-25)

### Completed priority items

| Priority | Delivered implementation | Affected paths |
|---|---|---|
| Critical | Central active-journal reporting-rate contract for TB, BS, Trial-Balance-derived P&L, and `get_pnl_summary` | `get_journal_reporting_multiplier`, financial statement RPCs |
| Critical | A/R open-items contract nets active receipts and approved credit notes; credit without an invoice is applied oldest-first per customer | Receivables, Ageing, AR 1120 reconciliation |
| Critical | AR 1120 and AP 2110 GL-to-subledger exception reconciliation | Receivables and Payables banners; `get_control_account_reconciliation` |
| High | Statement-native Bank Ledger now compares its selected bank account to active bank GL | Bank Ledger |
| High | Dashboard revenue, expense, net income and AR financial totals use active GL/open-items contracts; invoice charts are labelled operational | Dashboard |
| High | Posting/bank-link state is surfaced in existing voucher and reconciliation worklists; suggested matches have an explicit accept/review state | Receipt, Payment, Bank Reconciliation |
| Medium | Business terminology, petty-cash action labels and guided loan/capital journal templates | Finance navigation and managers |

### Remaining open issues

1. Full multi-currency accounting remains incomplete because manual journals and several source documents do not retain a transaction currency or a period-end revaluation model.
2. Party, customer and supplier ledger screens still contain direct-document operational history; only Receivables/Ageing now have the active-AR contract. Their control-report migration remains outstanding.
3. Tax reporting lacks an explicit PPN/PPh control-account reconciliation.
4. Journal Register and journal viewers remain audit-history views that can include inactive/reversed entries; they need an explicit mode/label before use as a financial register.
5. Bank reconciliation candidate eligibility is operational rather than a universal active-GL reporting contract.
6. The Purchase Register/PO naming decision and all Purchase Batch workflow work are deliberately deferred.
7. No dedicated Debit Note, Loan or Capital lifecycle exists. Loan/capital are guided journal/reconciliation classifications only.

### Updated consistency score

**82 / 100 — conditionally production-ready for the stabilized finance reporting scope.** The critical financial-statement, AR/AP reconciliation visibility and AR credit-netting gaps are addressed. The remaining score deduction is for incomplete currency/revaluation coverage and unimplemented control-report contracts listed above; it is not a live-data reconciliation attestation.
