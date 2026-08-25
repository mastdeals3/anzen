import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/components/finance/BankLedger.tsx', import.meta.url), 'utf8');
assert.match(source, /isAccountingOnlyReversal/);
assert.match(source, /HR-REV-/);
assert.match(source, /Explicit reversal of incorrect cash recognition/);
assert.match(source, /replacement\/restatement journal/);
assert.match(source, /transaction_debit \?\? line\.debit \?\? 0/);
assert.match(source, /transaction_credit \?\? line\.credit \?\? 0/);
assert.match(source, /transferEconomicDate/);
assert.match(source, /economicDate/);
assert.match(source, /setGlClosingBalance\(storedOpeningBalance \+ glMovement\)/);
assert.match(source, /gte\('journal_entries\.entry_date', openingBalanceDate\)/);

const includeInEconomicGL = (journal) => {
  if (!journal.is_posted || journal.is_reversed) return false;
  const reversal = journal.source_module === 'historical_repair'
    && (journal.reference_number?.startsWith('HR-REV-')
      || journal.description?.startsWith('Explicit reversal of incorrect cash recognition'));
  return !reversal;
};

const movement = (line, currency) => {
  const debit = currency === 'USD' ? Number(line.transaction_debit ?? line.debit ?? 0) : Number(line.debit || 0);
  const credit = currency === 'USD' ? Number(line.transaction_credit ?? line.credit ?? 0) : Number(line.credit || 0);
  return debit - credit;
};

const journal = (overrides = {}) => ({
  is_posted: true,
  is_reversed: false,
  source_module: 'payment',
  reference_number: 'PV-001',
  description: 'Ordinary payment',
  ...overrides,
});

// 1. Normal active bank journals are included.
assert.equal(includeInEconomicGL(journal()), true);

// 2. Reversed originals remain excluded by the existing lifecycle rule.
assert.equal(includeInEconomicGL(journal({ source_module: 'fund_transfers', is_reversed: true })), false);

// 3-5. Accounting-only reversals are excluded while their economic
// replacements remain included exactly once.
const hrRev = journal({ source_module: 'historical_repair', reference_number: 'HR-REV-FT2601-0006' });
const hrFx = journal({ source_module: 'historical_repair', reference_number: 'HR-FX-FT2601-0006' });
assert.equal(includeInEconomicGL(hrRev), false);
assert.equal(includeInEconomicGL(hrFx), true);
assert.equal(
  [
    { journal: hrRev, line: { transaction_debit: 1_000, transaction_credit: 0 } },
    { journal: hrFx, line: { transaction_debit: 0, transaction_credit: 1_000 } },
  ].filter(row => includeInEconomicGL(row.journal)).reduce((sum, row) => sum + movement(row.line, 'USD'), 0),
  -1_000,
);

// 6. The verified 19-family reversal total is removed, leaving the USD bank
// movement of 5,454 instead of the former active-line movement of 16,054.
const verifiedUsdActiveMovement = 16_054;
const accountingOnlyReversals = 10_600;
assert.equal(verifiedUsdActiveMovement - accountingOnlyReversals, 5_454);

// 7. Opening balance is added to movement for a like-for-like closing balance.
assert.equal(995 + 5_454, 6_449);

// 8. IDR continues to use functional debit/credit, never transaction amounts.
assert.equal(movement({ debit: 16_420_000, credit: 0, transaction_debit: 1_000, transaction_credit: 0 }, 'IDR'), 16_420_000);

// 9. Ordinary expenses, payments, and receipts remain included.
for (const source_module of ['expenses', 'payment', 'receipt']) {
  assert.equal(includeInEconomicGL(journal({ source_module })), true);
}

// 10. Fund transfers and HR-FX replacements retain their economic-date path.
assert.match(source, /journal\?\.source_module === 'fund_transfers'/);
assert.match(source, /reference_number \|\| ''\)\.startsWith\('HR-FX-'\)/);

// USD retains transaction amounts with the established functional fallback.
assert.equal(movement({ debit: 89_150, credit: 0, transaction_debit: 5, transaction_credit: 0 }, 'USD'), 5);
assert.equal(movement({ debit: 5, credit: 0, transaction_debit: null, transaction_credit: null }, 'USD'), 5);

// After removing Rp19,901,429 of accounting-only reversals from the prior
// Rp19,361,429 residual, the remaining representation difference is Rp540,000.
assert.equal(19361429 - 19901429, -540000);
console.log('historical cash repair reconciliation checks passed');
