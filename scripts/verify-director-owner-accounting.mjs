import { execFileSync } from 'node:child_process';

// Read-only production audit. It deliberately does not repair historical rows;
// the companion rollback test exercises new receipt/repayment posting safely.
const sql = `
WITH active_directors AS (
  SELECT d.id, d.full_name, d.loan_account_id, coa.code, coa.name AS coa_name
  FROM public.directors d
  LEFT JOIN public.chart_of_accounts coa ON coa.id = d.loan_account_id
  WHERE d.is_active = true AND COALESCE(d.is_deprecated, false) = false
), mapping_counts AS (
  SELECT loan_account_id, count(*) AS mappings FROM active_directors WHERE loan_account_id IS NOT NULL GROUP BY loan_account_id
), mapping_issues AS (
  SELECT
    count(*) FILTER (WHERE loan_account_id IS NULL OR code IS NULL OR coa_name IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.id=loan_account_id AND c.is_active=true AND COALESCE(c.is_header,false)=false AND lower(c.account_type)='liability')) AS broken,
    COALESCE((SELECT sum(mappings-1) FROM mapping_counts WHERE mappings > 1),0) AS duplicate
  FROM active_directors
), report AS (
  SELECT ad.id, ad.full_name AS director, ad.code || ' — ' || ad.coa_name AS coa,
    COALESCE(lr.amount,0) AS loan_received,
    COALESCE(rp.amount,0) AS repayments,
    COALESCE(ot.amount,0) AS other_applicable,
    COALESCE(bal.balance,0) AS current_balance,
    (COALESCE(lr.bad,0)+COALESCE(rp.bad,0)=0) AS journal_coa_match,
    (COALESCE(lr.bank_bad,0)+COALESCE(rp.bank_bad,0)=0) AS bank_reconciliation_match
  FROM active_directors ad
  LEFT JOIN LATERAL (
    SELECT sum(l.principal_amount) amount,
      count(*) FILTER (WHERE l.journal_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines jl WHERE jl.journal_entry_id=l.journal_entry_id AND jl.account_id=ad.loan_account_id AND jl.credit > 0)) bad,
      count(*) FILTER (WHERE l.bank_statement_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_statement_lines b WHERE b.id=l.bank_statement_line_id AND b.matched_entry_id=l.journal_entry_id AND b.credit_amount=l.principal_amount)) bank_bad
    FROM public.loans l WHERE l.coa_id=ad.loan_account_id AND l.loan_type='taken'
  ) lr ON true
  LEFT JOIN LATERAL (
    SELECT sum(lt.principal_amount) amount,
      count(*) FILTER (WHERE lt.journal_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.journal_entry_lines jl WHERE jl.journal_entry_id=lt.journal_entry_id AND jl.account_id=ad.loan_account_id AND jl.debit > 0)) bad,
      count(*) FILTER (WHERE lt.bank_statement_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_statement_lines b WHERE b.id=lt.bank_statement_line_id AND b.matched_entry_id=lt.journal_entry_id AND b.debit_amount=lt.amount)) bank_bad
    FROM public.loan_transactions lt JOIN public.loans l ON l.id=lt.loan_id
    WHERE l.coa_id=ad.loan_account_id AND l.loan_type='taken'
  ) rp ON true
  LEFT JOIN LATERAL (
    SELECT sum(jl.debit-jl.credit) amount FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
    WHERE jl.account_id=ad.loan_account_id AND je.source_module NOT IN ('loans','loan_transactions')
  ) ot ON true
  LEFT JOIN LATERAL (
    SELECT sum(jl.debit-jl.credit) balance FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id WHERE jl.account_id=ad.loan_account_id AND je.is_posted=true
  ) bal ON true
)
SELECT jsonb_build_object(
  'directors', COALESCE((SELECT jsonb_agg(report ORDER BY director) FROM report), '[]'::jsonb),
  'mapping_issues', (SELECT row_to_json(mapping_issues) FROM mapping_issues),
  'historical', jsonb_build_object(
    'unmapped_director_ledgers', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'journal_lines',(SELECT count(*) FROM public.journal_entry_lines jl WHERE jl.account_id=c.id)) ORDER BY c.code)
      FROM public.chart_of_accounts c
      WHERE c.is_active=true AND COALESCE(c.is_header,false)=false AND lower(c.account_type)='liability'
        AND c.name ~* 'director[[:space:]]+loan'
        AND NOT EXISTS (SELECT 1 FROM active_directors ad WHERE ad.loan_account_id=c.id)), '[]'::jsonb),
    'missing_journal', (SELECT count(*) FROM public.loans l WHERE l.coa_id IS NOT NULL AND l.journal_entry_id IS NULL),
    'repayment_missing_journal', (SELECT count(*) FROM public.loan_transactions lt WHERE lt.journal_entry_id IS NULL),
    'orphaned_loans', (SELECT count(*) FROM public.loans l JOIN public.chart_of_accounts c ON c.id=l.coa_id LEFT JOIN active_directors ad ON ad.loan_account_id=l.coa_id WHERE c.name ~* 'director[[:space:]]+loan' AND ad.id IS NULL)
  )
);
`;

try {
  const stdout = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 100 * 1024 * 1024,
  });
  const response = JSON.parse(stdout);
  if (response.error) throw new Error(response.error.message ?? JSON.stringify(response.error));
  const result = response.rows?.[0]?.jsonb_build_object ?? response.rows?.[0];
  console.log(JSON.stringify(result, null, 2));
  const unmappedLedgers = result?.historical?.unmapped_director_ledgers;
  if (!Array.isArray(result?.directors) || result.directors.length === 0 || (Array.isArray(unmappedLedgers) && unmappedLedgers.length > 0)) {
    throw new Error('Director/Owner accounting verification is incomplete: configure or restore an authoritative Director Master mapping before posting new Director/Owner loans.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
