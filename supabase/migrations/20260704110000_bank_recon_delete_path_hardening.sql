-- ============================================================================
-- Bank Reconciliation delete-path hardening (2026-07-04)
-- ----------------------------------------------------------------------------
-- Every path that deletes or removes a journal_entries row (or a document that
-- owns one) must first reset bank_statement_lines.reconciliation_status back
-- to 'unmatched' and null the typed FK + matched_entry_id + audit columns.
-- Otherwise ON DELETE SET NULL nulls the typed FK but leaves the status stuck
-- at 'matched'/'recorded', producing the "Linked (reference unresolved)" bug.
--
-- Scope of this migration:
--   1. cancel_gl_posting()                      – shared by expense / petty
--                                                 cash / receipt voucher /
--                                                 payment voucher cancel-posting.
--   2. delete_payment_voucher_with_allocations() – client-facing RPC.
--   3. delete_fund_transfer()                    – add matched_entry_id reset
--                                                 (matched_fund_transfer_id was
--                                                 already handled).
--
-- Business logic, permissions, period-locked guards, and audit-trail behaviour
-- are unchanged — only bsl cleanup is added before the DELETE FROM
-- journal_entries statement (and, for fund transfer, alongside the existing
-- typed-FK reset).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────
-- 1. cancel_gl_posting: reset bsl BEFORE deleting the JE
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_gl_posting(
  p_je_id        uuid,
  p_doc_id       uuid,
  p_table_name   text,
  p_cancelled_by uuid,
  p_reason       text,
  p_extra_audit  jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_je            journal_entries%ROWTYPE;
  v_period_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_je FROM journal_entries WHERE id = p_je_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found', p_je_id;
  END IF;

  SELECT ap.status INTO v_period_status
  FROM accounting_periods ap
  WHERE ap.start_date <= v_je.entry_date AND ap.end_date >= v_je.entry_date
  ORDER BY ap.start_date DESC
  LIMIT 1;

  IF v_period_status IS NOT NULL AND v_period_status != 'open' THEN
    RAISE EXCEPTION
      'Cannot cancel posting: the accounting period for % is closed. Contact your finance manager to reopen the period.',
      TO_CHAR(v_je.entry_date, 'FMMonth YYYY');
  END IF;

  -- Reset any bank_statement_lines that reference this JE (or the source
  -- document via its typed FK) BEFORE we delete journal_entries. This prevents
  -- ON DELETE SET NULL from leaving reconciliation_status='matched'/'recorded'
  -- with a null FK ("Linked (reference unresolved)" bug).
  UPDATE bank_statement_lines
     SET matched_entry_id       = NULL,
         matched_expense_id     = NULL,
         matched_receipt_id     = NULL,
         matched_fund_transfer_id = NULL,
         matched_petty_cash_id  = NULL,
         reconciliation_status  = 'unmatched',
         matched_at             = NULL,
         matched_by             = NULL,
         notes                  = NULL
   WHERE matched_entry_id = p_je_id
      OR (p_table_name = 'finance_expenses'         AND matched_expense_id       = p_doc_id)
      OR (p_table_name = 'receipt_vouchers'         AND matched_receipt_id       = p_doc_id)
      OR (p_table_name = 'payment_vouchers'         AND matched_entry_id         = p_je_id)
      OR (p_table_name = 'fund_transfers'           AND matched_fund_transfer_id = p_doc_id)
      OR (p_table_name = 'petty_cash_transactions'  AND matched_petty_cash_id    = p_doc_id);

  DELETE FROM journal_entry_lines WHERE journal_entry_id = p_je_id;
  DELETE FROM journal_entries      WHERE id              = p_je_id;

  INSERT INTO audit_logs (table_name, record_id, action_type, old_values, new_values, user_id)
  VALUES (
    p_table_name, p_doc_id, 'update',
    p_extra_audit || jsonb_build_object(
      '_action',              'CANCEL_POSTING',
      'journal_entry_id',     p_je_id,
      'journal_entry_number', v_je.entry_number,
      'entry_date',           v_je.entry_date,
      'reason',               p_reason
    ),
    jsonb_build_object('cancelled_by', p_cancelled_by, 'cancelled_at', NOW()),
    p_cancelled_by
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 2. delete_payment_voucher_with_allocations: reset bsl BEFORE deleting JE
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_payment_voucher_with_allocations(
  p_voucher_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_je_id     UUID;
  v_is_posted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT journal_entry_id, is_posted INTO v_je_id, v_is_posted
  FROM payment_vouchers WHERE id = p_voucher_id;

  IF v_is_posted THEN
    RAISE EXCEPTION 'Cannot delete: payment voucher is posted. Cancel Posting first.';
  END IF;

  DELETE FROM voucher_allocations WHERE payment_voucher_id = p_voucher_id;
  DELETE FROM payment_vouchers    WHERE id                 = p_voucher_id;

  IF v_je_id IS NOT NULL THEN
    -- Reset bank_statement_lines that reference this JE BEFORE we delete it.
    UPDATE bank_statement_lines
       SET matched_entry_id      = NULL,
           reconciliation_status = 'unmatched',
           matched_at            = NULL,
           matched_by            = NULL,
           notes                 = NULL
     WHERE matched_entry_id = v_je_id;

    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries      WHERE id              = v_je_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. delete_fund_transfer: also reset matched_entry_id, not just typed FK
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_fund_transfer(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_transfer_number text;
BEGIN
  SELECT status, transfer_number
    INTO v_status, v_transfer_number
    FROM fund_transfers WHERE id = p_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fund transfer % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Posted fund transfer cannot be deleted. Use reverse_fund_transfer instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (a) Break the FK cycle first: NULL the parent's journal_entry_id BEFORE we
  --     touch journal_entries. This prevents ON DELETE SET NULL from firing
  --     an UPDATE on the row we are about to delete.
  UPDATE fund_transfers SET journal_entry_id = NULL WHERE id = p_id;

  -- (a2) Reset bsl by BOTH the typed FK AND matched_entry_id BEFORE we delete
  --      the journal entries. This is the fix — the previous version only reset
  --      matched_fund_transfer_id, leaving matched_entry_id dangling and status
  --      stuck at 'matched'/'recorded'.
  UPDATE bank_statement_lines
     SET matched_fund_transfer_id = NULL,
         matched_entry_id         = NULL,
         reconciliation_status    = 'unmatched',
         matched_at               = NULL,
         matched_by               = NULL,
         notes                    = NULL
   WHERE matched_fund_transfer_id = p_id
      OR matched_entry_id IN (
           SELECT id FROM journal_entries
            WHERE source_module = 'fund_transfers'
              AND (reference_id = p_id OR reference_number = v_transfer_number)
         );

  -- (b) Reverse ledger entries.
  DELETE FROM journal_entry_lines
   WHERE journal_entry_id IN (
     SELECT id FROM journal_entries
      WHERE source_module = 'fund_transfers'
        AND (reference_id = p_id
             OR reference_number = v_transfer_number)
   );

  DELETE FROM journal_entries
   WHERE source_module = 'fund_transfers'
     AND (reference_id = p_id
          OR reference_number = v_transfer_number);

  -- (d) Remove linked petty-cash allocations.
  DELETE FROM petty_cash_transactions WHERE fund_transfer_id = p_id;

  -- (e) Finally delete the fund transfer row itself.
  DELETE FROM fund_transfers WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_fund_transfer(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_fund_transfer(uuid) FROM anon;
