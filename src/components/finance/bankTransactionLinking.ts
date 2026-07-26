import { supabase } from '../../lib/supabase';
import { linkBankStatementLine, unlinkBankStatementLine } from '../../services/financeCommands';

export const FINANCE_RECONCILIATION_REFRESH_EVENT = 'finance:reconciliation-refresh';

export interface BankTransactionLine {
  id: string;
  transaction_date: string;
  description: string | null;
  reference?: string | null;
  debit_amount: number;
  credit_amount: number;
  bank_account_id: string;
  matched_expense_id?: string | null;
  matched_entry_id?: string | null;
  matched_receipt_id?: string | null;
  matched_payment_id?: string | null;
  matched_petty_cash_id?: string | null;
  matched_fund_transfer_id?: string | null;
  matched_tax_payment_id?: string | null;
  bank_accounts?: {
    bank_name: string;
    account_name?: string | null;
    account_number?: string | null;
    alias?: string | null;
    currency?: string | null;
  } | null;
}

interface LoadUnmatchedDebitOptions {
  bankAccountId: string;
  direction?: 'debit' | 'credit' | 'both';
  currentExpenseId?: string | null;
  currentJournalEntryId?: string | null;
  currentPettyCashId?: string | null;
}

interface LinkBankTransactionOptions {
  bankStatementLineId: string;
  matchedExpenseId?: string | null;
  matchedJournalEntryId?: string | null;
  note?: string | null;
  paymentKind?: 'supplier' | 'pph23';
}

function isAvailableTransaction(
  line: BankTransactionLine,
  currentExpenseId?: string | null,
  currentJournalEntryId?: string | null,
  currentPettyCashId?: string | null,
) {
  const isCurrent =
    (!!currentExpenseId && line.matched_expense_id === currentExpenseId) ||
    (!!currentJournalEntryId && line.matched_entry_id === currentJournalEntryId) ||
    (!!currentPettyCashId && line.matched_petty_cash_id === currentPettyCashId);

  if (isCurrent) return true;

  return !(
    line.matched_expense_id ||
    line.matched_entry_id ||
    line.matched_receipt_id ||
    line.matched_payment_id ||
    line.matched_petty_cash_id ||
    line.matched_fund_transfer_id ||
    line.matched_tax_payment_id
  );
}

export async function loadUnmatchedDebitBankTransactions({
  bankAccountId,
  direction = 'debit',
  currentExpenseId,
  currentJournalEntryId,
  currentPettyCashId,
}: LoadUnmatchedDebitOptions): Promise<BankTransactionLine[]> {
  let query = supabase
    .from('bank_statement_lines')
    .select(`
      id,
      transaction_date,
      description,
      reference,
      debit_amount,
      credit_amount,
      bank_account_id,
      matched_expense_id,
      matched_entry_id,
      matched_receipt_id,
      matched_payment_id,
      matched_petty_cash_id,
      matched_fund_transfer_id,
      matched_tax_payment_id,
      bank_accounts(bank_name, account_name, account_number, alias, currency)
    `)
    .eq('bank_account_id', bankAccountId);
  if (direction === 'debit') query = query.gt('debit_amount', 0);
  else if (direction === 'credit') query = query.gt('credit_amount', 0);
  else query = query.or('debit_amount.gt.0,credit_amount.gt.0');
  const { data, error } = await query.order('transaction_date', { ascending: false });

  if (error) throw error;

  return ((data || []) as unknown as BankTransactionLine[]).filter((line) =>
    isAvailableTransaction(line, currentExpenseId, currentJournalEntryId, currentPettyCashId)
  );
}

export async function linkBankTransaction({
  bankStatementLineId,
  matchedExpenseId,
  matchedJournalEntryId,
  note,
  paymentKind = 'supplier',
}: LinkBankTransactionOptions): Promise<void> {
  if (!matchedExpenseId && !matchedJournalEntryId) {
    throw new Error('A bank transaction must be linked to an expense or journal entry.');
  }

  await linkBankStatementLine(
    bankStatementLineId,
    matchedExpenseId ? 'expense' : 'journal',
    (matchedExpenseId || matchedJournalEntryId) as string,
    paymentKind,
  );
  if (note) {
    const { error } = await supabase.from('bank_statement_lines').update({ notes: note }).eq('id', bankStatementLineId);
    if (error) throw error;
  }
}

export async function unlinkBankTransaction(bankStatementLineId: string): Promise<void> {
  await unlinkBankStatementLine(bankStatementLineId);
}

export function notifyFinanceReconciliationRefresh(): void {
  window.dispatchEvent(new CustomEvent(FINANCE_RECONCILIATION_REFRESH_EVENT));
}
