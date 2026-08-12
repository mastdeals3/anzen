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
  reconciliation_status?: string | null;
  isLinked?: boolean;
  allocatedAmount?: number;
  remainingAmount?: number;
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
  includeLinked?: boolean;
}

interface LinkBankTransactionOptions {
  bankStatementLineId: string;
  matchedExpenseId?: string | null;
  matchedPaymentId?: string | null;
  matchedJournalEntryId?: string | null;
  note?: string | null;
  paymentKind?: 'supplier' | 'pph23';
  allocationAmount?: number;
}

export function isAvailableTransaction(line: BankTransactionLine) {
  const hasDirectDocumentLink = Boolean(
    line.matched_expense_id
    || line.matched_entry_id
    || line.matched_receipt_id
    || line.matched_payment_id
    || line.matched_petty_cash_id
    || line.matched_fund_transfer_id
    || line.matched_tax_payment_id
  );

  // Bank Reconciliation's linkage state is authoritative for legacy/direct
  // matches. Allocation rows only add support for genuinely partial lines;
  // they must not resurrect a line already marked matched/recorded.
  return Number(line.remainingAmount ?? 0) > 0.01
    && !hasDirectDocumentLink
    && !['matched', 'recorded'].includes((line.reconciliation_status || '').toLowerCase());
}

export async function loadUnmatchedDebitBankTransactions({
  bankAccountId,
  direction = 'debit',
  currentExpenseId,
  currentJournalEntryId,
  currentPettyCashId,
  includeLinked = false,
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
      reconciliation_status,
      bank_accounts(bank_name, account_name, account_number, alias, currency)
    `)
    .eq('bank_account_id', bankAccountId);
  if (direction === 'debit') query = query.gt('debit_amount', 0);
  else if (direction === 'credit') query = query.gt('credit_amount', 0);
  else query = query.or('debit_amount.gt.0,credit_amount.gt.0');
  const { data, error } = await query.order('transaction_date', { ascending: false });

  if (error) throw error;

  const lineIds = (data || []).map(line => line.id);
  const allocatedByLine = new Map<string, number>();
  if (lineIds.length > 0) {
    const { data: allocations, error: allocationError } = await supabase
      .from('bank_statement_allocations')
      .select('bank_statement_line_id, allocation_amount')
      .in('bank_statement_line_id', lineIds);
    if (allocationError) throw allocationError;
    for (const allocation of allocations || []) {
      allocatedByLine.set(
        allocation.bank_statement_line_id,
        (allocatedByLine.get(allocation.bank_statement_line_id) || 0) + Number(allocation.allocation_amount || 0),
      );
    }
  }

  return ((data || []) as unknown as BankTransactionLine[])
    .map((line) => {
      const total = Number(line.debit_amount || line.credit_amount || 0);
      const allocatedAmount = allocatedByLine.get(line.id) || 0;
      const enriched = { ...line, allocatedAmount, remainingAmount: Math.max(0, total - allocatedAmount) };
      return {
        ...enriched,
        isLinked: !isAvailableTransaction(enriched),
      };
    })
    .filter((line) => includeLinked || !line.isLinked);
}

export async function linkBankTransaction({
  bankStatementLineId,
  matchedExpenseId,
  matchedPaymentId,
  matchedJournalEntryId,
  note,
  paymentKind = 'supplier',
  allocationAmount,
}: LinkBankTransactionOptions): Promise<void> {
  if (!matchedExpenseId && !matchedPaymentId && !matchedJournalEntryId) {
    throw new Error('A bank transaction must be linked to a Finance document or journal entry.');
  }

  await linkBankStatementLine(
    bankStatementLineId,
    matchedExpenseId ? 'expense' : matchedPaymentId ? 'payment' : 'journal',
    (matchedExpenseId || matchedPaymentId || matchedJournalEntryId) as string,
    paymentKind,
    allocationAmount,
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
