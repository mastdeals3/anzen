# Procurement & Inventory Reconciliation Audit — 2026-08-04

## Outcome

The live audit found five stale records across four products. The proposed
migration repairs all five through the existing reservation/procurement engine.
The post-migration reconciliation contains 30 active products and zero
exceptions.

## Root cause

The Sales Order editor replaces all lines by deleting the old rows and then
inserting the edited rows. `trg_sync_import_req_on_so_item_delete` cancelled an
import requirement on every line delete without checking whether the SO was in
the middle of an edit or whether a replacement line still represented the same
product. On 2026-08-03 this cancelled the valid 75 kg requirements for
SO-2026-0011 and SO-2026-0012.

A second event gap existed when batch arrival resolved a shortage. The FEFO
engine changed the SO from `shortage` to `stock_reserved`, but no event closed
the obsolete pending import requirement. This left stale requirements for
Cefixime USP and Pregabalin. One historical Dextromethorphan SO was marked
`stock_reserved` without an active reservation; the migration re-runs the
canonical FEFO function for that proven exception.

## Cetirizine trace

Cetirizine Hydrochloride EP has four live shortage SOs: 75 kg, 75 kg, 50 kg,
and 25 kg, totaling 225 kg. The two 75 kg requirement rows were marked
`cancelled` with the note `Product removed from SO 2026-08-03`, even though the
same product remains on both SOs. Only the 50 kg and 25 kg rows remained active,
which produced Required Qty 75, Remaining Qty 75, and SO Count 2.

There is no Cetirizine EP batch and therefore no active EP reservation in the
current database. The post-repair state is Required Qty 225, Remaining Qty 225,
SO Count 4, Reserved Qty 0, Physical Stock 0, and Available Stock 0.

## Repaired exceptions

| Product | Repair | Rows |
|---|---|---:|
| Cetirizine Hydrochloride EP | Reopen valid requirements for SO-0011 and SO-0012 | 2 |
| Cefixime USP | Close stale pending requirement after full reservation | 1 |
| Pregabalin | Close stale pending requirement after full reservation | 1 |
| Dextromethorphan Hydrobromide USP | Recreate missing FEFO reservation through canonical engine | 1 |

## SQL objects

- `public.fn_sync_import_requirements_on_so_edit()`
- `public.fn_close_pending_import_requirements_on_reservation()`
- `public.trg_close_import_req_when_stock_reserved`
- `public.vw_procurement_reconciliation_audit`

The full product exception report is in
`audit-reports/procurement-reconciliation-20260804.csv`.

