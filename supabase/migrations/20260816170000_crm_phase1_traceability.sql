-- CRM Phase 1: additive traceability and structured loss signals.
-- No accounting, inventory, or historical document data is changed.

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.crm_inquiries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_inquiry_id
  ON public.sales_orders(inquiry_id);

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS erp_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_erp_customer_id
  ON public.crm_contacts(erp_customer_id);

ALTER TABLE public.crm_inquiries
  ADD COLUMN IF NOT EXISTS lost_reason_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_inquiries_lost_reason_code_chk'
      AND conrelid = 'public.crm_inquiries'::regclass
  ) THEN
    ALTER TABLE public.crm_inquiries
      ADD CONSTRAINT crm_inquiries_lost_reason_code_chk
      CHECK (lost_reason_code IS NULL OR lost_reason_code IN (
        'price', 'availability', 'lead_time', 'specification',
        'customer_postponed', 'competitor', 'no_response', 'sample_coa', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_inquiries_lost_reason_code
  ON public.crm_inquiries(lost_reason_code);

COMMENT ON COLUMN public.sales_orders.inquiry_id IS
  'Optional CRM source inquiry. Set only when an employee creates an SO from an inquiry.';
COMMENT ON COLUMN public.crm_contacts.erp_customer_id IS
  'Explicit promotion/link to the ERP customers master; never populated by inquiry creation.';
COMMENT ON COLUMN public.crm_inquiries.lost_reason_code IS
  'Optional structured loss signal; free-text lost_reason remains the detailed explanation.';

NOTIFY pgrst, 'reload schema';
