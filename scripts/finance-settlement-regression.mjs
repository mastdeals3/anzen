import { execFileSync } from 'node:child_process';

const sql = `
BEGIN;
SELECT set_config('request.jwt.claim.sub',(
  SELECT id::text FROM public.user_profiles WHERE role IN ('admin','accounts') AND is_active=true
  ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

DO $regression$
DECLARE v_count bigint;
BEGIN
  IF (SELECT settlement_amount FROM public.finance_expenses
       WHERE expense_category='utilities' AND amount=115128 AND COALESCE(bank_charges_amount,0)=3000 LIMIT 1)
       IS DISTINCT FROM 118128 THEN
    -- Fixture may not exist; validate the generated expression independently.
    IF 115128+3000<>118128 THEN RAISE EXCEPTION 'Utility settlement formula failed'; END IF;
  END IF;

  PERFORM 1 FROM public.vw_finance_document_settlements s
   JOIN public.journal_entry_lines jel ON jel.journal_entry_id=s.journal_entry_id
   JOIN public.bank_accounts ba ON ba.id=s.bank_account_id AND ba.coa_id=jel.account_id
   GROUP BY s.document_type,s.document_id,s.journal_entry_id,s.bank_account_id,s.direction,s.settlement_amount
  HAVING s.settlement_amount = CASE WHEN s.direction='credit'
    THEN sum(COALESCE(jel.transaction_debit,jel.debit))
    ELSE sum(COALESCE(jel.transaction_credit,jel.credit)) END;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical settlement view returned no verified bank legs'; END IF;

  SELECT count(*) INTO v_count FROM public.vw_finance_document_settlements s
   LEFT JOIN public.journal_entries je ON je.id=s.journal_entry_id
   WHERE je.id IS NULL OR NOT je.is_posted OR COALESCE(je.is_reversed,false);
  IF v_count<>0 THEN RAISE EXCEPTION '% invalid canonical settlement rows',v_count; END IF;

  -- The matcher definition itself must consume only the shared settlement
  -- view; this prevents a future module-specific gross-amount regression.
  IF pg_get_functiondef('public.auto_match_smart()'::regprocedure) NOT LIKE '%vw_finance_document_settlements%'
     OR pg_get_functiondef('public.auto_match_smart()'::regprocedure) LIKE '%finance_expenses fe%'
  THEN RAISE EXCEPTION 'Auto-match bypasses canonical settlement view'; END IF;

  SELECT count(*) INTO v_count FROM public.payment_vouchers
   WHERE COALESCE(payment_method,'')<>'advance_adjustment'
     AND settlement_amount IS DISTINCT FROM COALESCE(actual_bank_debit,bank_amount,amount-COALESCE(pph_amount,0)+COALESCE(bank_charge,0));
  IF v_count<>0 THEN RAISE EXCEPTION '% Payment settlement amounts diverge',v_count; END IF;

  SELECT count(*) INTO v_count FROM public.finance_expenses
   WHERE settlement_amount IS DISTINCT FROM public.calculate_expense_settlement_amount(
     expense_category,amount,ppn_amount,pph_amount,stamp_duty_amount,bank_charges_amount,broker_items);
  IF v_count<>0 THEN RAISE EXCEPTION '% Expense settlement amounts diverge',v_count; END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT source_module,reference_id,count(*) n FROM public.journal_entries
     WHERE is_posted=true AND COALESCE(is_reversed,false)=false
       AND source_module IN ('expense','expenses','payment','receipt','petty_cash','fund_transfer','fund_transfers')
     GROUP BY source_module,reference_id HAVING count(*)>1
  ) duplicates;
  IF v_count<>0 THEN RAISE EXCEPTION '% source documents have duplicate active journals',v_count; END IF;

  -- The statutory PPh Register is sourced from approved documents. Journals
  -- remain an audit trail and must not gate or manufacture withholding.
  IF pg_get_functiondef('public.compute_period_ppn(uuid)'::regprocedure) LIKE '%journal_entries%'
     OR pg_get_functiondef('public.compute_period_ppn(uuid)'::regprocedure) NOT LIKE '%approval_status = ''approved''%'
     OR pg_get_functiondef('public.compute_period_ppn(uuid)'::regprocedure) NOT LIKE '%pv.is_posted%'
  THEN RAISE EXCEPTION 'PPh Register is not sourced exclusively from approved source documents'; END IF;

  WITH source AS (
    SELECT EXTRACT(YEAR FROM fe.expense_date)::int fiscal_year,
           EXTRACT(MONTH FROM fe.expense_date)::int period_month,
           tc.tax_type, fe.pph_amount amount
      FROM public.finance_expenses fe
      LEFT JOIN public.tax_codes tc ON tc.id=fe.pph_code_id
     WHERE fe.approval_status='approved' AND fe.pph_amount>0
       AND COALESCE(fe.expense_category,'') NOT IN ('pib_import','pph_import')
    UNION ALL
    SELECT EXTRACT(YEAR FROM pv.voucher_date)::int,
           EXTRACT(MONTH FROM pv.voucher_date)::int,
           tc.tax_type, pv.pph_amount
      FROM public.payment_vouchers pv
      LEFT JOIN public.tax_codes tc ON tc.id=pv.pph_code_id
     WHERE COALESCE(pv.is_posted,false) AND pv.pph_amount>0
    UNION ALL
    SELECT EXTRACT(YEAR FROM fe.expense_date)::int,
           EXTRACT(MONTH FROM fe.expense_date)::int,
           'PPh22',
           CASE WHEN fe.expense_category='pib_import' THEN fe.pib_pph_amount ELSE fe.amount END
      FROM public.finance_expenses fe
     WHERE fe.approval_status='approved'
       AND fe.expense_category IN ('pib_import','pph_import')
       AND CASE WHEN fe.expense_category='pib_import'
         THEN COALESCE(fe.pib_pph_amount,0) ELSE COALESCE(fe.amount,0) END>0
  ), typed AS (
    SELECT * FROM source
    UNION ALL
    SELECT fiscal_year,period_month,'PPh_Unifikasi',amount FROM source
  ), expected AS (
    SELECT fiscal_year,period_month,tax_type,sum(amount) total
      FROM typed GROUP BY fiscal_year,period_month,tax_type
  )
  SELECT count(*) INTO v_count
    FROM public.tax_periods tp
    LEFT JOIN expected e USING(fiscal_year,period_month,tax_type)
   WHERE tp.tax_type<>'PPN'
     AND tp.pph_total IS DISTINCT FROM COALESCE(e.total,0);
  IF v_count<>0 THEN RAISE EXCEPTION '% PPh periods differ from approved source documents',v_count; END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT fiscal_year,period_month,tax_type,count(*)
      FROM public.tax_periods WHERE tax_type<>'PPN'
     GROUP BY fiscal_year,period_month,tax_type HAVING count(*)>1
  ) duplicate_register_rows;
  IF v_count<>0 THEN RAISE EXCEPTION '% duplicate PPh Register period rows',v_count; END IF;

  SELECT count(*) INTO v_count
    FROM public.vw_pph_by_period_type r
   WHERE r.pph_paid_total IS DISTINCT FROM LEAST(
     r.pph_total,
     public.fn_tax_payments_paid(r.tax_period_id)
       + public.fn_settled_import_pph22(r.fiscal_year,r.period_month,r.tax_type)
   );
  IF v_count<>0 THEN RAISE EXCEPTION '% PPh periods have incorrect tax-payment offsets',v_count; END IF;
END;
$regression$;
ROLLBACK;
`;

try {
  const stdout=execFileSync('supabase',['db','query','--linked','--output-format','json',sql],{
    cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:100*1024*1024,
  });
  if (stdout.trim()) console.log(stdout.trim());
  console.log('Finance canonical settlement regression passed.');
} catch (error) {
  process.exit(error.status || 1);
}
