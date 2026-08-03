import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const expected = new Map([
  ['duty_customs', '1130'],
  ['ppn_import', '1150'],
  ['pph_import', '1155'],
  ['freight_import', '5300'],
  ['clearing_forwarding', '5300'],
  ['port_charges', '5300'],
  ['container_handling', '5300'],
  ['transport_import', '5300'],
  ['loading_import', '5300'],
  ['bpom_ski_fees', '5410'],
  ['other_import', '5400'],
  ['delivery_sales', '6510'],
  ['loading_sales', '6520'],
  ['other_sales', '6510'],
  ['salary', '6100'],
  ['staff_overtime', '6100'],
  ['staff_welfare', '6150'],
  ['non_permanent_employee_fee', '6100'],
  ['travel_conveyance', '6500'],
  ['staff_advance', '1160'],
  ['warehouse_rent', '6210'],
  ['utilities', '6300'],
  ['bank_charges', '7100'],
  ['office_admin', '6410'],
  ['office_shifting_renovation', '6420'],
  ['other', '6900'],
  ['import_broker', '5300'],
  ['professional_services', '6700'],
]);

const categorySource = readFileSync(
  new URL('../src/components/finance/expenseCategories.ts', import.meta.url),
  'utf8',
);
const exposed = [...categorySource.matchAll(/\{ value: '([^']+)'/g)].map((match) => match[1]);
const dedicated = new Set(['pib_import', 'fixed_asset']);
const audited = new Set([...expected.keys(), ...dedicated]);
const missing = exposed.filter((category) => !audited.has(category));
const stale = [...audited].filter((category) => !exposed.includes(category));
if (missing.length || stale.length) {
  throw new Error(`Expense category audit list drifted: missing=${missing.join(',')} stale=${stale.join(',')}`);
}
if (!categorySource.includes('Professional Fees — EXPENSED to P&L (COA 6700)') &&
    !categorySource.includes('professional fees — EXPENSED to P&L (COA 6700)')) {
  throw new Error('Professional Services help text does not reference COA 6700');
}

const valueRows = [...expected.entries()]
  .map(([category, code]) => `('${category}','${code}')`)
  .join(',');
const sql = `
WITH expected(category, expected_code) AS (VALUES ${valueRows})
SELECT e.category, e.expected_code, coa.code AS actual_code, coa.name, coa.account_type,
       coa.is_header, coa.is_active
  FROM expected e
  LEFT JOIN public.chart_of_accounts coa
    ON coa.id=public.get_expense_account_id(e.category)
 ORDER BY e.category;
`;

const stdout = execFileSync(
  'supabase',
  ['db', 'query', '--linked', '--output-format', 'json', sql],
  { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 20 * 1024 * 1024 },
);
const response = JSON.parse(stdout.slice(stdout.indexOf('{')));
if (response.error) throw new Error(response.error.message ?? JSON.stringify(response.error));
const errors = response.rows.filter((row) =>
  row.actual_code !== row.expected_code || row.is_header || !row.is_active,
);
if (errors.length) throw new Error(`Expense mapping errors: ${JSON.stringify(errors)}`);

const invalidTypes = response.rows.filter((row) => {
  if (['1130', '1150', '1155', '1160'].includes(row.actual_code)) return row.account_type !== 'asset';
  return row.account_type !== 'expense';
});
if (invalidTypes.length) throw new Error(`Expense mapping account-type errors: ${JSON.stringify(invalidTypes)}`);

console.log(JSON.stringify({
  status: 'passed',
  exposedCategories: exposed.length,
  canonicalMappings: response.rows.length,
  dedicatedPostingPaths: {
    pib_import: '1130 Inventory + 1150 Input PPN + 1155 Prepaid PPh22',
    fixed_asset: 'selected active leaf Fixed Asset COA + 1150 Input PPN',
  },
}, null, 2));
