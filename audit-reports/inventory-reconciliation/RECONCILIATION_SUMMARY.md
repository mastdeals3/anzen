# SAPJ Inventory Batch Reconciliation

Generated: 2026-08-01T06:44:11.269Z

Mode: **read only**. No historical stock, movements, reservations, or source
documents were modified.

## Result

| Classification | Batches |
|---|---:|
| Verified | 16 |
| Legacy Verified | 17 |
| Manual review required | 3 |
| Repair required | 2 |
| **Total batches** | **38** |

## Safe repair proposals

- **4001/1101/25/A-3145**: mark movement row(s) `bcb32e37-4ce5-4660-b9ef-59fa44fa2b67` superseded; retain `d3339284-bba1-4b11-9dfe-29413481c861`. No stock quantity or source document change.
- **4001/1101/25/A-3146**: mark movement row(s) `6165ec64-4f05-4038-98f0-253778bb248f`, `7b7fee55-8466-40b3-8097-7b72570a4572` superseded; retain `6c4d2e70-c6eb-41e0-a7bd-4de5c169da34`. No stock quantity or source document change.

These proposals are not executable output. They do not authorize changes and
must be revalidated immediately before any later repair.

## Manual review

- **4001/1101/25/A-3147**: ambiguous adjustment 2f2e2e0a-8757-4161-9815-f53f12fe9b3f: positive quantity without reliable before/after evidence
- **B108/2026**: b8a7efcb-bb6f-4b35-84de-624ea1c696eb: orphan sale movement — no invoice item or approved DC item supports this sale movement
- **B109/2026**: 9f9d4d9d-4ad1-4cb1-ac91-3f34e0ca39b3: orphan sale movement — no invoice item or approved DC item supports this sale movement

## Rules applied

- Batch Creation is the only inbound stock source.
- Approved Delivery Challan is the only normal outbound stock source.
- Sales Invoice is accounting-only in the canonical architecture.
- Historical `sale` rows are traced through invoice items, linked Delivery
  Challan items, Delivery Challans, and Sales Orders before classification.
- Explicitly superseded movements remain visible as audit evidence but are
  excluded from effective physical stock.
- A unique direct-reference or document-number/batch/quantity/date match may
  verify a legacy row. Multiple candidates remain Manual Review.
- `delivery_challan_reserved` rows are reservation history, not physical
  movement.
- Active, unreleased reservations determine Reserved Quantity.
- Approved/restocked Material Returns and approved Credit Notes are return
  candidates. Where their relationship cannot be proven, the batch is sent to
  manual review.
- Signed adjustments are accepted only when their direction is mathematically
  supported by their sign or stock-before/stock-after values.
- Positive adjustments without reliable before/after evidence are ambiguous
  because the current adjustment RPC can lose an outbound sign.
- No repair is proposed for a Manual Review batch.

## Repair gate

Only rows classified as `REPAIR REQUIRED` are eligible for a proposed repair,
and only where the contradiction is mathematically provable. This report does
not perform or authorize repair. Every `MANUAL REVIEW` row requires
documentary investigation first.
