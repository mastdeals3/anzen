# SAPJ ERP Inventory Version 1.0 Integrity Audit

Audit date: 1 August 2026
Audit mode: report only; no application, migration, Finance, or production-data
changes were made

## Certified SAPJ architecture used for this audit

```text
Purchase Order       commercial only; no stock
Purchase Invoice     Finance only; no stock
Container Import     landed-cost context; no quantity movement
Batch Creation       the only inbound stock event
Sales Order          creates reservations; no physical stock movement
Delivery Challan     approval is the only outbound stock event
Sales Invoice        accounting only; no stock movement
```

GRN and godown workflows are not part of SAPJ Version 1.0 and were not treated
as missing features.

## Executive conclusion

Inventory Version 1.0 is **not production-ready**.

The repository does implement the intended Batch inbound and Delivery Challan
outbound concepts, but it also contains active conflicting paths that violate
that architecture:

- manual adjustments do not preserve the sign of outbound movement;
- direct Sales Invoice items can deduct stock;
- approved DC deletion does not reverse physical stock;
- approved DC editing deletes historical movement rows;
- the Inventory Movement report excludes the canonical DC outflow;
- Credit Note stock restoration is currently a no-op;
- FEFO is not enforced consistently;
- batch edits rewrite stock from incomplete client-side evidence;
- duplicate migration versions prevent deterministic deployment.

Repository-level readiness is assessed at **46%**. Authenticated staging and
live-data reconciliation remain blocked because this workspace has no database
or service-role audit credentials.

## Validation evidence

| Check | Result |
|---|---|
| Production build | Passed |
| TypeScript | Failed, including Inventory/Sales/Returns errors |
| ESLint | Failed: 914 errors and 112 warnings |
| Existing DC lifecycle test | Could not start because `scripts/.env.local` is missing |
| Authenticated database integrity audit | Not available; no database/service-role credentials |
| Migration filename integrity | Failed: 9 duplicate versions across 24 files |
| Inventory import/export verification | No dedicated manifest or regression command found |

# Critical Issues

## C-01 — Inventory has multiple stock-writing authorities

### Root Cause

`batches.current_stock` is updated directly by UI code, adjustment RPCs,
Delivery Challan triggers, return/rejection functions, Sales Invoice triggers,
and repair scripts. Separately,
`trigger_update_batch_stock` derives current stock by summing
`inventory_transactions`.

The result depends on trigger order and which function definition a database
received from migration history.

### Business Impact

Concurrent operations, retries, edits, and reversals cannot be proven
idempotent. Batch balances and the movement ledger can diverge.

### Files affected

- `src/pages/Inventory.tsx`
- `src/pages/Batches.tsx`
- `src/pages/DeliveryChallan.tsx`
- `supabase/migrations/20251202075645_fix_batch_stock_with_negative_handling.sql`
- `supabase/migrations/20260418120000_add_operation_id_to_inventory_movements.sql`
- `supabase/migrations/20260511094329_fix_dc_approval_so_status_enum_cast.sql`
- `supabase/migrations/20251211060940_create_material_returns_and_stock_rejections.sql`

### Database objects affected

- `batches.current_stock`
- `inventory_transactions`
- `post_inventory_movement`
- `adjust_batch_stock_atomic`
- `update_batch_stock_from_transactions`
- `trigger_update_batch_stock`
- DC, return, rejection, and invoice stock triggers

### Proposed Fix

Make one locked, signed, idempotent database movement command the only writer.
All source workflows must call it. UI components must never write
`current_stock` or inventory movement rows directly.

## C-02 — Manual outbound stock is persisted as positive movement

### Root Cause

`Inventory.tsx` sends a negative `p_quantity_change` for a sale, but
`adjust_batch_stock_atomic` sends `ABS(p_quantity_change)` to
`post_inventory_movement`.

### Business Impact

A manual sale or outbound adjustment can be represented as inbound stock and
can increase the batch balance when stock is recalculated from movement rows.

### Files affected

- `src/pages/Inventory.tsx:244-262`
- `supabase/migrations/20260418120000_add_operation_id_to_inventory_movements.sql:369-422`
- `supabase/migrations/20251202075645_fix_batch_stock_with_negative_handling.sql`

### Database objects affected

- `adjust_batch_stock_atomic`
- `post_inventory_movement`
- `inventory_transactions`
- `batches`

### Proposed Fix

Persist the signed quantity unchanged and validate the resulting stock in the
same locked transaction.

## C-03 — Sales Invoice can still deduct stock

### Root Cause

The latest Sales Invoice item trigger skips movement only for DC-linked items.
For a non-DC invoice item, it directly reduces batch stock and inserts a
`sale` movement.

This violates the SAPJ rule that Delivery Challan Approval is the only outbound
event and Sales Invoice is accounting only.

### Business Impact

Direct or incorrectly linked invoice items can create an unauthorized stock
outflow. Deleting such an item creates another stock adjustment, establishing
a second outbound/reversal engine outside Delivery Challan.

### Files affected

- `src/pages/Sales.tsx`
- `supabase/migrations/20260511082810_fix_invoice_stock_double_count_and_archive_duplicates.sql`
- `supabase/migrations/20260603130000_fix_sales_invoice_item_delete_fk.sql`

### Database objects affected

- `sales_invoices`
- `sales_invoice_items`
- `trg_sales_invoice_item_inventory`
- `inventory_transactions`
- `batches`

### Proposed Fix

Make the Sales Invoice inventory trigger validation-only. Reject invoice items
that do not resolve to approved DC items under the existing SAPJ workflow.
Sales Invoice insert, edit, delete, and reverse must never change stock.

## C-04 — Approved Delivery Challan deletion does not restore stock

### Root Cause

The UI hard-deletes the DC and directly resets the Sales Order status.
`fn_restore_reservation_on_dc_delete` recreates reservations but does not
reverse physical stock or post a reversal movement.

### Business Impact

An approved, uninvoiced DC can disappear while its stock deduction remains.
The source document and physical movement no longer reconcile.

### Files affected

- `src/pages/DeliveryChallan.tsx:884-918`
- `supabase/migrations/20260416200000_fix_dc_release_reservation_any_batch.sql`

### Database objects affected

- `delivery_challans`
- `delivery_challan_items`
- `fn_restore_reservation_on_dc_delete`
- `batches`
- `inventory_transactions`
- `stock_reservations`
- `sales_orders`

### Proposed Fix

Replace direct deletion with one guarded DC cancellation/reversal RPC. Approved
DCs must be reversed before any deletion is allowed.

## C-05 — Approved Delivery Challan edit deletes stock history

### Root Cause

`admin_edit_approved_delivery_challan` restores stock and deletes existing
`inventory_transactions` before inserting replacement rows.

### Business Impact

Historical stock evidence is destroyed. The original quantity, actor,
timestamp, and before/after balances are not retained.

### Files affected

- `src/pages/DeliveryChallan.tsx`
- `supabase/migrations/20260418123000_enforce_unique_operation_id_inventory_transactions.sql:295-389`

### Database objects affected

- `admin_edit_approved_delivery_challan`
- `inventory_transactions`
- `delivery_challan_items`
- `batches`

### Proposed Fix

Post reversal movements against the old DC lines and then post the revised
movement set under a new operation ID. Never delete historical movement rows.

## C-06 — Inventory Movement report excludes the canonical outbound event

### Root Cause

The CA Inventory Movement report excludes `delivery_challan` and counts
`sale`, based on an assumption that invoice movement is canonical. SAPJ uses
the opposite rule: approved DC is canonical and Sales Invoice must not move
stock.

### Business Impact

Normal SAPJ deliveries can be absent from stock outflow and closing stock.
Report totals cannot reconcile to batch stock.

### Files affected

- `src/components/finance/CAReports.tsx:336-355`

### Database objects affected

- `inventory_transactions`
- Delivery Challan and Sales Invoice source references

### Proposed Fix

Move report classification to a backend view/RPC and count:

- Batch Creation as inbound;
- approved Delivery Challan as outbound;
- approved canonical returns/reversals as applicable;
- no Sales Invoice quantity movement.

## C-07 — Credit Note approval does not restore stock

### Root Cause

The stock-refactor cleanup replaced both Credit Note stock functions with
status-only no-op implementations. No later migration restores the stock
posting behavior.

### Business Impact

A post-invoice return can update accounting and commercial records without
restoring physical batch stock.

### Files affected

- `src/pages/CreditNotes.tsx`
- `supabase/migrations/20260418120000_cleanup_inventory_triggers_post_stock_refactor.sql:110-140`
- `supabase/migrations/20260418120000_cleanup_inventory_triggers_post_stock_refactor.sql:183-203`

### Database objects affected

- `credit_notes`
- `credit_note_items`
- `trg_credit_note_item_inventory`
- `trg_credit_note_status_change`
- `inventory_transactions`
- `batches`

### Proposed Fix

Route approved Credit Note returns and their reversal through the canonical
movement command, linked to the original DC batch movement.

## C-08 — Migration history cannot reproduce one inventory engine

### Root Cause

The active directory contains 9 duplicate migration versions across 24 files.
Six different files share `20260418120000`; several redefine the same stock
functions with incompatible behavior.

### Business Impact

Clean installations and upgraded databases cannot be proven equivalent. One
environment may deduct at DC while another may retain obsolete invoice or
trigger behavior.

### Files affected

- `supabase/migrations/20260418120000_*.sql`
- `supabase/migrations/20260418123000_*.sql`
- all other duplicate-version groups

### Database objects affected

- `post_inventory_movement`
- `adjust_batch_stock_atomic`
- `trg_dc_approval_deduct_stock`
- `trg_sales_invoice_item_inventory`
- `sync_batch_stock_on_sale`
- `admin_edit_approved_delivery_challan`
- Inventory triggers and constraints

### Proposed Fix

Reconcile local and remote migration history, isolate duplicate/superseded
files, and add uniquely versioned convergence migrations for the certified
SAPJ definitions.

# High Issues

## H-01 — Batch edit reconstructs stock from incomplete client-side evidence

### Root Cause

Batch edit validates consumption only from `sales_invoice_items`, updates all
matching purchase movements, ignores movement-update failure, sums movement
rows in the browser, and directly writes `batches.current_stock`.

### Business Impact

DC deliveries, rejected stock, adjustments, and returns may be ignored.
Multiple inbound rows can be overwritten and batch history can diverge.

### Files affected

- `src/pages/Batches.tsx:292-385`

### Database objects affected

- `batches`
- `inventory_transactions`
- `delivery_challan_items`
- return/rejection tables

### Proposed Fix

Create a guarded batch-edit RPC that updates the identified opening movement,
validates against canonical movement history and reservations, and performs all
changes atomically.

## H-02 — FEFO is not the shared allocation rule

### Root Cause

Reservation and Delivery Challan selection sort primarily by import date.
The actual SO-to-DC batch selection path does not consistently exclude expired
batches. FEFO logic is duplicated between SQL and React.

### Business Impact

An expired or later-expiring pharmaceutical batch can be selected while a
valid earlier-expiring batch is available.

### Files affected

- `src/pages/DeliveryChallan.tsx:372-379`
- `src/pages/DeliveryChallan.tsx:403-411`
- `src/pages/DeliveryChallan.tsx:464-472`
- `supabase/migrations/20260627100000_fix_reserve_fn_v2_no_delete_history.sql`

### Database objects affected

- `fn_reserve_stock_for_so_v2`
- `batches`
- `stock_reservations`

### Proposed Fix

Implement one backend FEFO selector:

1. exclude expired/inactive/zero-free-stock batches;
2. order by non-null earliest expiry;
3. use import date and batch creation as deterministic tie-breakers.

Reservation and DC creation must consume the same result.

## H-03 — Approved Material Return can be deleted without reversal

### Root Cause

Approval adds stock through `handle_material_return_approval`, but the UI
directly deletes the source document and no delete/reversal stock function is
installed.

### Business Impact

Returned stock can remain after its source document is removed.

### Files affected

- `src/pages/MaterialReturns.tsx`
- `supabase/migrations/20251211060940_create_material_returns_and_stock_rejections.sql`

### Database objects affected

- `material_returns`
- `material_return_items`
- `handle_material_return_approval`
- `inventory_transactions`
- `batches`

### Proposed Fix

Block approved hard deletion. Reverse the original movement through a guarded
RPC and preserve both records.

## H-04 — Rejected Stock has no certified reversal lifecycle

### Root Cause

Approval directly reduces batch stock and creates a negative movement. No
canonical reverse/cancel function exists for an approved rejection, and the
implementation bypasses the intended shared movement command.

### Business Impact

An incorrectly approved rejection cannot be safely corrected while preserving
stock history.

### Files affected

- `src/pages/StockRejections.tsx`
- `supabase/migrations/20251211060940_create_material_returns_and_stock_rejections.sql`

### Database objects affected

- `stock_rejections`
- `handle_stock_rejection_approval`
- `inventory_transactions`
- `batches`

### Proposed Fix

Post rejection and reversal through the canonical movement function with
source-owned operation IDs.

## H-05 — Batch manufacturing date is not implemented

### Root Cause

The active `batches` model and Batches UI have expiry date but no manufacturing
date. Manufacture date exists only in obsolete GRN definitions, which are not
part of SAPJ.

### Business Impact

Pharmaceutical batch traceability is incomplete and manufacturing/expiry
validation cannot be enforced.

### Files affected

- `src/pages/Batches.tsx`
- `supabase/migrations/20251031125209_create_pharma_trading_schema.sql`

### Database objects affected

- `batches`

### Proposed Fix

Add manufacturing date to the existing Batch workflow and validate that it is
not after expiry date. This extends Batch metadata only; it does not introduce
a new workflow.

## H-06 — Inventory regression testing is not release-grade

### Root Cause

The only stock lifecycle script covers three DC scenarios, depends on a
missing credential file, performs best-effort cleanup rather than database
rollback, and has no package command.

### Business Impact

Batch, FEFO, returns, adjustments, invoice non-movement, and report regressions
can ship undetected.

### Files affected

- `scripts/e2e-dc-lifecycle.test.mjs`
- `package.json`

### Database objects affected

- All Inventory source and movement objects

### Proposed Fix

Create one authenticated transactional test runner that always rolls back and
covers every required lifecycle and invariant.

# Medium Issues

## M-01 — Inventory reports calculate independently in React

Stock summary, drill-down, CA movement, Sales costing, and batch screens each
derive quantities or costs independently. This violates the one-backend-engine
requirement.

## M-02 — Inventory import/export contracts are incomplete

No canonical manifest or permanent regression exists for Batch import,
opening stock, movement export, stock export, or batch export.

## M-03 — Movement type and sign semantics are inconsistent

The repository uses `purchase`, `sale`, `delivery`,
`delivery_challan`, `return`, `adjustment`, `rejection`,
`reservation`, and `release_reservation` with differing sign assumptions.

## M-04 — Landed-cost formulas have competing historical definitions

Container cost allocation is defined by quantity in some functions and invoice
value in others. Historical functions also use `final_landed_cost` with
different total/per-unit meanings. The live effective definition must be
certified before inventory valuation can pass.

## M-05 — Stock summary has an N+1 query pattern

`Stock.tsx` performs one reservation query for each product instead of using a
grouped backend view/RPC.

## M-06 — Obsolete GRN migrations remain referenced

The repository correctly drops GRN tables in
`20251224144845_add_batch_accounting_trigger.sql`, but later conditional
security migrations still contain GRN-specific code. This does not justify
reintroducing GRN; it should be classified during migration reconciliation so
future convergence work cannot accidentally restore it.

# Low Issues

## L-01 — Incomplete inventory controls remain visible in source

Unused Upload/Download controls and imports indicate unfinished or obsolete
inventory import/export work.

## L-02 — Build succeeds with large-chunk warnings

This is a performance concern, not a stock-integrity blocker.

# Required authenticated data checks

Before historical repair, generate a read-only reconciliation report for:

1. batch current stock versus canonical signed movement sum;
2. batch reserved stock versus active reservations;
3. negative stock and reservations above current stock;
4. duplicate operation IDs and duplicate source movements;
5. batches without exactly one canonical creation movement;
6. approved DC items without exactly one outbound movement;
7. Sales Invoice items that created any physical movement;
8. deleted/missing DC references with surviving deductions;
9. approved Credit Notes without return movements;
10. approved Material Returns without return movements;
11. approved Stock Rejections without one rejection movement;
12. expired batches in active reservations or approved DCs;
13. duplicate batch numbers and invalid manufacture/expiry ordering;
14. landed-cost valuation by batch versus Inventory GL;
15. orphan movements, reservations, DC items, invoice links, and return items.

# Corrected remediation order

1. Reconcile duplicate migration versions and capture the live definitions.
2. Establish one signed, locked, idempotent movement function.
3. Preserve Batch Creation as the only inbound event.
4. Preserve Delivery Challan Approval as the only normal outbound event.
5. Remove all Sales Invoice stock mutation.
6. Implement reversal-based DC edit/cancel/delete.
7. Route returns, rejections, and adjustments through the same movement engine.
8. Move FEFO into one backend selector used by reservations and DCs.
9. Replace frontend report calculations with canonical views/RPCs.
10. Add manufacturing date to the existing Batch model.
11. Produce historical reconciliation evidence before any data repair.
12. Add transactional rollback regression tests and import/export contracts.

# Certification score

| Area | Score |
|---|---:|
| SAPJ architecture alignment | 50% |
| Canonical movement integrity | 30% |
| Batch integrity | 50% |
| DC lifecycle integrity | 45% |
| Sales Invoice non-movement | 45% |
| Returns/reversal integrity | 30% |
| FEFO | 35% |
| Report accuracy | 35% |
| Migration reproducibility | 25% |
| Regression coverage | 20% |
| **Overall readiness** | **46%** |

Inventory Version 1.0 cannot be certified until every Critical issue is fixed,
authenticated staging regression passes, the live-data reconciliation report
is clean, and the same stock figures reconcile across Batch, movement ledger,
reservations, DC, returns, valuation, and reports.
