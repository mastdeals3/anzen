import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Apply the pending command definition only within this transaction, exercise
// its existing Loan + journal triggers, and roll everything back. This proves
// that Bank Reconciliation uses the selected pre-existing Director Loan COA.
const migration = readFileSync(
  new URL('../supabase/migrations/20260810130000_require_director_master_loan_mapping.sql', import.meta.url),
  'utf8',
);

const sql = `
BEGIN;
${migration}

SELECT set_config('request.jwt.claim.sub',(
  SELECT id::text FROM public.user_profiles
  WHERE role IN ('admin','accounts') AND is_active=true
  ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1
),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

DO $audit$
DECLARE
  v_user uuid := auth.uid();
  v_bank uuid; v_bank_coa uuid; v_director_id uuid; v_director_name text; v_director_loan_coa uuid; v_upload uuid;
  v_receipt_line uuid; v_repayment_line uuid; v_loan jsonb; v_repayment jsonb;
  v_loan_id uuid; v_loan_je uuid; v_repayment_je uuid;
  v_debits numeric; v_credits numeric; v_count bigint;
BEGIN
  SELECT id, coa_id INTO v_bank, v_bank_coa
  FROM public.bank_accounts
  WHERE is_active=true AND upper(currency)='IDR' AND coa_id IS NOT NULL
  ORDER BY created_at,id LIMIT 1;
  SELECT d.id, d.full_name, d.loan_account_id INTO v_director_id, v_director_name, v_director_loan_coa
  FROM public.directors d
  JOIN public.chart_of_accounts coa ON coa.id=d.loan_account_id
  WHERE d.is_active=true AND COALESCE(d.is_deprecated,false)=false
    AND coa.is_active=true AND COALESCE(coa.is_header,false)=false
    AND lower(coa.account_type)='liability'
  ORDER BY d.full_name,d.id LIMIT 1;
  IF v_user IS NULL OR v_bank IS NULL OR v_bank_coa IS NULL OR v_director_id IS NULL OR v_director_loan_coa IS NULL THEN
    RAISE EXCEPTION 'Required existing finance fixtures are missing';
  END IF;

  INSERT INTO public.bank_statement_uploads(
    bank_account_id,statement_period,statement_start_date,statement_end_date,currency,uploaded_by,status
  ) VALUES(v_bank,'Rollback Director Loan reconciliation verification',current_date,current_date,'IDR',v_user,'completed')
  RETURNING id INTO v_upload;
  INSERT INTO public.bank_statement_lines(
    upload_id,bank_account_id,transaction_date,description,debit_amount,credit_amount,currency,created_by
  ) VALUES(v_upload,v_bank,current_date,'Rollback Director Loan receipt verification',0,20000000,'IDR',v_user)
  RETURNING id INTO v_receipt_line;

  v_loan := public.save_finance_loan(jsonb_build_object(
    'loan_date',current_date,'counterparty_name',v_director_name,'counterparty_type','person',
    'principal_amount',20000000,'bank_account_id',v_bank,'liability_kind','director_owner',
    'liability_account_id',v_director_loan_coa,'director_id',v_director_id,
    'transaction_currency','IDR','exchange_rate',1,
    'description','Rollback Director Loan receipt verification','created_by',v_user
  ),v_receipt_line);
  v_loan_id := (v_loan->>'id')::uuid;
  v_loan_je := (v_loan->>'journal_entry_id')::uuid;

  PERFORM 1 FROM public.loans WHERE id=v_loan_id AND coa_id=v_director_loan_coa
    AND bank_statement_line_id=v_receipt_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan did not retain selected existing Director Loan COA'; END IF;
  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_debits,v_credits
  FROM public.journal_entry_lines WHERE journal_entry_id=v_loan_je;
  IF v_debits<>20000000 OR v_credits<>20000000 THEN RAISE EXCEPTION 'Loan journal is unbalanced: debit %, credit %',v_debits,v_credits; END IF;
  PERFORM 1 FROM public.journal_entry_lines WHERE journal_entry_id=v_loan_je AND account_id=v_bank_coa AND debit=20000000 AND credit=0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan receipt did not debit the selected existing bank COA'; END IF;
  PERFORM 1 FROM public.journal_entry_lines WHERE journal_entry_id=v_loan_je AND account_id=v_director_loan_coa AND debit=0 AND credit=20000000;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan receipt did not credit the selected existing Director Loan COA'; END IF;
  PERFORM 1 FROM public.bank_statement_lines WHERE id=v_receipt_line AND matched_entry_id=v_loan_je AND reconciliation_status='recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan receipt was not recorded and linked to its journal'; END IF;

  INSERT INTO public.bank_statement_lines(
    upload_id,bank_account_id,transaction_date,description,debit_amount,credit_amount,currency,created_by
  ) VALUES(v_upload,v_bank,current_date,'Rollback Director Loan repayment verification',20000000,0,'IDR',v_user)
  RETURNING id INTO v_repayment_line;
  v_repayment := public.save_finance_loan_repayment(jsonb_build_object(
    'loan_id',v_loan_id,'transaction_date',current_date,'principal_amount',20000000,'interest_amount',0,
    'bank_account_id',v_bank,'transaction_currency','IDR','exchange_rate',1,
    'description','Rollback Director Loan repayment verification','created_by',v_user
  ),v_repayment_line);
  v_repayment_je := (v_repayment->>'journal_entry_id')::uuid;
  PERFORM 1 FROM public.journal_entry_lines WHERE journal_entry_id=v_repayment_je AND account_id=v_director_loan_coa AND debit=20000000 AND credit=0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan repayment did not debit the same selected Director Loan COA'; END IF;
  PERFORM 1 FROM public.journal_entry_lines WHERE journal_entry_id=v_repayment_je AND account_id=v_bank_coa AND debit=0 AND credit=20000000;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan repayment did not credit the selected existing bank COA'; END IF;
  PERFORM 1 FROM public.bank_statement_lines WHERE id=v_repayment_line AND matched_entry_id=v_repayment_je AND reconciliation_status='recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan repayment was not recorded and linked to its journal'; END IF;

  SELECT count(*) INTO v_count FROM public.journal_entry_lines
  WHERE account_id=v_director_loan_coa AND journal_entry_id IN (v_loan_je,v_repayment_je);
  IF v_count<>2 THEN RAISE EXCEPTION 'Director Loan account ledger is missing a verified transaction'; END IF;
  SELECT count(*) INTO v_count FROM public.get_trial_balance('2000-01-01',current_date,1);
  IF v_count=0 THEN RAISE EXCEPTION 'Trial Balance returned no rows'; END IF;
  PERFORM 1 FROM public.get_trial_balance('2000-01-01',current_date,1) HAVING abs(sum(total_debit)-sum(total_credit))<=0.01;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial Balance is not balanced'; END IF;
  PERFORM 1 FROM public.get_balance_sheet(current_date,1);
  IF NOT FOUND THEN RAISE EXCEPTION 'Balance Sheet returned no rows'; END IF;
END;
$audit$;
ROLLBACK;
`;

try {
  const stdout = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 100 * 1024 * 1024,
  });
  const response = JSON.parse(stdout.slice(stdout.indexOf('{')));
  if (response.error) throw new Error(response.error.message ?? JSON.stringify(response.error));
  console.log(JSON.stringify({
    status: 'passed', transaction: 'rolled_back', amount: 20000000,
    checks: ['selected_existing_director_loan_coa', 'loan_journal_balance', 'bank_receipt_debit',
      'director_loan_credit', 'reconciliation_link', 'director_loan_repayment', 'bank_repayment_credit',
      'account_ledger_lines', 'trial_balance', 'balance_sheet'],
  }, null, 2));
} catch (error) {
  if (error && typeof error === 'object' && 'stdout' in error && error.stdout) process.stderr.write(String(error.stdout));
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
