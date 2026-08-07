import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface ExpenseCategoryDef {
  id: string;
  value: string;
  label: string;
  type: 'import' | 'sales' | 'staff' | 'operations' | 'admin' | 'assets';
  taxBehavior: string;
  description: string;
  requiresContainer: boolean;
  allowsAccountOverride: boolean;
  group: string;
  parentId: string | null;
  coaAccountId: string;
  coaCode?: string;
  coaName?: string;
  sortOrder: number;
}

type CategoryRow = {
  id: string;
  category_key: string;
  name: string;
  category_type: ExpenseCategoryDef['type'];
  tax_behavior: string;
  description: string | null;
  requires_container: boolean;
  allows_account_override: boolean;
  parent_id: string | null;
  coa_account_id: string;
  sort_order: number;
  is_posting_category: boolean;
  parent?: { name: string } | { name: string }[] | null;
  chart_of_accounts?: { code: string; name: string } | { code: string; name: string }[] | null;
};

const first = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] || null : value || null;

export function useExpenseCategories(includeInactive = false) {
  const [categories, setCategories] = useState<ExpenseCategoryDef[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCategories = useCallback(async () => {
    const query = supabase
      .from('expense_categories')
      .select('id, category_key, name, category_type, tax_behavior, description, requires_container, allows_account_override, parent_id, coa_account_id, sort_order, is_posting_category, parent:parent_id(name), chart_of_accounts:coa_account_id(code,name)')
      .order('sort_order')
      .order('name');
    if (!includeInactive) query.eq('is_active', true);
    query.eq('is_posting_category', true);
    const { data, error } = await query;
    if (error) throw error;
    setCategories(((data || []) as CategoryRow[]).map((row) => {
      const parent = first(row.parent);
      const coa = first(row.chart_of_accounts);
      return {
        id: row.id,
        value: row.category_key,
        label: row.name,
        type: row.category_type,
        taxBehavior: row.tax_behavior,
        description: row.description || '',
        requiresContainer: row.requires_container,
        allowsAccountOverride: row.allows_account_override,
        parentId: row.parent_id,
        group: parent?.name || row.category_type,
        coaAccountId: row.coa_account_id,
        coaCode: coa?.code,
        coaName: coa?.name,
        sortOrder: row.sort_order,
      };
    }));
  }, [includeInactive]);

  useEffect(() => {
    setLoading(true);
    loadCategories().catch((error) => console.error('Unable to load Expense Category master', error)).finally(() => setLoading(false));
  }, [loadCategories]);

  return { categories: useMemo(() => [...categories], [categories]), loading, reloadCategories: loadCategories };
}
