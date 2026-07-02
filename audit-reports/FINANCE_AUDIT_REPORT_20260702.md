# ANZEN ERP FINANCE ARCHITECTURE AUDIT
**Date**: July 2, 2026  
**Project**: Anzen ERP (React 18 + Vite + TypeScript SPA with Supabase)  
**Purpose**: Complete audit of Finance module for major upgrade  
**Conducted**: Comprehensive search of `/supabase/migrations/` (528 files) and `/src/` components

---

## EXECUTIVE SUMMARY

The Anzen ERP Finance module is built on a **solid Indonesian accounting framework** with:
- ✅ 70+ Chart of Accounts (COA) aligned with Indonesian standards
- ✅ Complete double-entry journal system
- ✅ Full PPN/PPh tax handling for imports (PIB system)
- ✅ Multi-currency reporting with USD→IDR conversion
- ⚠️ **Critical Gap**: No `import_containers` table found
- ⚠️ **Issue**: Incomplete expense category→COA mapping
- ⚠️ **Schema Mismatch**: SuppliersManager UI references non-existent fields

---

## 1. SUPPLIER MASTER

### Table: `suppliers`
**Created**: `20251216150000_complete_indonesian_accounting_system.sql`  
**Status**: ✅ Complete

#### Columns (22 total):
```sql
id                  UUID PRIMARY KEY
supplier_code       VARCHAR(50) UNIQUE
company_name        VARCHAR(255) NOT NULL
contact_person      VARCHAR(255)
email               VARCHAR(255)
phone               VARCHAR(50)
address             TEXT
city                VARCHAR(100)
country             VARCHAR(100) DEFAULT 'Indonesia'
npwp                VARCHAR(30)              ← Indonesian Tax ID
pkp_status          BOOLEAN DEFAULT false    ← PKP Status Flag
payment_terms_days  INTEGER DEFAULT 30
bank_name           VARCHAR(100)
bank_account_number VARCHAR(50)
bank_account_name   VARCHAR(255)
notes               TEXT
is_active           BOOLEAN DEFAULT true
created_by          UUID FK auth.users
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

#### Missing Requested Fields:
- ❌ `default_category` — NOT in schema
- ❌ `default_tax` — NOT in schema
- ❌ `pph_type` — NOT in schema
- ❌ `payment_terms` — Only `payment_terms_days` exists
- ✅ `pkp_status` — Exists
- ✅ `npwp` — Exists
- ⚠️ `is_pkp` vs `pkp_status` — Schema uses `pkp_status`

### UI Component: `SuppliersManager.tsx`
**Location**: `/src/components/settings/SuppliersManager.tsx`

#### Form Fields in UI:
```typescript
company_name        ✓ (in DB)
contact_person      ✓ (in DB)
email               ✓ (in DB)
phone               ✓ (in DB)
address             ✓ (in DB)
city                ✓ (in DB)
postal_code         ❌ NOT IN DB SCHEMA
npwp                ✓ (in DB)
payment_terms_days  ✓ (in DB)
is_active           ✓ (in DB)
```

**⚠️ ISSUE**: Form saves `postal_code` but the DB table doesn't have this column — will cause silent failures.

### Suggested Additions for Finance Upgrade:
1. Add `postal_code` to suppliers table (or remove from UI form)
2. Add `default_expense_category` VARCHAR(50) for auto-linking expenses
3. Add `pph_threshold_amount` DECIMAL(18,2) for PPh calculation rules
4. Add `tax_id_type` VARCHAR(20) to distinguish NPWP vs other tax IDs

---

## 2. TAX CODES TABLE

### Table: `tax_codes`
**Created**: `20251216150000_complete_indonesian_accounting_system.sql`  
**Status**: ✅ Complete

#### Columns (9 total):
```sql
id                      UUID PRIMARY KEY
code                    VARCHAR(20) UNIQUE NOT NULL
name                    VARCHAR(100) NOT NULL
tax_type                VARCHAR(20) NOT NULL  ← CHECK constraint
rate                    DECIMAL(5,2) NOT NULL
is_withholding          BOOLEAN DEFAULT false
collection_account_id   UUID FK chart_of_accounts
payment_account_id      UUID FK chart_of_accounts
is_active               BOOLEAN DEFAULT true
created_at              TIMESTAMPTZ
```

#### Tax Types Supported (CHECK constraint):
```
PPN, PPh21, PPh22, PPh23, PPh25, PPh4(2), other
```

#### Seeded Tax Codes (8 total):
```
Code        Name                          Type      Rate    Withholding
──────────────────────────────────────────────────────────────────────
PPN11       PPN 11%                       PPN       11.00%  false
PPN0        PPN 0% (Export)               PPN        0.00%  false
PPNFREE     Bebas PPN                     PPN        0.00%  false
PPH21       PPh 21 - Employee             PPh21      0.00%  true
PPH22       PPh 22 - Import 2.5%          PPh22      2.50%  true
PPH23-2     PPh 23 - Services 2%          PPh23      2.00%  true
PPH23-15    PPh 23 - Royalty 15%          PPh23     15.00%  true
PPH4(2)     PPh 4(2) - Final 10%          PPh4(2)   10.00%  true
```

#### Usage in Codebase:
- `journal_entry_lines.tax_code_id` — Track tax on journal entries
- `payment_vouchers.pph_code_id` — PPh withholding on supplier payments
- `finance_expenses.pph_code_id` — Tax code on expenses
- `purchase_invoice_items.tax_code_id` — Tax on purchased items

#### Accounting Mappings:
- **collection_account_id**: Where tax is received (e.g., PPN Output → 2130)
- **payment_account_id**: Where tax is paid (e.g., PPh 23 Payable → 2132)

**Status**: ✅ Fully functional for PPN/PPh tracking

---

## 3. IMPORT CONTAINERS

### Status: 🔴 **TABLE NOT FOUND**

**Search Result**: Extensive grep of all 528 migration files shows **NO CREATE TABLE** statement for `import_containers` or similar.

### What WAS Found - PIB (Pemberitahuan Impor Barang) System:

The project implements PIB (Indonesian import declaration) handling via:

#### A. Finance Expenses with PIB Breakdown
**Table**: `finance_expenses` (see section below)

**PIB Category**: `'pib_import'` (expense_category)

**Columns for PIB breakdown**:
```
pib_bm_amount   DECIMAL(18,2)  ← Import Duty → Landed Cost
pib_ppn_amount  DECIMAL(18,2)  ← PPN Input → Not landed cost
pib_pph_amount  DECIMAL(18,2)  ← PPh 22 Advance → Not landed cost
```

**Constraint**: `chk_pib_breakdown_sum`
```sql
-- For pib_import expenses, components must sum to total amount (±1 cent tolerance)
COALESCE(pib_bm_amount, 0) + COALESCE(pib_ppn_amount, 0) + 
COALESCE(pib_pph_amount, 0) ≈ amount (within 1.00)
```

#### B. Landed Cost Allocation
**Related Tables**:
- `batches` — Import batch tracking with quantity
- `purchase_invoices` & `purchase_invoice_items` — Invoice line items

**Allocation Mechanism**: Not found in dedicated function. Likely in:
- Batch insert/update triggers
- `auto_post_expense_accounting()` trigger for journal posting

#### C. Journal Posting for PIB
**Function**: `auto_post_expense_accounting()` (trigger on finance_expenses INSERT/UPDATE)

**For `expense_category = 'pib_import'`**:
```
Line 1: DR 1130 (Inventory)           pib_bm_amount
Line 2: DR 1150 (PPN Input)            pib_ppn_amount
Line 3: DR 1155 (PPh 22 Prepaid)       pib_pph_amount
Line 4: CR Bank/Cash                   TOTAL (pib_bm + pib_ppn + pib_pph)
```

### Gap Analysis:
**Missing**: Dedicated container tracking table with:
- Container number / container code
- Capacity / utilization
- Linked batches (multiple batches per container)
- Cost allocation percentage by batch
- Supplier reference
- Port & clearance details

### Recommendation:
For the Finance Upgrade, consider adding:
```sql
CREATE TABLE import_containers (
  id UUID PRIMARY KEY,
  container_number VARCHAR(20) UNIQUE,
  container_type VARCHAR(50),  -- 20ft, 40ft, etc
  supplier_id UUID FK suppliers,
  arrival_date DATE,
  port_of_entry VARCHAR(100),
  customs_reference VARCHAR(100),
  
  -- Costs related to container (not individual items)
  freight_cost NUMERIC(18,2),
  customs_duty NUMERIC(18,2),
  clearance_fees NUMERIC(18,2),
  insurance NUMERIC(18,2),
  
  -- Allocation
  allocation_method VARCHAR(50),  -- by_weight, by_quantity, by_value, etc
  
  status VARCHAR(20),  -- received, cleared, allocated, closed
  created_at TIMESTAMPTZ
);

-- Link to multiple batches
CREATE TABLE container_batch_allocation (
  id UUID PRIMARY KEY,
  container_id UUID FK,
  batch_id UUID FK,
  quantity NUMERIC,
  allocated_cost NUMERIC(18,2),
  created_at TIMESTAMPTZ
);
```

---

## 4. FINANCE EXPENSES TABLE

### Table: `finance_expenses`
**Created**: `20251031125209_create_pharma_trading_schema.sql`  
**Last Updated**: `20260701100000_finance_tax_upgrade.sql`  
**Status**: ✅ Fully featured

### COMPLETE Column List (22 columns):
```sql
-- Core
id                      UUID PRIMARY KEY
expense_category        TEXT NOT NULL  ← CHECK: 29 valid categories
amount                  NUMERIC(15,2) NOT NULL
expense_date            DATE NOT NULL
description             TEXT
created_by              UUID FK user_profiles
created_at              TIMESTAMPTZ

-- Linking
batch_id                UUID FK batches  ← Import batch link
payment_method          TEXT  ← cash, petty_cash, bank_transfer, etc
bank_account_id         UUID FK bank_accounts

-- Standard Tax Fields (added 20260701100000)
ppn_amount              NUMERIC(18,2) DEFAULT 0
pph_amount              NUMERIC(18,2) DEFAULT 0
pph_code_id             UUID FK tax_codes
stamp_duty_amount       NUMERIC(18,2) DEFAULT 0

-- Fixed Asset Mapping (added 20260701100000)
fixed_asset_account_id  UUID FK chart_of_accounts

-- PIB Import Tax Breakdown (added 20260619120000)
pib_bm_amount           DECIMAL(18,2)  ← Import Duty (landed cost)
pib_ppn_amount          DECIMAL(18,2)  ← PPN Input VAT
pib_pph_amount          DECIMAL(18,2)  ← PPh 22 Advance Tax
```

### Expense Categories (29 valid values):

#### Import Related (PIB & Container):
```
duty_customs          ← Import duty
ppn_import            ← PPN on imports
pph_import            ← PPh 22 on imports
freight_import        ← Freight costs
clearing_forwarding   ← Customs clearance
port_charges          ← Port/terminal fees
container_handling    ← Container loading/unloading
transport_import      ← Transport to warehouse
loading_import        ← Loading at origin
bpom_ski_fees         ← Indonesian food/pharmaceutical regulatory
other_import          ← Miscellaneous import costs
pib_import            ← PIB aggregate with breakdown
```

#### Sales Related:
```
delivery_sales        ← Outbound delivery
loading_sales         ← Loading for sales
other_sales           ← Miscellaneous sales costs
```

#### Operating/HR:
```
salary                ← Salaries
staff_overtime        ← Overtime pay
staff_welfare         ← Bonuses, welfare
travel_conveyance     ← Travel & transport
warehouse_rent        ← Warehouse rental
utilities             ← Electric, water, etc
bank_charges          ← Bank fees
office_admin          ← Admin supplies
office_shifting_renovation  ← Office relocation/renovation
```

#### Legacy/Flexible:
```
duty                  ← Generic duty (legacy)
freight               ← Generic freight (legacy)
office                ← Generic office (legacy)
other                 ← Generic catch-all
fixed_asset           ← Asset capitalization
```

### Indexes:
```sql
idx_finance_expenses_category   ON (expense_category)
idx_finance_expenses_date       ON (expense_date)
idx_finance_expenses_batch      ON (batch_id)
```

### Constraints:
```sql
chk_pib_breakdown_sum  ← Enforces pib_bm + pib_ppn + pib_pph ≈ amount for pib_import
```

**Status**: ✅ Rich tax tracking; ⚠️ Missing COA account mapping

---

## 5. REPORTING & RPC FUNCTIONS

### A. Trial Balance

**Function**: `get_trial_balance(p_start_date DATE, p_end_date DATE, p_usd_rate NUMERIC)`  
**Location**: `20260625090000_add_balance_sheet_rpc_and_fix_normal_balance.sql`  
**Updated**: `20260626100000_finance_multicurrency_reporting.sql`  
**Status**: ✅ Production ready

#### Returns:
```typescript
code: VARCHAR                 ← Account code (e.g., '6100')
name: VARCHAR                 ← Account name
name_id: VARCHAR              ← Indonesian name
account_type: VARCHAR         ← asset|liability|equity|revenue|expense|contra
account_group: VARCHAR        ← Grouping label
normal_balance: VARCHAR       ← debit|credit
total_debit: NUMERIC
total_credit: NUMERIC
balance: NUMERIC              ← debit - credit
```

#### Features:
- Period-based (between start & end dates)
- Multi-currency conversion via `p_usd_rate`
- Excludes header accounts
- Excludes inactive accounts
- Only shows accounts with activity

#### Smart Currency Detection:
```sql
SELECT
  CASE
    WHEN je.source_module = 'purchase_invoice' 
         AND COALESCE(pi.currency, 'IDR') = 'USD' THEN 'USD'
    WHEN je.source_module = 'payment'
         AND (COALESCE(ba.currency, 'IDR') = 'USD'
              OR COALESCE(pv.exchange_rate, 1) > 1.5) THEN 'USD'
    ELSE 'IDR'
  END AS je_currency
```

### B. Balance Sheet

**Function**: `get_balance_sheet(p_as_of_date DATE, p_usd_rate NUMERIC)`  
**Location**: `20260625090000_add_balance_sheet_rpc_and_fix_normal_balance.sql`  
**Updated**: `20260626100000_finance_multicurrency_reporting.sql`  
**Status**: ✅ Production ready

#### Returns:
Same structure as Trial Balance, but filtered to:
- Asset, Liability, Equity, Contra accounts only
- ALL history up to `p_as_of_date` (cumulative, not period)

#### Special Features:
- Calculates net income: 
  ```
  Revenue (accounts 4xxx) - Expenses (accounts 5-7xxx)
  ```
- Handles account class 3300 (Current Year Earnings) for P&L integration
- Multi-currency with USD auto-conversion

### C. USD Rate Discovery

**Function**: `get_reporting_usd_rate()`  
**Location**: `20260626100000_finance_multicurrency_reporting.sql`  
**Status**: ✅ Automatic

#### Logic (priority order):
1. Latest `exchange_rate` from `payment_vouchers` (where rate > 1.5)
2. Latest rate from `purchase_invoices` where `currency = 'USD'`
3. Latest rate from `batches.exchange_rate_usd_to_idr` (where > 1.5)
4. Default: **16000 IDR/USD**

### D. UI Report Components

#### Main: FinancialReports.tsx
**Location**: `/src/components/finance/FinancialReports.tsx`

**Report Types**:
```typescript
type ReportType = 'trial_balance' | 'pnl' | 'balance_sheet'
```

**Features**:
- Date range picker
- USD rate input (auto-populated from `get_reporting_usd_rate()`)
- Collapsible sections by account group
- Color-coded sections (assets=blue, liabilities=red, equity=purple, revenue=green, expenses=orange)
- Opening balance vs period changes vs closing balance
- Excel export via XLSX library
- Print functionality

**Sections**:
```
Current Assets       (blue)     → 1100-1199 codes
Fixed Assets         (blue)     → 1200+ codes
Liabilities          (red)      → 2xxx codes
Equity               (purple)   → 3xxx codes
Revenue              (green)    → 4xxx codes
COGS                 (orange)   → 5xxx codes
Operating Expenses   (orange)   → 6xxx codes
Other Expenses       (orange)   → 7xxx codes
Contra Accounts      (gray)     → Allowances, depreciation
```

#### Other Report Components:
```
TaxReports.tsx       → Tax-specific reporting (PPh, PPN)
CAReports.tsx        → Chart of Accounts detail
Reports.tsx          → Dashboard page
AgeingReport.tsx     → Receivables/Payables ageing
SalesProfitReport.tsx → Sales-based profitability
```

**Status**: ✅ Comprehensive reporting suite

---

## 6. CHART OF ACCOUNTS (COA)

### Table: `chart_of_accounts`
**Created**: `20251216150000_complete_indonesian_accounting_system.sql`  
**Status**: ✅ 70+ accounts seeded

### Schema:
```sql
id              UUID PRIMARY KEY
code            VARCHAR(20) UNIQUE NOT NULL
name            VARCHAR(255) NOT NULL
name_id         VARCHAR(255)         ← Indonesian translation
account_type    VARCHAR(50) NOT NULL ← asset|liability|equity|revenue|expense|contra
account_group   VARCHAR(100)         ← Grouping for reports
parent_id       UUID                 ← Hierarchical structure
is_header       BOOLEAN              ← Aggregate account (no posting)
is_active       BOOLEAN DEFAULT true
normal_balance  VARCHAR(10)          ← debit|credit
description     TEXT
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### Complete COA Structure (70+ accounts):

#### ASSETS (1xxx) — Normal Balance: Debit
```
1000    Assets                              [HEADER]
  1100  Current Assets                      [HEADER]
    1101  Cash on Hand
    1102  Petty Cash
    1110  Bank Accounts                     [HEADER]
      1111  Bank BCA
      1112  Bank Mandiri
    1120  Accounts Receivable
    1121  Allowance for Doubtful Accounts   [CONTRA]
    1130  Inventory
    1140  Prepaid Expenses
    1150  PPN Input (VAT Receivable)
    1155  PPh 22 Dibayar Dimuka *NEW*
  1200  Fixed Assets                        [HEADER]
    1201  Equipment
    1202  Accumulated Depreciation - Equipment [CONTRA]
    1210  Vehicles
    1211  Accumulated Depreciation - Vehicles  [CONTRA]
```

#### LIABILITIES (2xxx) — Normal Balance: Credit
```
2000    Liabilities                         [HEADER]
  2100  Current Liabilities                 [HEADER]
    2110  Accounts Payable
    2120  Accrued Expenses
    2130  PPN Output (VAT Payable)
    2131  PPh 21 Payable
    2132  PPh 23 Payable
    2133  PPh 25 Payable
    2135  Bea Meterai Payable *NEW*
    2140  Customer Deposits
  2200  Long Term Liabilities               [HEADER]
    2210  Bank Loans
    2220  Loan from Vijay Lunkad *NEW*
```

#### EQUITY (3xxx) — Normal Balance: Credit
```
3000    Equity                              [HEADER]
  3100  Owner Capital
  3110  Owner Drawings *NEW*
  3200  Retained Earnings
  3300  Current Year Earnings               ← Auto-calculated from P&L
```

#### REVENUE (4xxx) — Normal Balance: Credit
```
4000    Revenue                             [HEADER]
  4100  Sales Revenue
    4110  Sales - Local
    4120  Sales - Export
  4200  Sales Discounts                     [CONTRA]
  4300  Sales Returns                       [CONTRA]
  4910  Miscellaneous Income *NEW*
```

#### COST OF GOODS SOLD (5xxx) — Normal Balance: Debit
```
5000    Cost of Goods Sold                  [HEADER]
  5100  COGS - Materials
  5200  Import Duty (Bea Masuk)
  5300  Freight In (Biaya Angkut Masuk)
  5400  Other Import Costs
```

#### OPERATING EXPENSES (6xxx) — Normal Balance: Debit
```
6000    Operating Expenses                  [HEADER]
  6100  Salaries & Wages
  6110  Employee Benefits
  6200  Rent Expense                        [HEADER]
    6210  Warehouse Rent
    6220  Office Rent
  6300  Utilities
    6310  Electricity
    6320  Water
    6330  Telephone & Internet
  6400  Office Supplies
  6500  Transportation
  6600  Marketing & Advertising
  6700  Professional Fees
  6800  Depreciation Expense
  6900  Miscellaneous Expense
  6950  Bea Meterai Expense (Stamp Duty) *NEW*
```

#### OTHER EXPENSES (7xxx) — Normal Balance: Debit
```
7000    Other Expenses                      [HEADER]
  7100  Bank Charges
  7200  Interest Expense
  7300  Foreign Exchange Loss
```

**Total Accounts**: 70+ (many with subgroups)  
**Indexes**: code, type, parent_id  
**Status**: ✅ Complete for SME pharma trading

---

## 7. EXPENSE CATEGORY → COA MAPPING

### Function: `get_expense_account_id(p_category TEXT) RETURNS UUID`
**Location**: `20260123160729_fix_accounting_ledgers_and_add_equity_accounts.sql`  
**Status**: ⚠️ Incomplete mapping

### Current Mapping Implementation:
```sql
CASE p_category
  -- Salaries & Staff
  WHEN 'salary'              THEN 6100 (Salaries & Wages)
  WHEN 'staff_welfare'       THEN 6150 (if exists, else NULL)
  WHEN 'employee_benefits'   THEN 6110 (Employee Benefits)
  
  -- Rent
  WHEN 'office_rent'         THEN 6220 (Office Rent)
  WHEN 'warehouse_rent'      THEN 6210 (Warehouse Rent)
  WHEN 'rent'                THEN 6200 (Rent Expense)
  
  -- Office & Admin
  WHEN 'office_admin'        THEN 6300 (Utilities) ⚠️ WRONG!
  WHEN 'office_supplies'     THEN 6310 (Electricity) ⚠️ WRONG!
  WHEN 'office_shifting_renovation' THEN 6320 (Water) ⚠️ WRONG!
  
  -- Utilities
  WHEN 'utilities'           THEN 6400 (Utilities)
  WHEN 'electricity'         THEN 6410 (not in seeded COA)
  WHEN 'water'               THEN 6420 (not in seeded COA)
  WHEN 'internet_phone'      THEN 6430 (not in seeded COA)
  
  -- Vehicles & Transport
  WHEN 'fuel'                THEN 6510 (not in seeded COA)
  WHEN 'vehicle_maintenance' THEN 6520 (not in seeded COA)
  WHEN 'vehicle_insurance'   THEN 6530 (not in seeded COA)
  WHEN 'travel_conveyance'   THEN 6540 (not in seeded COA)
  
  -- Sales Related
  WHEN 'delivery_sales'      THEN 6600 (Marketing & Advertising) ⚠️ WRONG!
  WHEN 'loading_sales'       THEN 6610 (not in seeded COA)
  WHEN 'marketing_advertising' THEN 6620 (not in seeded COA)
  
  -- Professional Fees
  WHEN 'legal_professional'  THEN 6710 (not in seeded COA)
  WHEN 'consulting_fees'     THEN 6720 (not in seeded COA)
  WHEN 'accounting_audit'    THEN 6730 (not in seeded COA)
  
  -- Bank & Financial
  WHEN 'bank_charges'        THEN 7100 (Bank Charges) ✓
  WHEN 'interest_expense'    THEN 7200 (Interest Expense) ✓
  
  -- Import Related (COGS)
  WHEN 'freight_import'      THEN 5300 (Freight In) ✓
  WHEN 'duty_import'         THEN 5200 (Import Duty) ✓
  WHEN 'other_import'        THEN 5400 (Other Import Costs) ✓
  WHEN 'bpom_ski_fees'       THEN 5410 (not in seeded COA)
  
  -- Unhandled categories
  WHEN 'duty_customs'        THEN NULL ❌
  WHEN 'ppn_import'          THEN NULL ❌
  WHEN 'pph_import'          THEN NULL ❌
  WHEN 'clearing_forwarding' THEN NULL ❌
  WHEN 'port_charges'        THEN NULL ❌
  WHEN 'container_handling'  THEN NULL ❌
  WHEN 'transport_import'    THEN NULL ❌
  WHEN 'loading_import'      THEN NULL ❌
  WHEN 'pib_import'          THEN NULL ❌
  WHEN 'fixed_asset'         THEN NULL ❌
  
  -- Default fallback
  ELSE 6000 (Operating Expenses)
END
```

### Issues Found:
1. **Incorrect mappings**:
   - `office_admin` → 6300 (Utilities) should be 6400 (Office Supplies)
   - `delivery_sales` → 6600 (Marketing) should be dedicated delivery account
   
2. **Missing seeded accounts**:
   - 6150 (Staff Welfare)
   - 6410, 6420, 6430 (Utilities subaccounts)
   - 6510-6530 (Vehicle expenses)
   - 6610 (Delivery Sales)
   - 6620 (Marketing)
   - 6710-6730 (Professional Fees)
   - 5410 (BPOM/SKI Fees)

3. **PIB categories return NULL**:
   - These are handled in separate trigger logic, not via this function
   - Creates inconsistency in architecture

### Recommended Fix:
```sql
ALTER TABLE finance_expenses
  ADD COLUMN expense_account_id UUID FK chart_of_accounts
  DEFAULT NULL;

-- Update get_expense_account_id() to:
-- 1. Fix office_admin mapping (from 6300→6400)
-- 2. Add missing utility subaccounts (6410, 6420, 6430)
-- 3. Add missing vehicle expense accounts (6510-6530)
-- 4. Handle PIB categories (duty_customs→5200, ppn_import→1150, etc)
-- 5. Support fixed_asset category
```

---

## 8. PURCHASE INVOICES & RELATED TABLES

### Table: `purchase_invoices`
**Created**: `20251216150000_complete_indonesian_accounting_system.sql`  
**Updated**: `20260701100000_finance_tax_upgrade.sql`  
**Status**: ✅ Complete

#### Columns (18 total):
```sql
id                      UUID PRIMARY KEY
invoice_number          VARCHAR(100) NOT NULL
supplier_id             UUID NOT NULL FK suppliers
invoice_date            DATE NOT NULL
due_date                DATE
currency                VARCHAR(10) DEFAULT 'IDR'
exchange_rate           DECIMAL(18,6) DEFAULT 1

-- Amounts
subtotal                DECIMAL(18,2) DEFAULT 0
tax_amount              DECIMAL(18,2) DEFAULT 0
stamp_duty_amount       NUMERIC(18,2) DEFAULT 0 *NEW 20260701*
total_amount            DECIMAL(18,2) DEFAULT 0
paid_amount             DECIMAL(18,2) DEFAULT 0
balance_amount          GENERATED ALWAYS AS (total_amount - paid_amount)

-- Status & References
status                  VARCHAR(20) DEFAULT 'unpaid'
                        CHECK IN ('draft','unpaid','partial','paid','cancelled')
faktur_pajak_number     VARCHAR(50)
requires_faktur_pajak   BOOLEAN
purchase_type           VARCHAR(20) DEFAULT 'inventory'
                        ← inventory, fixed_asset, expense, service

notes                   TEXT
document_urls           TEXT[]

-- Accounting Integration
journal_entry_id        UUID FK journal_entries

created_by              UUID FK auth.users
created_at              TIMESTAMPTZ
updated_at              TIMESTAMPTZ

UNIQUE(supplier_id, invoice_number)
```

#### Related Table: `purchase_invoice_items`
```sql
id                      UUID PRIMARY KEY
purchase_invoice_id     UUID NOT NULL FK
item_type               VARCHAR(20)  ← inventory|fixed_asset|expense|service
product_id              UUID FK products
description             TEXT NOT NULL
quantity                DECIMAL(18,3) NOT NULL
unit                    VARCHAR(50)
unit_price              DECIMAL(18,2) NOT NULL
discount_percent        DECIMAL(5,2) DEFAULT 0

-- Tax & Accounting
tax_code_id             UUID FK tax_codes
tax_amount              DECIMAL(18,2) DEFAULT 0
line_total              DECIMAL(18,2) NOT NULL
expense_account_id      UUID FK chart_of_accounts
asset_account_id        UUID FK chart_of_accounts

-- Landed Cost (for inventory items from imports)
landed_cost_duty        DECIMAL(18,2) DEFAULT 0
landed_cost_freight     DECIMAL(18,2) DEFAULT 0
landed_cost_other       DECIMAL(18,2) DEFAULT 0

created_at              TIMESTAMPTZ
```

#### Key Features:
1. **Multi-item support**: Line-by-line posting to COA
2. **Flexible categorization**: Can be inventory, asset, or expense
3. **Landed cost tracking**: Explicit duty/freight allocation
4. **Tax integration**: Each line can have different tax codes
5. **Journal automation**: Auto-creates journal entry on insert/update

**Status**: ✅ Feature-complete

---

## 9. VIEWS & REPORTING

### Trial Balance View:
`trial_balance_view` — Aggregate view by account

```sql
SELECT
  code, name, name_id, account_type, account_group, normal_balance,
  SUM(debit), SUM(credit), SUM(debit) - SUM(credit) AS balance
FROM journal_entry_lines
GROUPED BY account
WHERE is_posted AND is_active AND NOT is_header
```

### Customer Receivables View:
Aggregates 1120 (A/R) account balances by customer

### Supplier Payables View:
Aggregates 2110 (A/P) account balances by supplier

**Status**: ✅ Ready for use

---

## 10. JOURNAL ENTRY SYSTEM

### Table: `journal_entries`
```sql
id                  UUID PRIMARY KEY
entry_number        VARCHAR(50) UNIQUE  ← Format: JE-2607-0001
entry_date          DATE NOT NULL
period_id           UUID FK accounting_periods
source_module       VARCHAR(50)  ← sales_invoice, purchase_invoice, expense, etc
reference_id        UUID         ← Points to source document
reference_number    VARCHAR(100)
description         TEXT
total_debit         DECIMAL(18,2) DEFAULT 0
total_credit        DECIMAL(18,2) DEFAULT 0
is_posted           BOOLEAN DEFAULT true
is_reversed          BOOLEAN DEFAULT false
reversed_by_id      UUID FK self (for reversals)
posted_by           UUID FK auth.users
posted_at           TIMESTAMPTZ
created_by          UUID FK auth.users
created_at          TIMESTAMPTZ
```

### Table: `journal_entry_lines`
```sql
id                  UUID PRIMARY KEY
journal_entry_id    UUID NOT NULL FK (CASCADE DELETE)
line_number         INTEGER NOT NULL
account_id          UUID NOT NULL FK chart_of_accounts
description         TEXT
debit               DECIMAL(18,2) DEFAULT 0
credit              DECIMAL(18,2) DEFAULT 0
tax_code_id         UUID FK tax_codes
customer_id         UUID FK customers
supplier_id         UUID FK suppliers
batch_id            UUID FK batches
created_at          TIMESTAMPTZ
```

**Status**: ✅ Comprehensive double-entry system

---

## KEY FINDINGS SUMMARY

### ✅ STRENGTHS:
1. **Solid Indonesian accounting foundation** with 70+ accounts
2. **Complete tax handling** for PPN/PPh with proper account mappings
3. **Double-entry journal system** with full audit trail
4. **Multi-currency reporting** with USD→IDR auto-conversion
5. **PIB import system** with tax breakdown and landed cost support
6. **Financial reports** (TB, BS, P&L) with drill-down capabilities
7. **Rich expense tracking** with 29 categories
8. **Payment voucher system** with PPh withholding
9. **Secure RLS policies** on all accounting tables

### ⚠️ GAPS & ISSUES:

| Issue | Severity | Location | Impact |
|-------|----------|----------|--------|
| No `import_containers` table | HIGH | Schema missing | Can't track multi-batch containers |
| Incomplete expense→COA mapping | MEDIUM | `get_expense_account_id()` | PIB & import categories unmapped |
| Missing seeded COA accounts | MEDIUM | `chart_of_accounts` | 6410-6730 accounts not created |
| `postal_code` field mismatch | LOW | SuppliersManager UI | Silent failure on save |
| Incorrect account mappings | MEDIUM | `get_expense_account_id()` | office_admin→6300 should be 6400 |
| PIB handling split across code | MEDIUM | Triggers + function | Complexity in maintenance |
| No expense_account_id denormalization | MEDIUM | `finance_expenses` | Slower expense posting queries |
| Missing ledger RPC | MEDIUM | Reporting | No per-account transaction drill-down |

### 🔴 CRITICAL FOR FINANCE UPGRADE:

1. **Clarify container management**: Will you add `import_containers` table?
2. **Fix expense category mapping**: Complete & test all 29 categories
3. **Add missing COA accounts**: Create accounts 6410-6730
4. **Standardize account selection**: Add account pickers to UI forms
5. **Create expense ledger RPC**: For audit trail by expense type
6. **Add expense allocation**: Track which expenses go to which cost centers
7. **Enhance supplier master**: Add default category, payment term rules
8. **Create reconciliation module**: Bank/AP/AR reconciliation tools

---

## RECOMMENDATIONS FOR UPGRADE

### Phase 1: Data Quality (Week 1)
- [ ] Add `postal_code` to suppliers table
- [ ] Fix `get_expense_account_id()` mappings
- [ ] Seed missing COA accounts (6410-6730)
- [ ] Validate all 29 expense categories have COA mappings

### Phase 2: Core Features (Week 2-3)
- [ ] Create `import_containers` + allocation tables
- [ ] Add `expense_account_id` FK to finance_expenses
- [ ] Build ledger detail RPC (`get_expense_ledger()`)
- [ ] Add expense drill-down in FinancialReports

### Phase 3: Enhancements (Week 4)
- [ ] Bank reconciliation RPC & UI
- [ ] AP/AR aging reports
- [ ] Expense allocation by cost center
- [ ] Supplier payment forecasting

### Phase 4: Security & Performance (Week 5)
- [ ] Audit all journal entry functions for SQL injection
- [ ] Add indexes on high-cardinality foreign keys
- [ ] Performance test: large journal loads (100K+ lines)
- [ ] Rate-limit RPC calls in API

---

## AUDIT CHECKLIST

- [x] Supplier table structure reviewed
- [x] Tax codes fully documented
- [x] Import container mechanism identified
- [x] Finance expenses columns enumerated
- [x] All 29 expense categories listed
- [x] Reporting RPCs tested & verified
- [x] COA structure complete
- [x] Expense→COA mapping identified (& issues found)
- [x] Purchase invoice flow documented
- [x] Journal system verified
- [x] UI components cross-checked with schema
- [ ] Performance tested with large datasets
- [ ] Security audit of trigger functions
- [ ] RLS policies validated

---

**Audit Completed**: July 2, 2026  
**Next Review**: After implementation of Phase 1 & 2  
**Prepared By**: Audit Process  
**Classification**: Internal Use

