# CHANGELOG — Major Anzen ERP Milestones

Reverse-chronological summary of major project milestones. Detailed
per-file diffs live in `git log`.

## 2026-07-13 — Security Audit + Tax Compliance Centre
- **Security audit fixes** (commit `dafc2bf`): CRITICAL + HIGH findings
  resolved — user self-promotion via user_profiles UPDATE blocked,
  auto_create_user_profile trigger no longer trusts raw_user_meta_data,
  audit_logs INSERT restricted to self, notifications spoofing closed,
  pricing_settings UPDATE restricted to admin/manager. See
  `SECURITY_AUDIT_2026-07-13.md`.
- **Migration idempotency fix** (`36e52c7`): `upsert_notification` migration
  now drops-then-creates by iterating `pg_proc`, safe against pre-existing
  functions with a different return type.
- **Tax Compliance Centre — schema + RPCs** (`8b9d595`): 6 new tables,
  4 new views, 8 new RPCs including `record_tax_payment` which posts a
  journal entry through the same rails as any payment voucher. Auto-
  reconciliation trigger integrates with existing Bank Reconciliation.
  See `docs/TAX_COMPLIANCE.md`.
- **Tax Compliance Centre — UI** (`081546e`): 6 workflow-oriented panels
  replacing the Tax Reports tab (Calendar, PPN Periods, PPh Register,
  Tax Payments, Faktur Pajak, Period Close). Legacy report registers
  retained as one sub-tab.
- **Dashboard integration** (`1d0fcd3`): Tax Compliance cards for admin
  and accounts roles.
- **Architecture docs** (this commit): 6 markdown docs in `docs/` —
  README, FINANCE_RULES (the constitution), SYSTEM_ARCHITECTURE,
  FINANCE_ARCHITECTURE, TAX_COMPLIANCE, DATABASE_SCHEMA, CHANGELOG.

## 2026-07-09 — Finance stabilization pass
- Staff / Utility masters (`12336bd`).
- `delete_purchase_invoice` self-verifying reversal (`10af557`).

## 2026-07-08 — Finance Core frozen
- Commit `b119b7d`: user declared Finance stable after QA sprint. Freeze
  lifted for the Tax Compliance sprint on 2026-07-13.

## 2026-07 (early) — Finance QA + SAP layout sweep
- SAP B1 header layout applied across Expense, Payment, Receipt, Contra,
  Petty Cash, Purchase, Journal, Supplier, Bank, COA, Staff, Utility.
- Dynamic expense form (Salary / Utility / Broker / Normal categories).
- Broker calc engine — 10-column reimbursement grid.

## 2026-07-02 — Finance tax engine hardening
- `finance_tax_engine_hardening.sql` — reworked PPN views.
- Broker items with per-line PPN and PPh 23 tracking.
- Import PIB category breakdown.

## 2026-01 — Payment voucher bank-account fix
- `fix_payment_voucher_use_specific_bank_account.sql` — payment voucher
  now credits the specific bank account instead of a default.

## 2025-12-24/25 — COGS accounting + Expense auto-post
- `add_cogs_accounting_to_sales_invoice.sql` — post COGS + Inventory
  clearing on sales invoice.
- `add_expense_accounting_auto_posting.sql` — finance_expenses trigger
  fires JE.

## 2025-12-16 — Complete Indonesian accounting system
- `complete_indonesian_accounting_system.sql` — the foundation: CoA,
  accounting_periods, tax_codes, organization_tax_settings, suppliers,
  journal_entries + lines, purchase_invoices, receipt_vouchers,
  payment_vouchers, voucher_allocations, petty_cash, bank_reconciliation.

## 2025-12-11 — Manager role + approval system
- `add_manager_role_and_approval_system.sql` — approval_workflows +
  approval_thresholds.

## 2025-11-20 — Initial finance expansion
- `expand_finance_accounts_and_payments.sql` — bank_accounts,
  customer_payments, vendor_bills.

## 2025-10-31 / 2025-11-20 — Pharma trading schema
- Initial pharma trading domain: customers, products, batches, sales,
  audit_logs, user_profiles.
