# Anzen ERP — Architecture Docs

**Read these files FIRST** in any new Claude/AI session before diving into
the codebase. They exist to reduce rediscovery cost, prevent duplicate
logic, and keep the Finance module's accounting invariants intact.

## Load order

1. **[finance_rules.md](finance_rules.md)** — The constitution. Immutable
   accounting invariants that MUST NOT be violated. Read this first.
2. **[system_architecture.md](system_architecture.md)** — End-to-end flow
   across CRM → Sales → Inventory → Finance → Tax → Reports.
3. **[finance_architecture.md](finance_architecture.md)** — Chart of
   Accounts, all Finance flows, RPCs, triggers, and how modules post to
   the ledger.
4. **[tax_compliance.md](tax_compliance.md)** — Indonesian tax
   (PPN/PPh/Faktur Pajak) and the Tax Compliance Centre.
5. **[database.md](database.md)** — Per-table reference (purpose, FKs,
   triggers, RLS, RPCs, which UI uses it).
6. **[changelog.md](changelog.md)** — Major project milestones.
7. **[finance_v1_hardening.md](finance_v1_hardening.md)** — Version 1.0
   hardening evidence, regression matrix, open gates, and baseline plan.

## Golden rules for AI sessions editing this project

- **Never rebuild** what already exists. Reuse Journal, Ledger, Bank
  Reconciliation, Attachments, Approval Workflow.
- **Never post a JE by hand** in a new module. Route through the existing
  posting triggers or through a SECURITY DEFINER RPC that inserts into
  `journal_entries` + `journal_entry_lines` following the exact shape used
  elsewhere.
- **Never mutate a closed tax period** or a closed accounting period
  without explicit admin authorization plus an `audit_logs` entry.
- **Never bypass RLS** unless you are inside a SECURITY DEFINER function
  that itself enforces the role check.
- **Update these docs first** when the architecture changes, then commit
  the code change referencing the doc update.
