-- ============================================================================
-- Faktur Pajak: read company identity from Company Profile (2026-07-16)
-- ============================================================================
-- Root cause of "organization_tax_settings not configured":
--   * organization_tax_settings was created on 2025-12-16 to hold the org
--     NPWP / PKP flag / faktur number counter, but NO UI or seed migration
--     ever wrote a row to it (zero references in src/). It has been empty
--     since creation.
--   * The Company Profile refactor (20260713230000_company_profile_versioning)
--     made company_profiles the source of truth for company identity —
--     company_tax_id (NPWP), legal name, address — editable in Settings.
--   * assign_faktur_pajak_number (20260713140100) still read the dead table
--     and raised on the empty result, so Faktur Pajak generation always
--     failed even though the company IS fully configured.
--
-- Fix — no duplicate settings:
--   * Company identity / PKP gate now comes from the CURRENT company profile:
--     issuing a Faktur requires a non-empty company_tax_id (NPWP). The old
--     pkp_status flag lived in a table nothing could ever populate, so it
--     could never be true; NPWP-on-profile is the real, user-maintained
--     signal. (Faktur generation is only offered for invoices that already
--     charge PPN.)
--   * organization_tax_settings is kept ONLY as the atomic faktur numbering
--     state (faktur_prefix + faktur_current_number). A single defaults-only
--     row is auto-seeded on first use; its npwp_* columns stay unused so no
--     company data is duplicated. The counter cannot live in
--     company_profiles: that table is versioned (immutable snapshot per
--     effective_from) and must not carry mutable operational state.
--
-- No schema changes. Idempotent (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_faktur_pajak_number(
  p_sales_invoice_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile    company_profiles%ROWTYPE;
  v_settings   organization_tax_settings%ROWTYPE;
  v_number     text;
  v_next       int;
  v_invoice    sales_invoices%ROWTYPE;
  v_lock_id    bigint;
  v_period_id  uuid;
  v_dpp        numeric(18,2);
  v_ppn        numeric(18,2);
BEGIN
  -- Serialize faktur-number issuance across concurrent callers
  v_lock_id := hashtext('faktur_pajak_seq');
  PERFORM pg_advisory_xact_lock(v_lock_id);

  -- Company identity gate: the CURRENT company profile must carry an NPWP.
  SELECT * INTO v_profile
    FROM company_profiles
   WHERE effective_from <= CURRENT_DATE
   ORDER BY effective_from DESC
   LIMIT 1;
  IF NOT FOUND OR COALESCE(TRIM(v_profile.company_tax_id), '') = '' THEN
    RAISE EXCEPTION 'Company Profile has no NPWP — set the company NPWP (Tax ID) in Settings → Company before issuing Faktur Pajak';
  END IF;

  -- Faktur numbering state — auto-seed the counter row on first use.
  SELECT * INTO v_settings FROM organization_tax_settings ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO organization_tax_settings (pkp_status, faktur_current_number)
    VALUES (true, 0)
    RETURNING * INTO v_settings;
  END IF;

  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_sales_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales invoice % not found', p_sales_invoice_id;
  END IF;
  IF v_invoice.faktur_pajak_number IS NOT NULL AND v_invoice.faktur_pajak_number <> '' THEN
    -- Idempotent: return the existing number
    RETURN v_invoice.faktur_pajak_number;
  END IF;

  v_next := COALESCE(v_settings.faktur_current_number, 0) + 1;

  v_number := COALESCE(v_settings.faktur_prefix, '000') || '.' ||
              lpad(v_next::text, 8, '0') || '-' ||
              to_char(COALESCE(v_invoice.invoice_date, CURRENT_DATE), 'YY');

  UPDATE organization_tax_settings
    SET faktur_current_number = v_next, updated_at = now()
    WHERE id = v_settings.id;

  UPDATE sales_invoices
    SET faktur_pajak_number = v_number,
        updated_at = now()
    WHERE id = p_sales_invoice_id;

  -- Attribute invoice to its PPN tax_period (idempotent upsert)
  v_period_id := upsert_tax_period(
    EXTRACT(YEAR  FROM v_invoice.invoice_date)::int,
    EXTRACT(MONTH FROM v_invoice.invoice_date)::int,
    'PPN'
  );
  UPDATE sales_invoices SET tax_period_id = v_period_id WHERE id = p_sales_invoice_id;

  -- Derive DPP + PPN split from tax_amount (Indonesian PPN 11%)
  v_ppn := COALESCE(v_invoice.tax_amount, 0);
  v_dpp := GREATEST(COALESCE(v_invoice.total_amount, 0) - v_ppn, 0);

  INSERT INTO faktur_pajak
    (sales_invoice_id, tax_period_id, faktur_number, issue_date,
     customer_id, dpp_amount, ppn_amount, status, created_by)
  VALUES
    (p_sales_invoice_id, v_period_id, v_number,
     COALESCE(v_invoice.invoice_date, CURRENT_DATE),
     v_invoice.customer_id, v_dpp, v_ppn, 'generated', auth.uid())
  ON CONFLICT (sales_invoice_id) DO UPDATE SET
    faktur_number = EXCLUDED.faktur_number,
    tax_period_id = EXCLUDED.tax_period_id,
    dpp_amount    = EXCLUDED.dpp_amount,
    ppn_amount    = EXCLUDED.ppn_amount,
    updated_at    = now();

  INSERT INTO audit_logs (user_id, table_name, action_type, record_id, new_values)
  VALUES (auth.uid(), 'faktur_pajak', 'insert', p_sales_invoice_id,
          jsonb_build_object('faktur_number', v_number, 'sales_invoice_id', p_sales_invoice_id));

  RETURN v_number;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
