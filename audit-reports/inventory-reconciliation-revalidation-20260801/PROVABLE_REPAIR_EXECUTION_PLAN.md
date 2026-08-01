# Inventory V1 Provable Repair Execution Plan

Date: 1 August 2026

Source: the authenticated read-only reconciliation generated in this directory.

## Authorized scope

Three duplicate legacy `inventory_transactions` rows across two batches may be
marked `metadata.superseded = true`:

- `4001/1101/25/A-3145`
  - Supersede `bcb32e37-4ce5-4660-b9ef-59fa44fa2b67`
  - Retain `d3339284-bba1-4b11-9dfe-29413481c861`
- `4001/1101/25/A-3146`
  - Supersede `6165ec64-4f05-4038-98f0-253778bb248f`
  - Supersede `7b7fee55-8466-40b3-8097-7b72570a4572`
  - Retain `6c4d2e70-c6eb-41e0-a7bd-4de5c169da34`

## Safety controls

Migration
`20260801122000_inventory_v1_provable_legacy_metadata_repairs.sql` verifies:

- exact batch IDs, numbers, and current balances;
- exact approved Delivery Challan item IDs and quantities;
- exact duplicate and retained movement IDs, quantities, and document numbers;
- exactly three rows are updated.

Any changed precondition aborts the migration.

The migration does not alter stock quantities, movement quantities,
reservations, source documents, journals, ledgers, or Finance records.

## Excluded records

The three `MANUAL REVIEW` batches remain unchanged:

- `4001/1101/25/A-3147`
- `B108/2026`
- `B109/2026`
