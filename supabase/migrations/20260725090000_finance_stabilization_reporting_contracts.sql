/*
  Finance Stabilization Sprint — reporting contracts

  1. A single active-journal FX multiplier used by trial balance and balance sheet.
  2. A/R open items that include active receipts and approved credit notes.
  3. A/R and A/P control-account reconciliation, for subledger exception visibility.

  No Purchase Batch tables, triggers, or allocation workflow are changed.
*/

CREATE OR REPLACE FUNCTION public.get_journal_reporting_multiplier(
  p_journal_entry_id uuid,
  p_usd_rate numeric
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.journal_entries je
      LEFT JOIN public.purchase_invoices pi
        ON pi.id = je.reference_id AND je.source_module = 'purchase_invoice'
      LEFT JOIN public.payment_vouchers pv
        ON pv.id = je.reference_id AND je.source_module = 'payment'
      LEFT JOIN public.bank_accounts pv_ba ON pv_ba.id = pv.bank_account_id
      LEFT JOIN public.receipt_vouchers rv
        ON rv.id = je.reference_id AND je.source_module = 'receipt'
      LEFT JOIN public.bank_accounts rv_ba ON rv_ba.id = rv.bank_account_id
      LEFT JOIN public.fund_transfers ft
        ON ft.id = je.reference_id AND je.source_module IN ('fund_transfer', 'fund_transfers')
      LEFT JOIN public.bank_accounts ft_from_ba ON ft_from_ba.id = ft.from_bank_account_id
      LEFT JOIN public.bank_accounts ft_to_ba ON ft_to_ba.id = ft.to_bank_account_id
      LEFT JOIN public.bank_statement_lines bsl
        ON bsl.id = je.reference_id AND je.source_module = 'bank_reconciliation'
      LEFT JOIN public.bank_accounts bsl_ba ON bsl_ba.id = bsl.bank_account_id
      WHERE je.id = p_journal_entry_id
        AND (
          COALESCE(pi.currency, 'IDR') = 'USD'
          OR COALESCE(pv.payment_currency, pv_ba.currency, 'IDR') = 'USD'
          OR COALESCE(rv_ba.currency, 'IDR') = 'USD'
          OR COALESCE(ft_from_ba.currency, ft_to_ba.currency, 'IDR') = 'USD'
          OR COALESCE(bsl_ba.currency, 'IDR') = 'USD'
        )
    ) THEN COALESCE(NULLIF(p_usd_rate, 0), public.get_reporting_usd_rate())
    ELSE 1::numeric
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_trial_balance(
  p_start_date date,
  p_end_date date,
  p_usd_rate numeric DEFAULT 1
)
RETURNS TABLE(
  code varchar,
  name varchar,
  name_id varchar,
  account_type varchar,
  account_group varchar,
  normal_balance varchar,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN QUERY
  WITH active_lines AS (
    SELECT jel.account_id,
      jel.debit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS debit,
      jel.credit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS credit
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false
      AND je.entry_date BETWEEN p_start_date AND p_end_date
  )
  SELECT coa.code, coa.name, coa.name_id, coa.account_type, coa.account_group,
    COALESCE(coa.normal_balance,
      CASE WHEN coa.account_type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END),
    COALESCE(SUM(al.debit), 0)::numeric,
    COALESCE(SUM(al.credit), 0)::numeric,
    (COALESCE(SUM(al.debit), 0) - COALESCE(SUM(al.credit), 0))::numeric
  FROM public.chart_of_accounts coa
  LEFT JOIN active_lines al ON al.account_id = coa.id
  WHERE coa.is_header = false AND coa.is_active = true
  GROUP BY coa.id, coa.code, coa.name, coa.name_id, coa.account_type, coa.account_group, coa.normal_balance
  HAVING COALESCE(SUM(al.debit), 0) <> 0 OR COALESCE(SUM(al.credit), 0) <> 0
  ORDER BY coa.code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trial_balance(p_start_date date, p_end_date date)
RETURNS TABLE(
  code varchar, name varchar, name_id varchar, account_type varchar, account_group varchar,
  normal_balance varchar, total_debit numeric, total_credit numeric, balance numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT * FROM public.get_trial_balance(p_start_date, p_end_date, public.get_reporting_usd_rate());
$$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet(
  p_as_of_date date,
  p_usd_rate numeric DEFAULT 1
)
RETURNS TABLE(
  code varchar,
  name varchar,
  name_id varchar,
  account_type varchar,
  account_group varchar,
  normal_balance varchar,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE v_net_income numeric; v_has_3300 boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  WITH active_lines AS (
    SELECT jel.account_id,
      jel.debit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS debit,
      jel.credit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS credit
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false
      AND je.entry_date <= p_as_of_date
  )
  SELECT COALESCE(SUM(CASE
    WHEN coa.account_type = 'revenue' THEN al.credit - al.debit
    WHEN coa.account_type = 'expense' THEN al.debit - al.credit
    ELSE 0 END), 0)
  INTO v_net_income
  FROM active_lines al JOIN public.chart_of_accounts coa ON coa.id = al.account_id
  WHERE coa.is_header = false;

  SELECT EXISTS (
    SELECT 1 FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
    WHERE coa.code = '3300' AND je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false AND je.entry_date <= p_as_of_date
  ) INTO v_has_3300;

  RETURN QUERY
  WITH active_lines AS (
    SELECT jel.account_id,
      jel.debit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS debit,
      jel.credit * public.get_journal_reporting_multiplier(je.id, p_usd_rate) AS credit
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false
      AND je.entry_date <= p_as_of_date
  )
  SELECT coa.code, coa.name, coa.name_id, coa.account_type, coa.account_group,
    COALESCE(coa.normal_balance,
      CASE WHEN coa.account_type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END),
    COALESCE(SUM(al.debit), 0)::numeric,
    COALESCE(SUM(al.credit), 0)::numeric,
    (COALESCE(SUM(al.debit), 0) - COALESCE(SUM(al.credit), 0))::numeric
  FROM public.chart_of_accounts coa
  LEFT JOIN active_lines al ON al.account_id = coa.id
  WHERE coa.is_header = false AND coa.is_active = true
    AND coa.account_type IN ('asset', 'liability', 'equity', 'contra')
  GROUP BY coa.id, coa.code, coa.name, coa.name_id, coa.account_type, coa.account_group, coa.normal_balance
  HAVING COALESCE(SUM(al.debit), 0) <> 0 OR COALESCE(SUM(al.credit), 0) <> 0

  UNION ALL
  SELECT '3300'::varchar, 'Current Year Earnings'::varchar, 'Laba/Rugi Tahun Berjalan'::varchar,
    'equity'::varchar, 'Equity'::varchar, 'credit'::varchar,
    CASE WHEN v_net_income < 0 THEN ABS(v_net_income) ELSE 0 END,
    CASE WHEN v_net_income > 0 THEN v_net_income ELSE 0 END,
    (-v_net_income)::numeric
  WHERE NOT v_has_3300 AND ABS(v_net_income) > 0.005
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_as_of_date date)
RETURNS TABLE(
  code varchar, name varchar, name_id varchar, account_type varchar, account_group varchar,
  normal_balance varchar, total_debit numeric, total_credit numeric, balance numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT * FROM public.get_balance_sheet(p_as_of_date, public.get_reporting_usd_rate());
$$;

CREATE OR REPLACE FUNCTION public.get_customer_ar_open_items(p_as_of_date date DEFAULT current_date)
RETURNS TABLE(
  id uuid, customer_id uuid, customer_name text, customer_email text, customer_phone text,
  invoice_number text, invoice_date date, due_date date, total_amount numeric,
  paid_amount numeric, credit_note_amount numeric, balance_amount numeric, days_overdue integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  WITH invoices AS (
    SELECT si.id, si.customer_id, si.invoice_number, si.invoice_date, si.due_date, si.total_amount,
      c.company_name, c.email, c.phone
    FROM public.sales_invoices si
    JOIN public.customers c ON c.id = si.customer_id
    JOIN public.journal_entries je ON je.id = si.journal_entry_id
    WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false
      AND si.invoice_date <= p_as_of_date
  ), paid AS (
    SELECT va.sales_invoice_id, COALESCE(SUM(va.allocated_amount), 0) AS paid_amount
    FROM public.voucher_allocations va
    JOIN public.receipt_vouchers rv ON rv.id = va.receipt_voucher_id
    JOIN public.journal_entries je ON je.id = rv.journal_entry_id
    WHERE va.voucher_type = 'receipt' AND je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false AND rv.voucher_date <= p_as_of_date
    GROUP BY va.sales_invoice_id
  ), direct_credit AS (
    SELECT cn.original_invoice_id AS invoice_id, COALESCE(SUM(cn.total_amount), 0) AS amount
    FROM public.credit_notes cn
    JOIN public.journal_entries je ON je.id = cn.journal_entry_id
    WHERE cn.status = 'approved' AND cn.original_invoice_id IS NOT NULL
      AND cn.credit_note_date <= p_as_of_date AND je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false
    GROUP BY cn.original_invoice_id
  ), unallocated_credit AS (
    SELECT cn.customer_id, COALESCE(SUM(cn.total_amount), 0) AS amount
    FROM public.credit_notes cn
    JOIN public.journal_entries je ON je.id = cn.journal_entry_id
    WHERE cn.status = 'approved' AND cn.original_invoice_id IS NULL
      AND cn.credit_note_date <= p_as_of_date AND je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false
    GROUP BY cn.customer_id
  ), base AS (
    SELECT i.*, COALESCE(p.paid_amount, 0) AS paid_amount,
      LEAST(GREATEST(i.total_amount - COALESCE(p.paid_amount, 0), 0), COALESCE(dc.amount, 0)) AS direct_credit_amount,
      GREATEST(i.total_amount - COALESCE(p.paid_amount, 0) - COALESCE(dc.amount, 0), 0) AS open_after_direct,
      COALESCE(uc.amount, 0) AS unallocated_credit_amount
    FROM invoices i
    LEFT JOIN paid p ON p.sales_invoice_id = i.id
    LEFT JOIN direct_credit dc ON dc.invoice_id = i.id
    LEFT JOIN unallocated_credit uc ON uc.customer_id = i.customer_id
  ), apportioned AS (
    SELECT base.*,
      COALESCE(SUM(open_after_direct) OVER (
        PARTITION BY customer_id ORDER BY invoice_date, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS prior_open
    FROM base
  )
  SELECT id, customer_id, company_name, email, phone, invoice_number, invoice_date, due_date,
    total_amount, paid_amount,
    (direct_credit_amount + LEAST(open_after_direct, GREATEST(unallocated_credit_amount - prior_open, 0)))::numeric,
    GREATEST(open_after_direct - LEAST(open_after_direct, GREATEST(unallocated_credit_amount - prior_open, 0)), 0)::numeric,
    GREATEST((p_as_of_date - due_date), 0)::integer
  FROM apportioned
  WHERE GREATEST(open_after_direct - LEAST(open_after_direct, GREATEST(unallocated_credit_amount - prior_open, 0)), 0) > 0.005
  ORDER BY due_date NULLS LAST, invoice_date, invoice_number;
$$;

CREATE OR REPLACE FUNCTION public.get_control_account_reconciliation(p_as_of_date date DEFAULT current_date)
RETURNS TABLE(control_code text, control_name text, gl_balance numeric, subledger_balance numeric, difference numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE v_ar_gl numeric; v_ap_gl numeric; v_ar_sub numeric; v_ap_sub numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_ar_gl
  FROM public.journal_entry_lines jel JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code = '1120' AND je.is_posted = true AND COALESCE(je.is_reversed, false) = false AND je.entry_date <= p_as_of_date;

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO v_ap_gl
  FROM public.journal_entry_lines jel JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code = '2110' AND je.is_posted = true AND COALESCE(je.is_reversed, false) = false AND je.entry_date <= p_as_of_date;

  SELECT COALESCE(SUM(balance_amount), 0) INTO v_ar_sub FROM public.get_customer_ar_open_items(p_as_of_date);

  WITH pi AS (
    SELECT p.id, p.total_amount
    FROM public.purchase_invoices p JOIN public.journal_entries je ON je.id = p.journal_entry_id
    WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false AND p.invoice_date <= p_as_of_date
  ), pi_paid AS (
    SELECT va.purchase_invoice_id, SUM(va.allocated_amount) amount
    FROM public.voucher_allocations va JOIN public.payment_vouchers pv ON pv.id = va.payment_voucher_id
    JOIN public.journal_entries je ON je.id = pv.journal_entry_id
    WHERE va.voucher_type = 'payment' AND je.is_posted = true AND COALESCE(je.is_reversed, false) = false AND pv.voucher_date <= p_as_of_date
    GROUP BY va.purchase_invoice_id
  ), expense_bills AS (
    SELECT fe.id, fe.amount, fe.paid_amount
    FROM public.finance_expenses fe
    JOIN public.journal_entries je ON je.source_module = 'expenses' AND je.reference_id = fe.id
    WHERE fe.payment_method IS NULL AND fe.approval_status = 'approved' AND fe.expense_date <= p_as_of_date
      AND je.is_posted = true AND COALESCE(je.is_reversed, false) = false
  )
  SELECT COALESCE((SELECT SUM(pi.total_amount - COALESCE(pi_paid.amount, 0)) FROM pi LEFT JOIN pi_paid ON pi_paid.purchase_invoice_id = pi.id), 0)
       + COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM expense_bills), 0)
  INTO v_ap_sub;

  RETURN QUERY VALUES
    ('1120'::text, 'Accounts Receivable'::text, v_ar_gl, v_ar_sub, (v_ar_gl - v_ar_sub), CASE WHEN ABS(v_ar_gl - v_ar_sub) <= 0.01 THEN 'reconciled' ELSE 'difference' END),
    ('2110'::text, 'Accounts Payable'::text, v_ap_gl, v_ap_sub, (v_ap_gl - v_ap_sub), CASE WHEN ABS(v_ap_gl - v_ap_sub) <= 0.01 THEN 'reconciled' ELSE 'difference' END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_ar_open_items(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_control_account_reconciliation(date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_ar_open_items(date) FROM anon;
REVOKE ALL ON FUNCTION public.get_control_account_reconciliation(date) FROM anon;

CREATE OR REPLACE FUNCTION public.get_finance_dashboard_summary(p_start_date date, p_end_date date)
RETURNS TABLE(revenue numeric, expenses numeric, net_income numeric, accounts_receivable numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE v_revenue numeric; v_expenses numeric; v_ar numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN coa.account_type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.account_type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
  INTO v_revenue, v_expenses
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false
    AND je.entry_date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(SUM(balance_amount), 0) INTO v_ar FROM public.get_customer_ar_open_items(p_end_date);
  RETURN QUERY SELECT v_revenue, v_expenses, v_revenue - v_expenses, v_ar;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_finance_dashboard_summary(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_finance_dashboard_summary(date, date) FROM anon;

-- Keep the legacy P&L summary endpoint on the same active-journal and reporting
-- currency contract as the Trial Balance-derived P&L screen.
CREATE OR REPLACE FUNCTION public.get_pnl_summary(
  p_start_date date,
  p_end_date date,
  p_usd_rate numeric
)
RETURNS TABLE(total_revenue numeric, total_expenses numeric, net_income numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN coa.account_type = 'revenue'
      THEN (jel.credit - jel.debit) * public.get_journal_reporting_multiplier(je.id, p_usd_rate)
      ELSE 0 END), 0)::numeric AS total_revenue,
    COALESCE(SUM(CASE WHEN coa.account_type = 'expense'
      THEN (jel.debit - jel.credit) * public.get_journal_reporting_multiplier(je.id, p_usd_rate)
      ELSE 0 END), 0)::numeric AS total_expenses,
    (
      COALESCE(SUM(CASE WHEN coa.account_type = 'revenue'
        THEN (jel.credit - jel.debit) * public.get_journal_reporting_multiplier(je.id, p_usd_rate)
        ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN coa.account_type = 'expense'
        THEN (jel.debit - jel.credit) * public.get_journal_reporting_multiplier(je.id, p_usd_rate)
        ELSE 0 END), 0)
    )::numeric AS net_income
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true
    AND COALESCE(je.is_reversed, false) = false
    AND je.entry_date BETWEEN p_start_date AND p_end_date;
$$;

CREATE OR REPLACE FUNCTION public.get_pnl_summary(p_start_date date, p_end_date date)
RETURNS TABLE(total_revenue numeric, total_expenses numeric, net_income numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT * FROM public.get_pnl_summary(p_start_date, p_end_date, public.get_reporting_usd_rate());
$$;

GRANT EXECUTE ON FUNCTION public.get_pnl_summary(date, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pnl_summary(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_pnl_summary(date, date, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.get_pnl_summary(date, date) FROM anon;
