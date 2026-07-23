import { supabase } from '../../lib/supabase';

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
    line.matched_petty_cash_id ||
    line.matched_fund_transfer_id ||
    line.matched_tax_payment_id
  );
}

export async function loadUnmatchedDebitBankTransactions({
  bankAccountId,
  currentExpenseId,
  currentJournalEntryId,
  currentPettyCashId,
}: LoadUnmatchedDebitOptions): Promise<BankTransactionLine[]> {
  const { data, error } = await supabase
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
      matched_petty_cash_id,
      matched_fund_transfer_id,
      matched_tax_payment_id,
      bank_accounts(bank_name, account_name, account_number, alias, currency)
    `)
    .eq('bank_account_id', bankAccountId)
    .gt('debit_amount', 0)
    .order('transaction_date', { ascending: false });

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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('bank_statement_lines')
    .update({
      matched_expense_id: matchedExpenseId || null,
      matched_entry_id: matchedJournalEntryId || null,
      reconciliation_status: 'matched',
      payment_kind: paymentKind,
      matched_at: new Date().toISOString(),
      matched_by: user.id,
      manually_unlinked: false,
      notes: note || null,
    })
    .eq('id', bankStatementLineId);

  if (error) throw error;
}

export async function unlinkBankTransaction(bankStatementLineId: string): Promise<void> {
  const { error } = await supabase
    .from('bank_statement_lines')
    .update({
      matched_expense_id: null,
      matched_receipt_id: null,
      matched_fund_transfer_id: null,
      matched_entry_id: null,
      matched_petty_cash_id: null,
      matched_tax_payment_id: null,
      reconciliation_status: 'unmatched',
      matched_at: null,
      matched_by: null,
      notes: null,
      manually_unlinked: true,
      payment_kind: 'supplier',
    })
    .eq('id', bankStatementLineId);

  if (error) throw error;
}

export function notifyFinanceReconciliationRefresh(): void {
  window.dispatchEvent(new CustomEvent(FINANCE_RECONCILIATION_REFRESH_EVENT));
}
