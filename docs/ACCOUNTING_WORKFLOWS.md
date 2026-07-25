# SAPJ Finance Workflow Audit — Phase 3

**Date:** 2026-07-25  
**Scope:** UX/workflow audit only. No code, SQL, migration, schema, or business-logic change was made.

## Method

`Clicks` are the estimated minimum primary UI actions from the appropriate Finance landing screen for a standard, already-mastered record. They exclude typing, dropdown selection, scrolling, file upload, browser navigation, confirm dialogs, optional review, and approval by another person. They are comparative UX estimates, not automated test measurements.

Benchmark terms: **T** = TallyPrime, **Q** = QuickBooks Online, **X** = Xero, **O** = Odoo. The comparison describes their common standard workflow, not every edition, localization, or configuration.

## Module workflow matrix

| Module | Normal accountant workflow | SAPJ current workflow | Benchmark comparison (T / Q / X / O) | SAPJ clicks | Unnecessary decisions / auto opportunities | Confusing terminology | UX-only recommendation |
|---|---|---|---|---:|---|---|---|
| Purchase | Create PO if needed → receive goods → enter supplier bill from PO/receipt → review tax/due date → approve/post → pay later. | PO is created in Purchase Orders; Purchase Invoice is separately created in Finance; payment opens separately from the invoice list. | T uses Purchase voucher/optional order; Q/X turn PO/bill into a payable; O flows RFQ→PO→receipt→vendor bill with matching. SAPJ has the pieces but weak visible handoff. | 4–6 | Re-enter supplier/items/tax/date; decide which screen owns purchase; choose payment workflow later. Default supplier terms, PO/receipt lines, tax, currency, and next action. | “Purchase” can mean PO while “Purchase Invoice” means bill; CA Purchase Register actually means PO register. | Add one purchase worklist with `PO → receipt → supplier bill → payment` status chips and contextual “Create Bill from PO”. |
| Sales | Create quote/order if needed → issue customer invoice → send → receive/allocate payment → follow up overdue amount. | Sales page creates invoice; receipt is separately entered in Finance and must be posted; AR/ageing are separate views. | T sales voucher; Q/X invoice then receive payment; O quotation→sales order→invoice→payment. All make invoice settlement a visible next action. | 4–5 | Select customer/items/tax/terms even when master/order has values; separately navigate to Receipt. Default terms/tax/price and launch “Receive Payment” from invoice. | “Sales” page contains invoice creation; “Receipt Voucher” is accountant terminology rather than customer-payment language. | Show invoice lifecycle and a primary `Receive payment` action on the invoice row/detail. |
| Expense | Capture bill/receipt → classify category/asset/tax → choose payable versus paid-now → submit/approve → pay/reconcile. | Expense Manager captures expense/bill, supplier, taxes, bank link and special categories; a later approval posts it; paid bills are settled in Payment. | T payment/purchase voucher; Q Expense or Bill; X Spend Money or Bill; O vendor bill/expense. Q/X make paid vs bill choice explicit but simple. | 4–7 | Category, payment method, supplier, PPN/PPh/stamp and bank link can all be manual; special categories add branch complexity. Infer defaults from supplier/category/bank statement; surface exceptions only. | “Expense” covers a paid expense, supplier bill, PIB, fixed asset, and broker reimbursement. | Start with a clear document-type choice: `Supplier bill`, `Paid expense`, `Import/PIB`, `Fixed asset`; progressive-disclose tax and special fields. |
| Receipt | Open customer invoice → receive money → choose bank/cash → allocate automatically or confirm → post/reconcile. | New Receipt creates a voucher, then separate `Post to GL`; allocations support SO advance/invoice; bank matching is a later flow. | T Receipt voucher; Q Receive Payment; X Receive Money; O Register Payment. The benchmark default is create-and-post as one controlled action. | 4–6 | User decides when to post and can separately choose advance versus invoice; bank matching is detached. Default invoice allocation and bank account from payment context; post on confirmed save subject to approval policy. | “Receipt Voucher”, “Post to GL”, and “SO (Advance)” require accounting/process knowledge. | Rename primary action to `Receive customer payment`; put posting and allocation state in one confirmation step. |
| Payment | Open approved supplier/staff bill → pay → choose bank/date → allocate amount → record withholding → post/reconcile. | Payment Voucher Manager loads bills/allocations, saves voucher, then separately posts and links bank transaction. | T Payment voucher; Q Pay bills; X Pay; O Register Payment. All begin from the bill and prefill counterparty/amount/accounts. | 4–6 | Separate save/post/bank-link decisions; PPh may need manual handling; user must find the bill again. Default payable/allocations/bank from bill and surface PPh only when supplier tax settings require it. | “Payment Voucher” is less clear than `Pay bill`; staff and supplier flows share complex choices. | One `Pay` action from a bill with review drawer: allocations, withholding, bank match suggestion, then post. |
| Contra | Move money between cash, petty cash, and bank accounts; no P&L impact; reconcile both sides. | Finance menu calls the same FundTransferManager under `Contra`; it creates/edits/reverses a fund transfer. | T calls it Contra; Q/X `Transfer`; O internal transfer. Modern products favor Transfer; Tally keeps traditional contra. | 3–4 | User chooses `Contra` versus `Fund Transfer` as if separate modules; may select account types and bank links manually. Infer account type and destination constraints. | “Contra” and “Fund Transfer” duplicate one concept. | Use `Transfer money` as primary label, with “Contra voucher” only in accounting reference/details. |
| Fund Transfer | Select source, destination, date, amount; confirm; match bank feeds; reverse only by exception. | Same manager as Contra, with detailed status, reversal and undo-reverse steps. | Q/X/O use one transfer flow and bank-feed matching; T uses contra voucher. SAPJ has strong recovery controls but an expert-heavy workflow. | 3–5; reverse 5+ | Source/destination account type and separate bank-statement links are exposed more than needed. Auto-detect from chosen accounts and auto-suggest matching lines. | Separate menu labels for the same function; “Undo Reverse” is technically precise but intimidating. | One transfer wizard with automatic counterpart, bank suggestions, and a guarded “Reverse transfer” exception action. |
| Petty Cash | Record float top-up, petty-cash spend, receipt, attach proof, submit/approve; reimburse/top-up based on calculated balance. | Petty Cash Manager records transaction; standalone transactions save then require approval/post; fund transfers appear historically but do not own accounting. | T Cash voucher/contra; Q Cash expense; X Spend Money; O cash journal/expense. Most emphasize receipt capture and replenishment. | 4–6 | User may choose transaction type, source account, category, bank link and approval state; transfer history can confuse balance ownership. Default expense category from supplier/merchant and source account from selected top-up method. | “Withdraw” can mean petty-cash top-up; `fund transfer` history shares the screen with petty cash. | Separate `Top up petty cash` and `Record petty-cash expense`; show GL balance prominently and archive/non-accounting transfer projections visually. |
| Bank Reconciliation | Import/feed statement → system proposes match → accept/review exception → create missing bank transaction only where no document exists → reconcile period. | Enhanced screen imports lines, offers match candidates, can create expense/receipt/payment/tax links or journal-only non-customer receipt, and manages many manual paths. | Q/X emphasize bank-feed rules and one-click suggested matches; O offers reconciliation widgets; T commonly relies on manual bank reconciliation. SAPJ is capable but cognitively dense. | 3–8 | Choosing among link/create expense/create receipt/link journal/payment/tax for each line; duplicate checking and matching attributes are exposed. Auto-rank candidates, preselect exact match, route by debit/credit + known counterparty. | `Record Transaction`, `Link Journal Entry`, `Create & Link`, `matched entry`, and status vocabulary compete. | Replace branching modal with ranked “Suggested match” card, one primary accept action, and an `Other actions` drawer. |
| Journal | Use only for accruals, corrections, opening balances, and nonstandard transactions; select accounts, enter balanced lines, attach evidence, post. | General Journal supports templates, manual lines, validation, immediate post, edit/view and selected bank link. | T Journal voucher; Q Journal Entry; X Manual Journal; O Miscellaneous Entry. All target trained accountants and validate balance. | 4–7 | Template/account/line selection is expected, but bank linking can blur source-of-truth; loan/capital are handled here because no dedicated document lifecycle exists. Default template lines and descriptions for approved templates. | “General Journal” is clear to accountants, not to operational users; template terms such as “Director Loan” are account-specific. | Restrict to accountant role, group templates by business event, and direct operational loan/capital cases to guided workflows once specified. |
| Credit Note | Start from original customer invoice → select returned/credited lines → reason → approve → automatically reduce AR/revenue/tax/inventory where applicable. | Credit Notes page creates a standalone note, adds items, then requires explicit approval; accounting/stock posting occurs on approval. | T credit note; Q Credit Memo; X Credit Note; O Credit Note from invoice. All commonly start from the original invoice. | 4–6 | User may manually choose customer/items/tax instead of inheriting original invoice; separate approve action is appropriate but could be queued. Auto-populate invoice, quantities, tax, price, and reason options. | “Credit Note” is standard; “Approve” hides accounting effect unless explained. | Add `Create credit note` from invoice, with a compact preview of AR/tax/stock impact before approval. |
| Loan | Record loan receipt or repayment against lender/loan account, retain agreement, schedule principal/interest, reconcile bank, report balance. | No dedicated Loan module; General Journal templates and Bank Reconciliation classification create the accounting entry. | T/Q/X/O commonly use liability account + journal/expense, while O can be extended with loan schedules; full loan modules vary. SAPJ has no lender/schedule workflow. | 5–8 | Accountant decides manual journal template, bank account, counterparty and classification; no schedule automation. Infer counter-account from bank receipt classification; retain agreement metadata where a future product requirement approves it. | “Loan Received”, “Director Loan”, and account codes compete; no clear repayment flow. | Present a guided `Record loan receipt/repayment` shortcut over the existing journal template; do not add a data model without separate approval. |
| Capital Injection | Record owner contribution from bank/cash, identify owner/reference, attach proof, classify equity, reconcile bank. | No dedicated Capital Injection module; Bank Reconciliation records a non-customer bank receipt to equity, while manual journal is another route. | T uses receipt/contra + capital account; Q owner contribution/equity; X `Owner funds introduced`; O equity journal. Benchmarks use a named business event. | 4–6 | User must know to use reconciliation or journal and choose capital account. Auto-classify a bank receipt after accountant confirmation. | “Capital” appears only as a receipt classification, not a finance document. | Add a visible `Record owner contribution` shortcut that pre-fills the existing bank/journal flow; keep it UX-only until lifecycle scope is approved. |
| Tax | Review period obligations → prepare invoice/expense tax data → record statutory payment → attach NTPN/proof → reconcile bank → close period. | Tax Compliance Centre has separate periods, reports, Faktur, PPh, payments, attachments and close controls; payment creates/posts a journal and then bank match can be opened. | T tax reports/statutory features depend on localization; Q/X tax center and filing workflow; O localized tax reports/payments. Benchmarks organize by period and filing status. | 5–9 | User chooses period, type, bank, payment details and then separately links statement; reports/period/payment panels are separate. Default tax type/period from due date and bank-match suggestion from payment. | PPN, PPh, Faktur Pajak, NTPN are legally correct but need plain-language helpers; “Post & Journal” is redundant. | Create one period workspace: obligation → evidence → payment → bank match → close, with Indonesian terms plus plain-language subtitles. |

## Cross-product comparison summary

| Product | Workflow pattern relevant to SAPJ | SAPJ gap/opportunity |
|---|---|---|
| TallyPrime | Voucher-centric, keyboard-forward accounting; strong traditional terms such as Contra/Receipt/Payment. | SAPJ can retain vouchers for audit but should reduce form branching and translate jargon for non-accountant users. |
| QuickBooks | Document-centric `Bill`, `Pay bills`, `Invoice`, `Receive payment`, bank-feed workflows, defaulting from contacts. | SAPJ needs stronger next-action links and defaults from source documents. |
| Xero | Clean source-document lifecycle, bank reconciliation suggestions/rules, simple payment actions. | SAPJ should make reconciliation suggestion-first and keep exceptional actions secondary. |
| Odoo | Integrated stateful workflows across purchase/sales/inventory/accounting; configurable approvals. | SAPJ needs visible cross-module lifecycle/state handoffs without adding unnecessary ERP complexity. |

## Top 20 UX improvements — recommendations only

1. Replace separate primary labels `Contra` and `Fund Transfer` with one `Transfer money` workflow.
2. Add lifecycle status chips and next actions for PO → supplier bill → payment.
3. Create supplier bills directly from a PO/receipt with inherited supplier, lines, tax, currency, and terms.
4. Open `Receive payment` directly from a customer invoice with default allocation.
5. Open `Pay bill` directly from approved supplier/staff bills with prefilled allocations.
6. Collapse save/post into one reviewed confirmation for standard receipt/payment flows, preserving approval controls.
7. Make document posting, journal link, and bank-match status visible on every document row/detail.
8. Start Expense with a document-type choice and progressively disclose special-category fields.
9. Default tax, terms, account/category, payment bank, and currency from master/source/bank context.
10. Redesign bank reconciliation around one ranked suggested match and an `Other actions` drawer.
11. Auto-suggest exact amount/date/counterparty bank matches and explain why each match is suggested.
12. Separate `Top up petty cash` from `Record petty-cash expense` and visually quarantine transfer projections.
13. Add a `Create credit note from invoice` action that copies eligible lines/tax and shows impact preview.
14. Rename user-facing voucher actions to `Receive customer payment` and `Pay bill`; retain voucher numbers in details.
15. Replace the CA Purchase Register label or add a clear PO-versus-bill selector after business confirmation.
16. Create guided UX shortcuts for loan receipt/repayment and owner contribution over existing journal/reconciliation paths.
17. Organize Tax Compliance by a single period workspace with status-driven next actions.
18. Add plain-language explanations alongside PPN, PPh, Faktur Pajak, NTPN, posting, and reversal terms.
19. Make reversal/undo-reverse exception actions visually distinct, with concise impact previews.
20. Label dashboards as operational KPIs and link each tile to its source workflow and reconciliation state.

## Final implementation roadmap — UX sequence only

### Wave 1 — reduce ambiguity (highest impact)

1. Consolidate terminology/navigation: Transfer Money, Pay Bill, Receive Payment, Supplier Bill.
2. Add lifecycle and accounting-state visibility to existing document lists/details.
3. Rework Bank Reconciliation to suggestion-first interaction.
4. Correct the Purchase Register label/intent after product-owner decision.

### Wave 2 — reduce data entry

5. Add document-origin shortcuts and defaults for PO→bill, invoice→receipt, bill→payment, invoice→credit note.
6. Add master-data/bank-context defaults and progressive disclosure for taxes/special expenses.
7. Separate petty-cash top-up and spend experiences.

### Wave 3 — guided exceptional flows

8. Add guided shortcuts for loan and capital entries using the already-approved accounting paths.
9. Create a tax-period task workspace and simplify payment-to-bank-match handoff.
10. Standardize reversal/approval exception panels and impact language.

### Wave 4 — validation before implementation

11. Test click counts and error rates with accountants using real bills, receipts, bank imports, tax payments, and returns.
12. Confirm that UX changes preserve the Phase 1/2 active-journal and reconciliation contracts before any code work.

## Workflow score

**64 / 100.** SAPJ has broad workflow coverage and strong accounting safety controls, but common transactions are spread across modules, use duplicate terminology, expose too many posting/matching decisions, and make bank reconciliation more complex than necessary. This is a UX assessment, not a control-effectiveness or live-data score.

## Stabilization UX delivery — 2026-07-25

Implemented without changing Purchase Batch or document posting rules:

- Finance navigation uses **Supplier Bills**, **Receive Payment**, **Pay Bills**, and **Transfer Money**.
- Receipt, payment, petty-cash, transfer and journal controls use the corresponding business-language actions.
- Bank reconciliation makes a candidate explicit as **Suggested match — review** and its primary action **Accept suggested match**; the existing ranked smart-match workflow remains the decision engine.
- Loan receipt, repayment, director loan and owner contribution are guided General Journal templates over the existing journal workflow; no Loan or Capital table was added.
- Bank Ledger exposes GL-versus-statement status, and AR/AP worklists expose control-account reconciliation status.

Deferred UX work: invoice-origin shortcuts, a fully consolidated bank-reconciliation action drawer, supplier/default propagation beyond existing master-data defaults, tax-period workspace, and all Purchase Batch changes.

## Evidence anchors

- `src/pages/Finance.tsx`
- `src/pages/{PurchaseOrders,Sales,CreditNotes}.tsx`
- `src/components/finance/{PurchaseInvoiceManager,ExpenseManager,ReceiptVoucherManager,PaymentVoucherManager,FundTransferManager,PettyCashManager,GeneralJournalEntry,BankReconciliationEnhanced}.tsx`
- `src/components/finance/tax/{TaxPaymentsPanel,TaxReportsPanel,TaxPeriodsPanel,PeriodClosePanel}.tsx`
