# Finance V1 Migration Reconciliation

Date: 2026-07-31

## Decision

Migration history is reconciled and deterministic:

- Local versions: `648`
- Remote versions: `648`
- Duplicate versions: `0`
- Local-only versions: `0`
- Remote-only versions: `0`

The historical versions classified below were recorded only after rollback
testing proved that replaying them over the newer live schema would be unsafe.
Remote-only versions were reconstructed in the repository. Duplicate timestamp
files were moved to `supabase/migration_backlog/duplicate_timestamps/`.

## Evidence

- All 76 original local-only files were executed independently inside remote
  `BEGIN ... ROLLBACK` transactions.
- 66 replayed successfully after the final rerun; 10 failed for the classified
  reasons below.
- 242 schema objects declared by those files were checked against the live
  catalog. 213 names existed directly. Missing names were checked as renamed,
  superseded, storage-schema parser mismatches, or genuine gaps.
- The genuine Salary Advance gap (`20260727160000`) was applied normally and
  its migration history was recorded.
- The missing bank-line expense-state trigger was installed by the corrective
  migration `20260731170000_fix_expense_payment_state_trigger_scope.sql`.
- Salary Advance constraint and RPC return-type defects were corrected by
  `20260731180000` and `20260731190000`.
- The Petty Cash integrity view was corrected by `20260731200000`.
- Current finance journals, Trial Balance, and the canonical Customs Broker
  transaction remained balanced after these changes.

## Failed replay classification

| Version | Classification | Evidence / action |
|---|---|---|
| `20260702140000` | Data-repair-only, superseded | References a historical journal UUID that no longer exists. No schema object is introduced. Do not replay. |
| `20260713120000` | Superseded security definitions | Fails on policies already present. Later security migrations and current policies/functions represent the active rules. |
| `20260713140000` | Superseded tax schema | Old view column types conflict with the current tax-engine views. Do not replace the newer views. |
| `20260713190000` | Superseded tax engine | Old view shape attempts to drop columns from the current view. Current tax functions/views are newer. |
| `20260713210000` | Data-repair-only, superseded | Attempts to post a historical fixed-asset expense without the now-required explicit posting account. The record requires manual evidence, not an inferred repair. |
| `20260714240000` | Already represented | Fails because the authenticated sales-order-document policy already exists. Current tax payment functions are later versions. |
| `20260716100000` | Replaced by corrective migration | Historical backfill encounters an unresolved USD record with no provable rate. Trigger behavior is installed safely by `20260731170000` without rewriting that journal. |
| `20260717120000` | Superseded staff accounting | Old expense-category constraints conflict with current categories. Current staff/payment functions are newer. |
| `20260723230000` | Superseded fund-transfer wrapper | The renamed core function already exists. Current undo/reverse functions are later versions. |
| `20260729140000` | Superseded sales posting | The replacement posting implementation already exists. Replaying would rename/replace a newer function. |

`20260714270000_align_tax_report_views_to_engine.sql` was rerun after the
initial replay capture and completed successfully inside `ROLLBACK`.

## Historical data intentionally unchanged

- Expense `EXP/25/182` is a USD 5 historical bank-charge expense with a USD
  bank match and a legacy journal posted as 5 functional units, but no stored
  exchange rate. No source document provides a mathematically provable IDR
  rate. Its accounting history was not rewritten.
- The failed fixed-asset backfill record was not posted with a guessed asset
  account.
- No migration repair changed journals, journal lines, allocations, bank
  statement links, supplier balances, tax records, or report balances.

## Reconciliation action

Completed. The repository and linked project now contain the same 648 migration
versions. Future production changes continue incrementally after
`20260731200000`; no Version 1.0 baseline should be generated until this
reconciled history is released and retained as the upgrade path for existing
databases.
