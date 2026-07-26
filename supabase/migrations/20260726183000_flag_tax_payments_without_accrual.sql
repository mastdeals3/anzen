-- Final Finance stabilization: a tax payment journal that debits a tax payable
-- into a negative cumulative balance proves that the corresponding accrual is
-- absent from posted accounting. Do not invent the accrual; flag each payment
-- for an accountant-authorised accrual or reclassification decision.

WITH latest_run AS (
  SELECT run_id
  FROM public.finance_historical_repair_summary
  ORDER BY started_at DESC
  LIMIT 1
), control_movements AS (
  SELECT je.id AS journal_id, coa.code,
    jel.debit, jel.credit,
    SUM(jel.credit - jel.debit) OVER (
      PARTITION BY jel.account_id
      ORDER BY je.entry_date, je.created_at, je.id, jel.line_number, jel.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_payable
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.is_posted = true
    AND COALESCE(je.is_reversed, false) = false
    AND coa.code IN ('2130', '2131', '2132', '2133', '2137', '2138')
), candidates AS (
  SELECT tp.*, cm.code, cm.running_payable
  FROM public.tax_payments tp
  JOIN control_movements cm ON cm.journal_id = tp.journal_entry_id
  WHERE cm.debit > 0 AND cm.running_payable < 0
)
INSERT INTO public.finance_historical_repair_exceptions(
  run_id, document_type, document_id, document_number,
  inconsistent_fields, reason, manual_information_required, status
)
SELECT r.run_id, 'tax_payment', c.id,
  COALESCE(NULLIF(c.ntpn, ''), NULLIF(c.billing_code, ''),
    NULLIF(c.payment_reference, ''), 'Tax Payment ' || c.payment_date::text),
  ARRAY['tax_control_account_balance', 'accrual_journal'],
  format('Tax payment debits control account %s without an accrued payable; cumulative posted balance becomes %s', c.code, c.running_payable),
  'Identify and post the authorised original tax accrual, or formally reclassify the payment after review with the accountant/tax consultant; do not alter the payment amount or bank journal',
  'manual_review'
FROM latest_run r
CROSS JOIN candidates c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.finance_historical_repair_exceptions e
  WHERE e.run_id = r.run_id
    AND e.document_type = 'tax_payment'
    AND e.document_id = c.id
    AND e.status = 'manual_review'
    AND e.reason ILIKE '%without an accrued payable%'
);

UPDATE public.finance_historical_repair_runs r
SET records_manual_review = (
  SELECT count(DISTINCT (e.document_type, e.document_id))
  FROM public.finance_historical_repair_exceptions e
  WHERE e.run_id = r.id AND e.status = 'manual_review'
)
WHERE r.id = (
  SELECT run_id FROM public.finance_historical_repair_summary
  ORDER BY started_at DESC LIMIT 1
);
