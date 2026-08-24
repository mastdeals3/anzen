-- Keep bank reconciliation_status derived from actual typed links/allocations.
-- This migration intentionally does not mutate existing production rows.
-- The trigger causes future link/unlink changes to normalize stale status values.

DROP TRIGGER IF EXISTS z_bsl_sync_reconciliation_status ON public.bank_statement_lines;

CREATE TRIGGER z_bsl_sync_reconciliation_status
BEFORE UPDATE OF matched_expense_id,
  matched_receipt_id,
  matched_petty_cash_id,
  matched_fund_transfer_id,
  matched_entry_id,
  matched_tax_payment_id,
  reconciliation_status
ON public.bank_statement_lines
FOR EACH ROW
EXECUTE FUNCTION public.bsl_sync_reconciliation_status();
