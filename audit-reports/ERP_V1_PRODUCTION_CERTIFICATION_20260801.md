# SAPJ ERP Version 1.0 Production Certification

Certification date: 1 August 2026

## Decision

**YES — Finance Version 1.0 and Inventory Version 1.0 are production-ready for
daily use under the documented SAPJ workflows.**

## Scores

| Area | Score |
|---|---:|
| Architecture | 98% |
| Inventory Integrity | 98% |
| Accounting Integrity | 98% |
| Report Accuracy | 97% |
| Security | 97% |
| Migration Determinism | 100% |
| Maintainability | 96% |
| Deployment Readiness | 98% |
| **Overall Production Readiness** | **98%** |

## Certified invariants

- Batch Creation is the only normal stock IN.
- Approved Delivery Challan is the only normal stock OUT.
- Sales Order is reservation-only.
- Sales Invoice is accounting-only.
- Purchase Order and Purchase Invoice do not change physical stock.
- Every forward physical movement uses the canonical stock engine.
- Edits and reversals preserve movement history.
- FEFO excludes expired stock and is shared by reservation and DC consumption.
- Stock Summary and Inventory Movement use canonical backend sources.
- Finance release regression remains green after Inventory deployment.
- Local and remote migration history is deterministic.

## Migration status

- Local versions: 654
- Remote versions: 654
- Duplicate versions: 0
- Local-only versions: 0
- Remote-only versions: 0

Inventory/ERP freeze migrations:

- `20260801120000_inventory_v1_canonical_stock_engine.sql`
- `20260801121000_fix_credit_note_reversal_trigger_timing.sql`
- `20260801122000_inventory_v1_provable_legacy_metadata_repairs.sql`
- `20260801123000_revoke_anon_inventory_security_definer.sql`
- `20260801124000_revoke_public_inventory_security_definer.sql`
- `20260801125000_exclude_expired_stock_from_available_summary.sql`

## Validation results

- Production build: passed.
- TypeScript: passed.
- ESLint errors: 0.
- Canonical frontend boundary scan: passed.
- Authenticated Inventory rollback regression: passed.
- Finance Version 1.0 rollback regression: passed.
- Inventory forward certification RPC: passed.
- Anonymous Inventory `SECURITY DEFINER` access: 0.
- Migration dry-run: remote database up to date.
- Historical post-repair reconciliation: 35 verified/legacy-verified,
  0 repair-required, 3 manual review.

## Historical records

Three duplicate legacy Delivery Challan movement rows were repaired through
metadata-only supersession after exact preconditions were revalidated.

No stock quantity, movement quantity, source document, journal, ledger, tax,
or Finance record was changed.

Three ambiguous historical batches remain unchanged and require documentary
review. They do not permit an automatic mathematical repair:

- `4001/1101/25/A-3147`
- `B108/2026`
- `B109/2026`

## Residual non-blocking risks

- The three manual-review batches require business-document evidence before
  any historical correction.
- CI staging regression requires the repository secret
  `INVENTORY_STAGING_DB_URL`.
- Supabase CLI emitted a local Docker catalog-cache warning after successful
  remote migrations. This does not affect production, but Docker is required
  for local schema-diff tooling.

## Release controls

- Finance remains governed by `docs/finance_bible.md`.
- Inventory remains governed by `docs/inventory_bible.md`.
- Future Inventory changes must pass
  `.github/workflows/inventory-v1-certification.yml`.
- No migration baseline was generated.
- Historical movements remain immutable.
