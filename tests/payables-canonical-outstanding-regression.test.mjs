import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260830139000_use_canonical_supplier_ap_for_outstanding_expenses.sql', 'utf8');
const payablesManager = await readFile('src/components/finance/PayablesManager.tsx', 'utf8');

assert.match(migration, /JOIN public\.supplier_payables_view spv/);
assert.match(migration, /spv\.payable_balance > 0\.01/);
assert.match(migration, /JOIN public\.suppliers s ON s\.id = fe\.supplier_id/);
assert.match(migration, /eps\.effective_posting_state IN \('ACTIVE', 'REPLACED'\)/);
assert.match(migration, /coa\.code = '2110'/);
assert.match(migration, /jel\.supplier_id = fe\.supplier_id/);
assert.match(migration, /jel\.credit > jel\.debit/);
assert.match(migration, /calculate_finance_expense_payable\(fe\.id\) > COALESCE\(fe\.paid_amount, 0\) \+ 0\.01/);
assert.doesNotMatch(migration, /UPDATE public\.(?:finance_expenses|journal_entries|journal_entry_lines)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_outstanding_purchase_invoices/);
assert.match(migration, /je\.source_module IN \('purchase_invoice', 'purchase_invoices'\)/);
assert.match(payablesManager, /rpc\('get_outstanding_purchase_invoices'/);

console.log('canonical payables outstanding regression checks passed');
