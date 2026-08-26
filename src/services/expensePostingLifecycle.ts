import { supabase } from '../lib/supabase';

export type ExpensePostingState =
  | 'ACTIVE'
  | 'REVERSED'
  | 'REPLACED'
  | 'REJECTED'
  | 'PENDING'
  | 'AMBIGUOUS';

export interface EffectiveExpensePostingState {
  expense_id: string;
  voucher_number: string | null;
  document_approval_status: string;
  effective_posting_state: ExpensePostingState;
  effective_journal_id: string | null;
  effective_journal_number: string | null;
  effective_journal_date: string | null;
  active_journal_id: string | null;
  active_journal_number: string | null;
  original_journal_id: string | null;
  original_journal_number: string | null;
  reversal_journal_id: string | null;
  replacement_journal_id: string | null;
  replacement_journal_number: string | null;
  replacement_reference: string | null;
  replacement_source_module: string | null;
  active_original_count: number;
  reversed_original_count: number;
  active_replacement_count: number;
  ambiguity_reason: string | null;
}

const READ_BATCH_SIZE = 75;

export async function getEffectiveExpensePostingStates(
  expenseIds: Array<string | null | undefined>,
): Promise<Map<string, EffectiveExpensePostingState>> {
  const ids = [...new Set(expenseIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, EffectiveExpensePostingState>();

  for (let offset = 0; offset < ids.length; offset += READ_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + READ_BATCH_SIZE);
    const { data, error } = await supabase
      .from('effective_expense_posting_state')
      .select('*')
      .in('expense_id', batch);
    if (error) throw error;
    for (const row of (data || []) as EffectiveExpensePostingState[]) {
      result.set(row.expense_id, row);
    }
  }

  return result;
}

export async function getEffectiveExpensePostingState(
  expenseId: string,
): Promise<EffectiveExpensePostingState | null> {
  const states = await getEffectiveExpensePostingStates([expenseId]);
  return states.get(expenseId) || null;
}

export const isEffectiveExpensePosting = (state: ExpensePostingState | null | undefined): boolean =>
  state === 'ACTIVE' || state === 'REPLACED';
