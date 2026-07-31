# Anzen ERP — Architecture Docs

**Read these files FIRST** in any new Claude/AI session before diving into
the codebase. They exist to reduce rediscovery cost, prevent duplicate
logic, and keep the Finance module's accounting invariants intact.

## Load order

1. **[finance_bible.md](finance_bible.md)** — The normative Finance Version 1.0
   technical and accounting reference. Read this first for every Finance
   change.
2. **[finance_rules.md](finance_rules.md)** — The constitution. Immutable
   accounting invariants that MUST NOT be violated. Read this first.
3. **[system_architecture.md](system_architecture.md)** — End-to-end flow
   across CRM → Sales → Inventory → Finance → Tax → Reports.
4. **[finance_architecture.md](finance_architecture.md)** — Chart of
   Accounts, all Finance flows, RPCs, triggers, and how modules post to
   the ledger.
5. **[tax_compliance.md](tax_compliance.md)** — Indonesian tax
   (PPN/PPh/Faktur Pajak) and the Tax Compliance Centre.
6. **[database.md](database.md)** — Per-table reference (purpose, FKs,
   triggers, RLS, RPCs, which UI uses it).
7. **[changelog.md](changelog.md)** — Major project milestones.
8. **[finance_v1_hardening.md](finance_v1_hardening.md)** — Version 1.0
   hardening evidence, regression matrix, open gates, and baseline plan.
9. **[finance_v1_reference.md](finance_v1_reference.md)** — frozen Finance
   posting, payment, receipt, broker, currency, tax, and UI flows.
10. **[finance_v1_release_notes.md](finance_v1_release_notes.md)** — release
   notes, production checklist, scores, and release risks.
11. **[migration_reconciliation_plan.md](migration_reconciliation_plan.md)** —
    local/remote drift evidence and the safe baseline strategy.

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
