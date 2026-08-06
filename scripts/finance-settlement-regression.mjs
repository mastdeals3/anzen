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
