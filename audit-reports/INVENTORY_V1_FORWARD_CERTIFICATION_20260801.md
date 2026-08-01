# SAPJ Inventory Version 1.0 Forward Certification

Date: 1 August 2026

Status: **CERTIFIED**

## Production evidence

- Canonical Inventory migrations applied successfully.
- Local migrations: 654.
- Remote migrations: 654.
- Duplicate versions: 0.
- Local-only versions: 0.
- Remote-only versions: 0.
- `inventory_v1_certification_status().certified`: `true`.
- Negative batches: 0.
- New noncanonical movements: 0.
- New Sales Invoice physical movements: 0.
- Approved DC movement mismatches: 0.
- Material Return movement mismatches: 0.
- Credit Note movement mismatches: 0.
- Stock Rejection movement mismatches: 0.
- Active reservations on expired batches: 0.
- Anonymous Inventory `SECURITY DEFINER` execution paths: 0.

## Regression

The authenticated rollback suite passed after deployment. It covers:

- Batch Create/Edit/idempotency/negative prevention/archive;
- FEFO and expired batch exclusion;
- reservation release and recreation;
- Delivery Challan approval, FEFO enforcement, edit reversal/repost,
  cancellation/reversal, delete prevention;
- Sales Invoice Create/Edit/Delete with zero physical movement;
- Material Return approval/reversal;
- Credit Note approval/reversal;
- Stock Rejection approval/reversal;
- signed Stock Adjustment and duplicate prevention;
- Stock Summary and Inventory Movement report reconciliation.

Finance Version 1.0 release regression also passed after deployment, including
Salary, Salary Advance, Bank Reconciliation, Petty Cash, Trial Balance, P&L,
Balance Sheet, ledgers, tax/CA report contracts, and Customs Broker canonical
values.

## Historical reconciliation

Post-repair authenticated read-only result:

| Classification | Batches |
|---|---:|
| Verified | 16 |
| Legacy Verified | 19 |
| Repair Required | 0 |
| Manual Review | 3 |
| Total | 38 |

Three mathematically proven duplicate movement rows were marked superseded.
No quantity, batch balance, document, journal, or Finance record was changed.

The remaining manual-review batches are genuinely ambiguous and intentionally
unchanged:

- `4001/1101/25/A-3147`
- `B108/2026`
- `B109/2026`

They are historical review items, not forward-engine production blockers.

## Certification

Inventory Version 1.0 is approved for daily production use under the frozen
SAPJ architecture documented in `docs/inventory_bible.md`.
