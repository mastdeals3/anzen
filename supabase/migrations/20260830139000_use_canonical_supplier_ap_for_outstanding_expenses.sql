-- Outstanding AP is a supplier subledger report.  An effective expense can
-- be paid directly by cash/bank or represent staff/legacy activity; an AP
-- line alone does not make it a current supplier liability.
--
-- Reuse supplier_payables_view (the canonical supplier AP control/subledger
-- resolver) and require the expense's effective journal to contain its own
-- supplier-tagged AP credit.  This is a read-path change only.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_outstanding_expense_bills(
  p_as_of_date date DEFAULT current_date
)
RETURNS TABLE(
  id uuid, supplier_id uuid, supplier_name text, staff_id uuid, staff_name text,
  invoice_number text, invoice_date date, due_date date, expense_category text,
  description text, amount numeric, paid_amount numeric, balance_amount numeric,
  days_overdue integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT fe.id, fe.supplier_id, s.company_name::text, fe.staff_id,
    sm.full_name::text, fe.invoice_number::text, fe.expense_date, fe.due_date,
    fe.expense_category::text, fe.description::text,
    public.calculate_finance_expense_payable(fe.id), COALESCE(fe.paid_amount, 0),
    public.calculate_finance_expense_payable(fe.id) - COALESCE(fe.paid_amount, 0),
    CASE WHEN fe.due_date IS NOT NULL AND fe.due_date < p_as_of_date
      THEN (p_as_of_date - fe.due_date)::integer ELSE 0 END
  FROM public.finance_expenses fe
  JOIN public.effective_expense_posting_state eps
    ON eps.expense_id = fe.id
   AND eps.effective_posting_state IN ('ACTIVE', 'REPLACED')
  JOIN public.suppliers s ON s.id = fe.supplier_id
  JOIN public.supplier_payables_view spv
    ON spv.supplier_id = fe.supplier_id
   AND spv.payable_balance > 0.01
  LEFT JOIN public.finance_staff_master sm ON sm.id = fe.staff_id
  WHERE fe.expense_date <= p_as_of_date
    AND public.calculate_finance_expense_payable(fe.id) > COALESCE(fe.paid_amount, 0) + 0.01
    AND EXISTS (
      SELECT 1
      FROM public.journal_entry_lines jel
      JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
      WHERE jel.journal_entry_id = eps.effective_journal_id
        AND coa.code = '2110'
        AND jel.supplier_id = fe.supplier_id
        AND jel.credit > jel.debit
    )
  ORDER BY COALESCE(fe.due_date, fe.expense_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_outstanding_expense_bills(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outstanding_expense_bills(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_outstanding_purchase_invoices(
  p_as_of_date date DEFAULT current_date
)
RETURNS TABLE(
  id uuid, invoice_number text, invoice_date date, due_date date,
  total_amount numeric, paid_amount numeric, balance_amount numeric,
  currency text, supplier_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  SELECT pi.id, pi.invoice_number::text, pi.invoice_date, pi.due_date,
    pi.total_amount, pi.paid_amount, pi.balance_amount, pi.currency::text,
    s.company_name::text
  FROM public.purchase_invoices pi
  JOIN public.suppliers s ON s.id = pi.supplier_id
  JOIN public.supplier_payables_view spv
    ON spv.supplier_id = pi.supplier_id
   AND spv.payable_balance > 0.01
  WHERE pi.status IN ('pending', 'partial')
    AND pi.balance_amount > 0.01
    AND pi.invoice_date <= p_as_of_date
    AND EXISTS (
      SELECT 1
      FROM public.journal_entries je
      JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.source_module IN ('purchase_invoice', 'purchase_invoices')
        AND (je.reference_id = pi.id OR je.reference_number = pi.invoice_number)
        AND je.is_posted
        AND NOT COALESCE(je.is_reversed, false)
        AND coa.code = '2110'
        AND jel.supplier_id = pi.supplier_id
        AND jel.credit > jel.debit
    )
  ORDER BY pi.due_date, pi.invoice_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_outstanding_purchase_invoices(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outstanding_purchase_invoices(date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
