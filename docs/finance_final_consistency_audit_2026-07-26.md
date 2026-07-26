# Final Finance Consistency Audit — 2026-07-26

## Decision

**Finance is not ready to freeze.** The canonical journal and report layer is
balanced and internally consistent, but 166 source records still require
accountant, tax-consultant, or authorised metadata decisions. No uncertain
posted amount, debit, credit, exchange rate, or source relationship was
rewritten.

The complete record-by-record exception list is
[finance-production-cleanup exceptions](../finance-repair-output/finance-production-cleanup-09a0f78a-01b8-4ad6-a1e6-260b0a57b40c-exceptions.csv).
It contains all 192 findings across the 166 affected records, including the
document number, database ID, date, amount, reason, evidence gap, and required
manual action. No exception is classified as safe to delete and recreate.

## Audit scope and live totals

| Item | Live result |
|---|---:|
| Finance records scanned by historical repair audit | 2,680 |
| Journal entries scanned | 1,040 |
| Active posted, non-reversed journals | 1,039 |
| Journal lines scanned | 2,196 |
| Active non-header COA accounts | 80 |
| Active bank masters | 2 |
| Exception records requiring manual review | 166 |
| Detailed exception findings | 192 |
| Deterministically fully repaired records | 1,215 |
| Deterministically partially repaired records | 56 |

## Document PASS / FAIL matrix

`PASS` means the current canonical documents have an active balanced journal
and use the shared journal/report layer. `FAIL` means at least one current or
historical record cannot complete the required source-to-report trace without
manual evidence.

| Finance document | Documents checked | Journal result | Traceability result | Status | Evidence |
|---|---:|---|---|---|---|
| Expense | 535 approved | 534 linked; all linked journals balanced | One approved expense has no journal; historical metadata/rate/bank-GL exceptions remain | **FAIL** | `EXP/26-26/085` lacks a provable fixed-asset account; 98 additional Expense findings are listed individually in the exception CSV |
| Receipt | 33 | 33 linked and balanced | Four historical metadata relationships are not uniquely provable | **FAIL** | Accounting posts reconcile; source metadata requires manual decisions |
| Payment | 6 | 6 linked and balanced | Three historical metadata findings remain | **FAIL** | Accounting posts reconcile; source metadata requires manual decisions |
| Contra / Fund Transfer | 40 posted | 40 linked and balanced | 21 legacy USD transfers stored source-currency values in functional columns | **FAIL** | Posted values preserved pending authoritative rates/reposting decision |
| Petty Cash | 272 canonical posted records | 272 balanced journals | Complete for canonical records | **PASS** | The other 15 approved table rows are legacy Fund Transfer projections, not independent Petty Cash accounting events |
| Loan | 0 native source documents | Two legacy Director Loan journals exist | Native Loan sources and terms cannot be proven | **FAIL** | `JE2607-0048` and `JE2602-0085` require authorised Loan source completion without reposting |
| Loan Repayment | 0 | No current event to validate | Native workflow exists but no production sample; no dedicated viewer | **FAIL** | End-to-end running-app validation is not possible without a real document |
| Capital Contribution | 3 | 3 linked and balanced; correct 3100 control account | Two USD contributions lack authoritative historical rates | **FAIL** | Accounting values preserved; both exceptions are listed individually |
| Owner Withdrawal | 0 native source records | Existing architecture uses the shared Manual Journal bridge | No native source master or production sample | **FAIL** | Adding a table/module was prohibited; requires an explicit product/accounting decision |
| Tax Payment | 4 | 4 linked and balanced | Four PPh21 payments have no posted accrual credit | **FAIL** | Each Rp120,000 payment is listed individually; payment and bank journals were not changed |
| Manual Journal | 1 | Balanced and posted | The only row, `JE2602-0085`, is demonstrably a Director Loan | **FAIL** | Manual Journal is correctly filtered to `source_module='manual'`, but historical classification needs authorised source completion |
| Bank Reconciliation | 610 matched/recorded lines | Two lack journal links; all available linked journals remain balanced | Four lack typed source links; 38 journal/Bank-Master amount or GL checks fail | **FAIL** | Zero duplicate typed links; every remaining failure is represented in the exception register |

## Canonical accounting integrity

| Check | Result | Status |
|---|---:|---|
| Active journals without lines | 0 | PASS |
| Journals unbalanced by line sums | 0 | PASS |
| Journals unbalanced by header totals | 0 | PASS |
| Header totals differing from line totals | 0 | PASS |
| Invalid debit/credit lines | 0 | PASS |
| Duplicate journal numbers | 0 | PASS |
| Duplicate audited voucher numbers | 0 | PASS |
| Orphan journal lines | 0 | PASS |
| Journal lines with missing COA | 0 | PASS |
| Active banks with missing/invalid COA mapping | 0 | PASS |
| Total active debits | Rp18,366,989,968.70 | PASS |
| Total active credits | Rp18,366,989,968.70 | PASS |

## Report source and reconciliation matrix

| Screen/report | Canonical accounting source | Verification | Status |
|---|---|---|---|
| Journal Register | Active posted `journal_entries` plus their lines | All 1,039 active journals visible independent of legacy module naming; filters derive from database source values | PASS |
| Manual Journal | `journal_entries` restricted to `source_module='manual'` | Generated document journals excluded | PASS, with one historical misclassification exception |
| Account Ledger | Active posted `journal_entry_lines` | Same functional IDR values as Trial Balance | PASS |
| Bank Ledger | Active posted bank-GL journal lines identified by `bank_accounts.coa_id` | Statement lines are no longer substituted for GL postings | PASS |
| Party Ledger | Active posted party-tagged journal lines | Business documents identify source journal IDs only; amounts come from journal lines | PASS |
| Trial Balance | Active posted functional journal lines | Zero account mismatches; debit and credit each Rp18,366,989,968.70 | PASS |
| Balance Sheet | Active posted functional journal lines plus journal-derived Current Year Earnings | Debit and credit each Rp13,940,184,112.45; equation difference Rp0.00 | PASS |
| Profit & Loss | Same posted journal account balances | Current Year Earnings uses revenue less expenses once; no UI double count | PASS |
| Input PPN report | Posted journal account 1150 | View and journals both Rp622,143,643.00 | PASS |
| Output PPN report | Posted journal account 2130 | View and journals both Rp486,943,144.19 | PASS |
| PPh / tax period reports | Posted tax-control journal lines | Accounting amounts are journal-native; business rows are descriptive metadata | PASS, subject to four missing PPh21 accruals |
| CA reports | Posted journal lines for accounting amounts | Sales/Purchase/Bank registers no longer calculate accounting totals independently | PASS |

No report-time USD rate is applied to functional journal amounts. The retained
rate RPC argument is API compatibility only.

## Deterministic repairs completed

- Reused active Chart of Accounts and shared posting commands across Finance;
  removed remaining hardcoded Manual Journal loan/capital templates and dynamic
  Journal Register source filters.
- Consolidated Journal Register and Manual Journal classifications and added
  shared Journal popup navigation from Journal Register, Bank Reconciliation,
  Bank Ledger, and Party Ledger.
- Created three Capital Contribution source rows only where the posted two-line
  bank/Owner Capital relationship was unique and provable; journal identity and
  values were preserved.
- Reclassified the accountant-confirmed liability line of `JE2607-0048` from
  2210 Bank Loans to 2105 Director Loan – Vijay without inventing Loan terms.
- Removed the duplicate Petty Cash typed link from bank line
  `727ddddd-e017-4923-9b19-59eea286758b`; the canonical Fund Transfer and
  journal links remain. Duplicate bank typed-source links are now zero.
- Phase 1 replaced 161 provable Cash-on-Hand journal classifications with the
  exact linked Bank Master GL. Amounts, sides, dates, journal numbers, and
  transaction values were unchanged. Zero eligible Phase 1 candidates remain.
- Corrected Trial Balance and Balance Sheet to use posted functional values
  directly; corrected Current Year Earnings sign and removed the UI double
  count/absolute-value distortion.
- Replaced accounting amounts in PPN, PPh, outstanding-tax, tax-period, Faktur,
  Tax Payment, and CA register reads with posted journal-line values.
- Recorded all remaining deterministic verification failures in the historical
  exception register rather than hiding or guessing them.

## Remaining issues — complete category summary

Every affected record is listed individually in the linked CSV. The 192
findings are:

| Remaining finding | Records |
|---|---:|
| Bank lines with no provable active journal | 2 |
| Bank journal Bank-Master GL amount/direction mismatch | 7 |
| Bank lines linked to Expense journals using a different bank GL | 7 |
| USD Capital Contributions without authoritative historical rate | 2 |
| Approved Expense without active journal | 1 |
| Expense metadata with no unique authoritative relationship | 66 |
| Expense journals still using a nonselected bank GL | 6 |
| Expense metadata conflicting with unique bank evidence | 1 |
| USD Expenses without authoritative historical rate | 24 |
| Legacy USD Contra functional-column issue | 21 |
| Journal metadata without a unique source relationship | 2 |
| Director Loan journal missing native Loan source | 2 |
| USD journals without authoritative historical rate | 2 |
| Payment metadata with no unique relationship | 2 |
| Payment metadata conflicting with bank evidence | 1 |
| Receipt metadata with no unique relationship | 4 |
| Taxed Sales Invoices missing official Faktur Pajak number | 38 |
| PPh21 payments without accrued payable | 4 |
| **Total findings** | **192** |

### Remaining UI and navigation issues

- Loan, Loan Repayment, and Capital Contribution have shared posting commands
  and source tables but no existing dedicated Finance viewer module, so complete
  source-screen round-trip navigation cannot pass without adding prohibited UI
  modules.
- Owner Withdrawal has no native source master; the current shared Manual
  Journal bridge is traceable to its journal but cannot provide a native
  document round trip.
- No live Loan Repayment or Owner Withdrawal sample exists for running-app
  end-to-end validation.

### Remaining accounting and tax actions

- An accountant must supply the missing asset account for `EXP/26-26/085` and
  post it through the native Expense workflow.
- An accountant must decide whether each remaining wrong-bank historical
  posting is retained with a correcting entry or formally reversed/reposted.
- Authoritative transaction-date exchange rates and their sources are required
  before resolving the listed USD exceptions.
- Loan counterparty terms, maturity, and opening outstanding balance are needed
  before creating/relinking the two legacy Director Loan sources.
- Official Faktur Pajak numbers must be entered for the 38 listed invoices.
- The accountant/tax consultant must identify and post the four original PPh21
  accruals or formally authorise reclassification; the payment journals must not
  be silently rewritten.

## Verification performed

- Linked production database integrity queries and direct journal/report
  reconciliation.
- Historical exception report regeneration with `npm run finance:repair -- --linked`.
- Production application bundle: `npm run build` — PASS.
- Finance-local TypeScript compiler output — PASS.
- `git diff --check` — PASS.
- Repository-wide `npm run typecheck` — FAIL due to pre-existing, unrelated
  CRM, inventory, settings, dashboard, and general application errors. No
  Finance-local compiler errors remain.

## Completion status

All deterministic Finance repairs identified by this sprint are complete and
verified. The task is **not eligible for a Finance freeze** until the 166
manual-review records and the stated navigation/product decisions are resolved
with authoritative evidence.
