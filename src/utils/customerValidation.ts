import { supabase } from '../lib/supabase';

export const DUPLICATE_CUSTOMER_MESSAGE = 'A customer with this name already exists.';

export const normalizeCustomerName = (name: string) =>
  name.trim().toLowerCase();

export const isDuplicateCustomerError = (error: unknown) => {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const text = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return err?.code === '23505' && text.includes('customers_company_name_normalized');
};

export const ensureUniqueCustomerName = async (companyName: string, excludeCustomerId?: string) => {
  const normalizedName = normalizeCustomerName(companyName);

  if (!normalizedName) {
    return;
  }

  const { data, error } = await supabase.rpc('customer_name_exists', {
    p_company_name: companyName,
    p_exclude_customer_id: excludeCustomerId || null,
  });
  if (error) {
    const missingFunction = error.code === 'PGRST202' || error.message?.includes('customer_name_exists');
    if (!missingFunction) {
      throw error;
    }

    let query = supabase
      .from('customers')
      .select('id, company_name')
      .eq('is_active', true)
      .limit(10000);

    if (excludeCustomerId) {
      query = query.neq('id', excludeCustomerId);
    }

    const fallback = await query;
    if (fallback.error) throw fallback.error;

    const duplicate = (fallback.data || []).some(customer =>
      normalizeCustomerName((customer as { company_name?: string }).company_name || '') === normalizedName
    );

    if (duplicate) {
      throw new Error(DUPLICATE_CUSTOMER_MESSAGE);
    }

    return;
  }

  if (data) {
    throw new Error(DUPLICATE_CUSTOMER_MESSAGE);
  }
};

// ── CRM prospect (crm_contacts) duplicate check ────────────────────────────
// The ERP `customers` and CRM `crm_contacts` masters are independent. The
// helper below mirrors ensureUniqueCustomerName but scans crm_contacts,
// which has its own UNIQUE (company_name) constraint (see migration
// 20251120181805_auto_sync_customers_from_inquiries.sql).

export const DUPLICATE_CRM_CONTACT_MESSAGE = 'A CRM customer with this name already exists.';

export const isDuplicateCrmContactError = (error: unknown) => {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const text = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return err?.code === '23505' && text.includes('crm_contacts_company_name');
};

export const ensureUniqueCrmContactName = async (companyName: string, excludeContactId?: string) => {
  const normalizedName = normalizeCustomerName(companyName);
  if (!normalizedName) return;

  let query = supabase
    .from('crm_contacts')
    .select('id, company_name')
    .eq('is_active', true)
    .limit(10000);

  if (excludeContactId) {
    query = query.neq('id', excludeContactId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const duplicate = (data || []).some(row =>
    normalizeCustomerName((row as { company_name?: string }).company_name || '') === normalizedName
  );

  if (duplicate) {
    throw new Error(DUPLICATE_CRM_CONTACT_MESSAGE);
  }
};
