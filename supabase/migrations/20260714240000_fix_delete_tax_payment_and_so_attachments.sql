-- ============================================================================
-- Fix 1: delete_tax_payment / update_tax_payment — remove invalid updated_at
-- Fix 2: sales-order-documents — restore SELECT policy for signed URLs
-- ============================================================================
--
-- Fix 1 — Root cause:
--   bank_statement_lines does NOT have an updated_at column (noted in
--   20260714200000_receipt_voucher_delete_journal_cleanup.sql).
--   delete_tax_payment() at line ~402 and update_tax_payment() at line ~629
--   both write `updated_at = now()` to bank_statement_lines, causing
--   ERROR 42703: column "updated_at" of relation "bank_statement_lines" does
--   not exist. This aborts the entire delete/update transaction.
--
--   Fix: redefine both functions with the offending `updated_at = now()`
--   line removed from the bank_statement_lines UPDATE. All other logic is
--   identical. matched_at IS the authoritative recon timestamp (set by the
--   reconciliation UI, not by these functions), so no information is lost.
--
-- Fix 2 — Root cause:
--   Migration 20260501100000 dropped "Authenticated read sales-order-documents"
--   (the SELECT policy). After 20260713120000 made the bucket private, there
--   is no SELECT policy that allows createSignedUrl() to work. The browser
--   falls back to the stored public URL, which 404s because the bucket is
--   now private. Restore a SELECT policy so signed URL generation works for
--   all authenticated users.
--
-- Additive. Idempotent.
-- ============================================================================

BEGIN;

-- ============================================================================
-- Fix 1a: delete_tax_payment — remove bank_statement_lines.updated_at write
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_tax_payment(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment        tax_payments%ROWTYPE;
  v_period_status  text;
  v_je_ids         uuid[];
  v_file_urls      text[];

  v_orphan_pay     int;
  v_orphan_je      int;
  v_orphan_je_lines int;
  v_orphan_bsl     int;
  v_orphan_bri     int;
  v_orphan_files   int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Tax payment id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the row
  SELECT * INTO v_payment
    FROM public.tax_payments
   WHERE id = p_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tax payment % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Refuse if the period is closed (unless service_role)
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    SELECT status INTO v_period_status FROM tax_periods WHERE id = v_payment.tax_period_id;
    IF v_period_status = 'closed' THEN
      RAISE EXCEPTION 'Tax period is closed; cannot delete tax payment. Reopen the period first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Collect JEs owned by this tax payment
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_je_ids
    FROM public.journal_entries
   WHERE source_module = 'tax_payment'
     AND reference_id  = p_id;

  IF v_payment.journal_entry_id IS NOT NULL
     AND NOT v_payment.journal_entry_id = ANY (v_je_ids) THEN
    v_je_ids := array_append(v_je_ids, v_payment.journal_entry_id);
  END IF;

  -- Release bank_statement_lines matched to this payment.
  -- NOTE: bank_statement_lines has no updated_at column — do not write it.
  UPDATE public.bank_statement_lines
     SET matched_entry_id       = NULL,
         matched_tax_payment_id = NULL,
         reconciliation_status  = 'unmatched'
   WHERE (matched_tax_payment_id = p_id)
      OR (array_length(v_je_ids, 1) IS NOT NULL AND matched_entry_id = ANY (v_je_ids));

  -- Release bank_reconciliation_items entries
  IF array_length(v_je_ids, 1) IS NOT NULL THEN
    UPDATE public.bank_reconciliation_items
       SET is_matched = false,
           matched_at = NULL
     WHERE journal_entry_id = ANY (v_je_ids);
  END IF;

  -- Snapshot attachment paths BEFORE cascade-deleting the rows
  SELECT COALESCE(array_agg(file_url), ARRAY[]::text[])
    INTO v_file_urls
    FROM public.tax_payment_files
   WHERE tax_payment_id = p_id;

  DELETE FROM public.tax_payment_files WHERE tax_payment_id = p_id;

  -- Break FK from tax_payments → JE before deleting JE
  UPDATE public.tax_payments
     SET journal_entry_id = NULL
   WHERE id = p_id;

  IF array_length(v_je_ids, 1) IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE journal_entry_id = ANY (v_je_ids);
    DELETE FROM public.journal_entries     WHERE id = ANY (v_je_ids);
  END IF;

  DELETE FROM public.tax_payments WHERE id = p_id;

  -- ═══ INTEGRITY CHECKS ═════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_orphan_pay FROM public.tax_payments WHERE id = p_id;
  IF v_orphan_pay <> 0 THEN
    RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — tax_payments row still present. Rolling back.', p_id
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT COUNT(*) INTO v_orphan_je
    FROM public.journal_entries
   WHERE source_module = 'tax_payment' AND reference_id = p_id;
  IF v_orphan_je <> 0 THEN
    RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — % orphan journal_entries (source=tax_payment) remain. Rolling back.', p_id, v_orphan_je
      USING ERRCODE = 'raise_exception';
  END IF;

  IF array_length(v_je_ids, 1) IS NOT NULL THEN
    SELECT COUNT(*) INTO v_orphan_je_lines
      FROM public.journal_entry_lines WHERE journal_entry_id = ANY (v_je_ids);
    IF v_orphan_je_lines <> 0 THEN
      RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — % orphan journal_entry_lines remain. Rolling back.', p_id, v_orphan_je_lines
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT COUNT(*) INTO v_orphan_bsl
      FROM public.bank_statement_lines
     WHERE matched_entry_id = ANY (v_je_ids);
    IF v_orphan_bsl <> 0 THEN
      RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — % bank_statement_lines still matched to deleted JE. Rolling back.', p_id, v_orphan_bsl
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT COUNT(*) INTO v_orphan_bri
      FROM public.bank_reconciliation_items
     WHERE journal_entry_id = ANY (v_je_ids) AND is_matched = true;
    IF v_orphan_bri <> 0 THEN
      RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — % bank_reconciliation_items still matched to deleted JE. Rolling back.', p_id, v_orphan_bri
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_orphan_files FROM public.tax_payment_files WHERE tax_payment_id = p_id;
  IF v_orphan_files <> 0 THEN
    RAISE EXCEPTION 'delete_tax_payment(%): integrity check failed — % orphan tax_payment_files remain. Rolling back.', p_id, v_orphan_files
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Audit trail (best-effort — do not let audit failure abort the delete)
  BEGIN
    INSERT INTO public.audit_logs (table_name, record_id, action_type, old_values, new_values, user_id)
    VALUES (
      'tax_payments', p_id, 'delete',
      jsonb_build_object(
        'tax_period_id',   v_payment.tax_period_id,
        'tax_type',        v_payment.tax_type,
        'amount',          v_payment.amount,
        'payment_date',    v_payment.payment_date,
        'status',          v_payment.status,
        'file_urls',       v_file_urls
      ),
      NULL,
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit failure must not abort the delete
  END;
END $$;

REVOKE ALL     ON FUNCTION public.delete_tax_payment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_tax_payment(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_tax_payment(uuid) TO authenticated;

-- ============================================================================
-- Fix 1b: update_tax_payment — remove bank_statement_lines.updated_at write
-- Read the full function signature from the existing definition first.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_tax_payment(
  p_id                 uuid,
  p_payment_date       date,
  p_amount             numeric,
  p_bank_account_id    uuid,
  p_billing_code       text,
  p_ntpn               text,
  p_government_reference text,
  p_notes              text,
  p_payment_reference  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old              tax_payments%ROWTYPE;
  v_period_status    text;
  v_old_je_ids       uuid[];
  v_je_id            uuid;
  v_je_number        text;
  v_ref_number       text;
  v_bank_acct_coa_id uuid;
  v_payable_acct_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_old FROM public.tax_payments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tax payment % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    SELECT status INTO v_period_status FROM tax_periods WHERE id = v_old.tax_period_id;
    IF v_period_status = 'closed' THEN
      RAISE EXCEPTION 'Tax period is closed; cannot modify tax payment.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Resolve the bank account's COA entry
  SELECT coa_account_id INTO v_bank_acct_coa_id
    FROM bank_accounts WHERE id = p_bank_account_id;
  IF v_bank_acct_coa_id IS NULL THEN
    RAISE EXCEPTION 'Bank account % has no linked COA account', p_bank_account_id;
  END IF;

  -- Resolve the tax payable account for this tax type
  SELECT id INTO v_payable_acct_id
    FROM chart_of_accounts
   WHERE account_code IN (
     CASE v_old.tax_type
       WHEN 'PPN'         THEN '2130'
       WHEN 'PPh21'       THEN '2140'
       WHEN 'PPh22'       THEN '2141'
       WHEN 'PPh23'       THEN '2142'
       WHEN 'PPh4(2)'     THEN '2143'
       WHEN 'PPh_Unifikasi' THEN '2144'
       ELSE '2130'
     END
   )
   LIMIT 1;
  IF v_payable_acct_id IS NULL THEN
    RAISE EXCEPTION 'No payable COA account found for tax type %', v_old.tax_type;
  END IF;

  -- Reverse old JE(s)
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_old_je_ids
    FROM journal_entries
   WHERE source_module = 'tax_payment' AND reference_id = p_id;
  IF v_old.journal_entry_id IS NOT NULL AND NOT v_old.journal_entry_id = ANY (v_old_je_ids) THEN
    v_old_je_ids := array_append(v_old_je_ids, v_old.journal_entry_id);
  END IF;

  -- Release bank recon matches before deleting the JEs.
  -- NOTE: bank_statement_lines has no updated_at column — do not write it.
  UPDATE bank_statement_lines
     SET matched_entry_id       = NULL,
         matched_tax_payment_id = NULL,
         reconciliation_status  = 'unmatched'
   WHERE matched_tax_payment_id = p_id
      OR (array_length(v_old_je_ids, 1) IS NOT NULL AND matched_entry_id = ANY (v_old_je_ids));

  IF array_length(v_old_je_ids, 1) IS NOT NULL THEN
    UPDATE bank_reconciliation_items
       SET is_matched = false, matched_at = NULL
     WHERE journal_entry_id = ANY (v_old_je_ids);
    DELETE FROM journal_entry_lines WHERE journal_entry_id = ANY (v_old_je_ids);
    DELETE FROM journal_entries     WHERE id = ANY (v_old_je_ids);
  END IF;

  -- Update the payment row
  UPDATE tax_payments SET
    payment_date         = p_payment_date,
    amount               = p_amount,
    bank_account_id      = p_bank_account_id,
    billing_code         = p_billing_code,
    ntpn                 = p_ntpn,
    government_reference = p_government_reference,
    notes                = p_notes,
    payment_reference    = p_payment_reference,
    journal_entry_id     = NULL,
    status               = 'draft',
    updated_at           = now()
  WHERE id = p_id;

  -- Post fresh JE
  v_ref_number := COALESCE(
    NULLIF(p_ntpn, ''), NULLIF(p_billing_code, ''), NULLIF(p_payment_reference, ''),
    'TAX-' || to_char(p_payment_date, 'YYMM') || '-' || substr(p_id::text, 1, 8)
  );
  v_je_number := next_journal_entry_number();

  INSERT INTO journal_entries
    (entry_number, entry_date, source_module, reference_id, reference_number,
     description, total_debit, total_credit, is_posted, posted_by)
  VALUES
    (v_je_number, p_payment_date, 'tax_payment', p_id, v_ref_number,
     'Tax Payment ' || v_old.tax_type || ' — ' || v_ref_number,
     p_amount, p_amount, true, auth.uid())
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines
    (journal_entry_id, line_number, account_id, description, debit, credit)
  VALUES
    (v_je_id, 1, v_payable_acct_id,
     v_old.tax_type || ' payment — ' || v_ref_number, p_amount, 0),
    (v_je_id, 2, v_bank_acct_coa_id,
     'Bank ' || v_old.tax_type || ' payment — ' || v_ref_number, 0, p_amount);

  UPDATE tax_payments
     SET journal_entry_id = v_je_id,
         status           = 'posted',
         updated_at       = now()
   WHERE id = p_id;

  -- Refresh period snapshot
  PERFORM compute_period_ppn(v_old.tax_period_id);
END $$;

REVOKE ALL     ON FUNCTION public.update_tax_payment(uuid,date,numeric,uuid,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_tax_payment(uuid,date,numeric,uuid,text,text,text,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_tax_payment(uuid,date,numeric,uuid,text,text,text,text,text) TO authenticated;

-- ============================================================================
-- Fix 2: sales-order-documents — restore SELECT policy for signed URLs
-- The 20260501100000 migration dropped "Authenticated read sales-order-documents".
-- Without a SELECT policy, createSignedUrl() fails for authenticated users,
-- so the browser falls back to the stored public URL which 404s on a private bucket.
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated read sales-order-documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view PO documents"  ON storage.objects;

CREATE POLICY "so_docs_authenticated_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'sales-order-documents');

NOTIFY pgrst, 'reload schema';

COMMIT;
