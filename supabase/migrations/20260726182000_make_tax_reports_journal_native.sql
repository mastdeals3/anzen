-- Final Finance stabilization: tax accounting amounts come from active posted
-- journal lines. Source documents, tax periods and Faktur Pajak remain the
-- operational/compliance metadata, but may not independently define GL tax.

CREATE OR REPLACE VIEW public.vw_input_ppn_report AS
WITH tax_lines AS (
  SELECT je.id AS journal_id, je.entry_date, je.source_module, je.reference_id,
    je.reference_number, je.description, je.created_at, je.total_debit,
    SUM(jel.debit - jel.credit) AS ppn_amount
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true
    AND COALESCE(je.is_reversed, false) = false
    AND coa.code = '1150'
  GROUP BY je.id
  HAVING SUM(jel.debit - jel.credit) > 0
)
SELECT
  date_trunc('month', t.entry_date::timestamptz) AS month,
  t.entry_date AS expense_date,
  CASE
    WHEN t.source_module = 'purchase_invoice' THEN 'Purchase Invoice'
    WHEN fe.expense_category = 'pib_import' THEN 'PIB Import'
    WHEN fe.expense_category = 'ppn_import' THEN 'PPN Import (Legacy)'
    ELSE 'Supplier Invoice'
  END::text AS document_type,
  COALESCE(pi.invoice_number, fe.invoice_number, fe.voucher_number,
    t.reference_number, t.journal_id::text)::varchar AS reference,
  COALESCE(s.company_name, '-')::varchar AS supplier,
  COALESCE(s.npwp, '-')::varchar AS supplier_npwp,
  GREATEST(t.total_debit - t.ppn_amount, 0)::numeric AS dpp_amount,
  t.ppn_amount::numeric AS ppn_amount,
  COALESCE(fe.description, pi.notes, t.description)::text AS description,
  t.created_at
FROM tax_lines t
LEFT JOIN public.finance_expenses fe
  ON t.source_module IN ('expense', 'expenses') AND fe.id = t.reference_id
LEFT JOIN public.purchase_invoices pi
  ON t.source_module = 'purchase_invoice' AND pi.id = t.reference_id
LEFT JOIN public.suppliers s ON s.id = COALESCE(fe.supplier_id, pi.supplier_id)
ORDER BY t.entry_date DESC;

CREATE OR REPLACE VIEW public.vw_output_ppn_report AS
WITH tax_lines AS (
  SELECT je.id AS journal_id, je.entry_date, je.source_module, je.reference_id,
    je.reference_number, je.description, je.created_at, je.total_credit,
    SUM(jel.credit - jel.debit) AS ppn_amount
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true
    AND COALESCE(je.is_reversed, false) = false
    AND coa.code = '2130'
  GROUP BY je.id
  HAVING SUM(jel.credit - jel.debit) > 0
)
SELECT
  date_trunc('month', t.entry_date::timestamptz) AS month,
  t.entry_date AS invoice_date,
  COALESCE(si.invoice_number, t.reference_number, t.journal_id::text)::text AS invoice_number,
  CASE WHEN t.source_module = 'correction' THEN 'Correction' ELSE 'Sales Invoice' END::text AS document_type,
  COALESCE(c.company_name, '-')::text AS customer,
  COALESCE(c.npwp, '-')::text AS customer_npwp,
  GREATEST(t.total_credit - t.ppn_amount, 0)::numeric AS subtotal,
  t.ppn_amount::numeric AS ppn_amount,
  t.total_credit::numeric AS total_amount,
  si.payment_status::text,
  t.created_at
FROM tax_lines t
LEFT JOIN public.sales_invoices si ON si.id = t.reference_id
LEFT JOIN public.customers c ON c.id = si.customer_id;

CREATE OR REPLACE VIEW public.vw_ppn_net_by_period AS
SELECT
  tp.id AS tax_period_id,
  tp.fiscal_year,
  tp.period_month,
  tp.period_start,
  tp.period_end,
  tp.status,
  tp.filing_status,
  COALESCE(j.input_ppn, 0)::numeric(18,2) AS input_ppn_total,
  COALESCE(j.output_ppn, 0)::numeric(18,2) AS output_ppn_total,
  tp.carry_forward_in,
  GREATEST(COALESCE(j.output_ppn, 0) - COALESCE(j.input_ppn, 0) - tp.carry_forward_in, 0)::numeric(18,2) AS net_ppn_payable,
  GREATEST(COALESCE(j.input_ppn, 0) + tp.carry_forward_in - COALESCE(j.output_ppn, 0), 0)::numeric(18,2) AS carry_forward_out,
  tp.payment_due_date,
  tp.filing_due_date
FROM public.tax_periods tp
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN coa.code = '1150' THEN jel.debit - jel.credit ELSE 0 END) AS input_ppn,
    SUM(CASE WHEN coa.code = '2130' THEN jel.credit - jel.debit ELSE 0 END) AS output_ppn
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true
    AND COALESCE(je.is_reversed, false) = false
    AND je.entry_date BETWEEN tp.period_start AND tp.period_end
    AND coa.code IN ('1150', '2130')
) j ON true
WHERE tp.tax_type = 'PPN';

CREATE OR REPLACE VIEW public.vw_pph_by_period_type AS
WITH journal_tax AS (
  SELECT tp.id AS tax_period_id,
    COALESCE(j.accrued, 0)::numeric(18,2) AS accrued,
    COALESCE(j.cleared, 0)::numeric AS cleared
  FROM public.tax_periods tp
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN coa.code = '1155' THEN jel.debit ELSE jel.credit END) AS accrued,
      SUM(CASE WHEN coa.code = '1155' THEN jel.credit ELSE jel.debit END) AS cleared
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.is_posted = true
      AND COALESCE(je.is_reversed, false) = false
      AND je.entry_date BETWEEN tp.period_start AND tp.period_end
      AND coa.code::text = ANY(CASE tp.tax_type
        WHEN 'PPh21' THEN ARRAY['2131']::text[]
        WHEN 'PPh22' THEN ARRAY['1155']::text[]
        WHEN 'PPh23' THEN ARRAY['2132']::text[]
        WHEN 'PPh4(2)' THEN ARRAY['2138']::text[]
        WHEN 'PPh_Unifikasi' THEN ARRAY['2131','1155','2132','2138']::text[]
        ELSE ARRAY[]::text[] END)
  ) j ON true
  WHERE tp.tax_type <> 'PPN'
)
SELECT tp.id AS tax_period_id, tp.fiscal_year, tp.period_month, tp.tax_type,
  jt.accrued AS pph_total,
  jt.cleared AS pph_paid_total,
  GREATEST(jt.accrued - jt.cleared, 0)::numeric AS pph_outstanding,
  tp.status, tp.payment_due_date, tp.filing_due_date,
  public.fn_period_payment_status(tp.status,
    GREATEST(jt.accrued - jt.cleared, 0), tp.payment_due_date) AS payment_status,
  'Posted journals'::text AS payment_source
FROM public.tax_periods tp
JOIN journal_tax jt ON jt.tax_period_id = tp.id
WHERE tp.tax_type <> 'PPN';

CREATE OR REPLACE VIEW public.vw_outstanding_tax AS
SELECT p.tax_period_id, p.fiscal_year, p.period_month, 'PPN'::text AS tax_type,
  p.status, p.payment_due_date,
  GREATEST(p.net_ppn_payable - COALESCE(pay.paid, 0), 0)::numeric AS outstanding_amount
FROM public.vw_ppn_net_by_period p
LEFT JOIN LATERAL (
  SELECT SUM(jel.debit)::numeric AS paid
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '2130'
  WHERE je.is_posted = true AND COALESCE(je.is_reversed, false) = false
    AND je.source_module = 'tax_payment'
    AND je.entry_date BETWEEN p.period_start AND p.period_end
) pay ON true
WHERE p.status NOT IN ('paid', 'closed')
UNION ALL
SELECT tax_period_id, fiscal_year, period_month, tax_type, status,
  payment_due_date, pph_outstanding
FROM public.vw_pph_by_period_type
WHERE status NOT IN ('paid', 'closed');

CREATE OR REPLACE VIEW public.vw_tax_period_status AS
SELECT tp.id, tp.fiscal_year, tp.period_month, tp.tax_type, tp.status,
  tp.filing_status, tp.payment_due_date, tp.filing_due_date,
  COALESCE(ppn.net_ppn_payable, 0)::numeric(18,2) AS net_ppn,
  COALESCE(pph.pph_total, 0)::numeric(18,2) AS pph_total,
  (SELECT count(*) FROM public.tax_payments pay
    WHERE pay.tax_period_id = tp.id AND pay.status = 'reconciled') AS reconciled_payments_count,
  (SELECT count(*) FROM public.tax_payments pay
    WHERE pay.tax_period_id = tp.id AND pay.status IN ('draft', 'posted')) AS unreconciled_payments_count,
  (SELECT count(*) FROM public.sales_invoices si
    WHERE si.tax_period_id = tp.id
      AND NULLIF(trim(si.faktur_pajak_number), '') IS NULL
      AND si.tax_amount > 0) AS missing_faktur_count,
  CASE WHEN tp.tax_type = 'PPN'
    THEN GREATEST(COALESCE(ppn.net_ppn_payable, 0) - COALESCE(ot.outstanding_amount, 0), 0)
    ELSE COALESCE(pph.pph_paid_total, 0)
  END::numeric AS paid_amount,
  COALESCE(ot.outstanding_amount, 0)::numeric AS outstanding_amount,
  public.fn_period_payment_status(tp.status,
    COALESCE(ot.outstanding_amount, 0), tp.payment_due_date) AS payment_status,
  'Posted journals'::text AS payment_source
FROM public.tax_periods tp
LEFT JOIN public.vw_ppn_net_by_period ppn ON ppn.tax_period_id = tp.id
LEFT JOIN public.vw_pph_by_period_type pph ON pph.tax_period_id = tp.id
LEFT JOIN public.vw_outstanding_tax ot ON ot.tax_period_id = tp.id;

CREATE OR REPLACE VIEW public.vw_monthly_tax_summary AS
WITH months AS (
  SELECT fiscal_year, period_month,
    MAX(input_ppn_total) AS input_ppn,
    MAX(output_ppn_total) AS output_ppn,
    MAX(net_ppn_payable) AS net_ppn_payable,
    MAX(carry_forward_in) AS carry_forward_in,
    MAX(carry_forward_out) AS carry_forward_out
  FROM public.vw_ppn_net_by_period
  GROUP BY fiscal_year, period_month
), pph AS (
  SELECT fiscal_year, period_month, SUM(pph_total) AS pph_total
  FROM public.vw_pph_by_period_type
  WHERE tax_type <> 'PPh_Unifikasi'
  GROUP BY fiscal_year, period_month
)
SELECT to_char(make_date(m.fiscal_year, m.period_month, 1), 'YYYY-MM') AS month,
  m.fiscal_year, m.period_month, m.input_ppn, m.output_ppn,
  m.net_ppn_payable, m.carry_forward_in, m.carry_forward_out,
  COALESCE(p.pph_total, 0)::numeric AS pph_total
FROM months m
LEFT JOIN pph p USING (fiscal_year, period_month)
ORDER BY m.fiscal_year DESC, m.period_month DESC;

COMMENT ON VIEW public.vw_input_ppn_report IS 'Input PPN accounting amounts from active posted account 1150 journal lines; source documents provide descriptive metadata only.';
COMMENT ON VIEW public.vw_output_ppn_report IS 'Output PPN accounting amounts from active posted account 2130 journal lines; source documents provide descriptive metadata only.';
COMMENT ON VIEW public.vw_ppn_net_by_period IS 'PPN period totals derived from active posted tax-control journal lines.';
COMMENT ON VIEW public.vw_pph_by_period_type IS 'PPh period totals derived from active posted PPh control-account journal lines.';
