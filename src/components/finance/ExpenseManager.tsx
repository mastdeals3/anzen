import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Package, Truck, CreditCard as Edit, Trash2, FileText, Upload, X, ExternalLink, Download, Eye, CheckCircle, XCircle, Clipboard, ClipboardCheck, Lock, RotateCcw, UserPlus, AlertCircle, Banknote, Link2 } from 'lucide-react';
import { FinanceModal as Modal } from './FinanceModal';
import { MoneyInput } from '../MoneyInput';
import { SearchableSelect } from '../SearchableSelect';
import { FinanceModal } from './FinanceModal';
import { F_BTN_PRIMARY, F_BTN_SECONDARY } from './FinanceForm';
import { FinanceActionButton } from './FinanceUI';
import { getCategoryFieldRules } from './categoryFieldRules';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
import { moduleExpenseCategories, sortExpenseCategories } from './expenseCategories';
import { BankTransactionLinkField } from './BankTransactionLinkField';
import { approveFinanceExpense, getReportingUsdRate, saveFinanceExpense } from '../../services/financeCommands';
import {
  linkBankTransaction,
  notifyFinanceReconciliationRefresh,
  unlinkBankTransaction,
} from './bankTransactionLinking';

// Tiny inline helper used inside the SAP header PPN cell — a 3-state
// selector rendered as a right-side chip so it doesn't consume a column.
function PpnModeToggle({ value, onChange }: {
  value: 'standard' | 'dpp_nilai_lain' | 'manual' | undefined;
  onChange: (mode: 'standard' | 'dpp_nilai_lain' | 'manual') => void;
}) {
  return (
    <select
      value={value || 'standard'}
      onChange={(e) => onChange(e.target.value as 'standard' | 'dpp_nilai_lain' | 'manual')}
      title="PPN calculation mode"
      className="h-6 px-1 text-[9px] font-semibold border border-gray-200 bg-white rounded-none"
    >
      <option value="standard">STD</option>
      <option value="dpp_nilai_lain">DPP</option>
      <option value="manual">MAN</option>
    </select>
  );
}

// Broker Invoice PPN % selector — Indonesian tax practice: 0 / 11 / 12 / Custom.
// - 0/11/12: PPN Amount is auto-calculated from Invoice DPP × rate (read-only).
// - Custom: user types both rate (optional) and PPN Amount manually.
function BrokerPpnRateSelector({ rate, isCustom, onChange }: {
  rate: number;
  isCustom: boolean;
  onChange: (v: { rate: number; custom: boolean }) => void;
}) {
  // Preset only reflects the selector when NOT in Custom mode and the rate is a known preset.
  const preset: string = isCustom ? 'custom'
    : rate === 0 ? '0'
    : rate === 11 ? '11'
    : rate === 12 ? '12'
    : 'custom';
  return (
    <div className="flex items-center gap-1 w-full">
      <select
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom')      onChange({ rate: rate || 0, custom: true });
          else if (v === '0')      onChange({ rate: 0,  custom: false });
          else if (v === '11')     onChange({ rate: 11, custom: false });
          else if (v === '12')     onChange({ rate: 12, custom: false });
        }}
        className={SAP_INPUT + ' !flex-none !w-20'}
        title="PPN rate — 0 / 11 / 12 / Custom"
      >
        <option value="0">0%</option>
        <option value="11">11%</option>
        <option value="12">12%</option>
        <option value="custom">Custom</option>
      </select>
      {isCustom && (
        <input
          type="number" min="0" max="100" step="0.5"
          value={rate === 0 ? '' : rate}
          onChange={(e) => {
            const r = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
            onChange({ rate: r, custom: true });
          }}
          className={SAP_INPUT + ' !flex-1 !text-right !font-mono'}
          placeholder="Custom %"
        />
      )}
    </div>
  );
}
import { useFinance } from '../../contexts/FinanceContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { resolveStorageUrlCached } from '../../utils/signedUrlCache';
import { supabaseErrorMessage } from '../../utils/supabaseError';
import { formatCurrency, normalizeCurrency, resolveTransactionCurrency } from '../../utils/currency';
import { useSupabaseRealtimeChannel } from '../../hooks/useSupabaseRealtimeChannel';
import {
  DOCUMENT_TYPE_GROUPS,
  DOCUMENT_TYPE_TAX_CONFIG,
  SUPPLIER_TYPES,
  type BrokerItem,
  type DocumentType,
  calculatePPN,
  calculateExpenseTotals,
  calculateBrokerExpenseTotals,
  brokerLineTotal,
  computeBrokerLinePpn,
  getDueDateFromTerms,
  EXPENSE_CATEGORY_LABELS,
} from '../../utils/taxCalculations';

interface FinanceExpense {
  id: string;
  expense_category: string;
  amount: number;
  expense_date: string;
  description: string | null;
  batch_id: string | null;
  import_container_id: string | null;
  delivery_challan_id: string | null;
  expense_type: string | null;
  document_urls: string[] | null;
  payment_method: string | null;
  bank_account_id: string | null;
  payment_reference: string | null;
  voucher_number: string | null;
  currency_code?: string | null;
  transaction_currency?: string | null;
  functional_currency?: string | null;
  exchange_rate?: number | null;
  bank_account_currency?: string | null;
  payment_currency?: string | null;
  approval_status: 'pending_approval' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  // New supplier invoice fields
  supplier_id?: string | null;
  staff_id?: string | null;
  invoice_number?: string | null;
  due_date?: string | null;
  paid_amount?: number | null;
  broker_items?: BrokerItem[] | null;
  // PIB Import breakdown columns (non-null only when expense_category = 'pib_import')
  pib_bm_amount?: number | null;
  pib_ppn_amount?: number | null;
  pib_pph_amount?: number | null;
  // Tax fields for non-PIB expenses
  ppn_amount?: number | null;
  ppn_manual_override?: boolean | null;
  ppn_calc_mode?: 'standard' | 'dpp_nilai_lain' | 'manual' | null;
  dpp_amount?: number | null;
  ppn_rate?: number | null;
  pph_amount?: number | null;
  pph_code_id?: string | null;
  stamp_duty_amount?: number | null;
  fixed_asset_account_id?: string | null;
  // Utility-only optional bank charges
  bank_charges_amount?: number | null;
  batches?: { batch_number: string } | null;
  import_containers?: { container_ref: string } | null;
  delivery_challans?: { challan_number: string } | null;
  bank_accounts?: { bank_name: string; account_number: string; alias: string | null; currency: string } | null;
  bank_statement_lines?: Array<{
    id: string;
    transaction_date: string;
    description: string | null;
    debit_amount: number;
    credit_amount: number;
    bank_account_id: string;
    payment_kind?: string | null;
    bank_accounts?: { bank_name: string; account_number: string; alias: string | null; currency: string } | null;
  }> | null;
  pph_paid_amount?: number | null;
  voucher_allocations?: Array<{
    id: string;
    allocated_amount: number;
    payment_kind?: string | null;
    payment_vouchers?: { voucher_number: string; payment_date: string } | null;
  }> | null;
  suppliers?: { id: string; company_name: string } | null;
}

const getExpenseCurrency = (expense: FinanceExpense): string =>
  resolveTransactionCurrency({
    ...expense,
    bank_accounts: expense.bank_accounts
      ?? expense.bank_statement_lines?.[0]?.bank_accounts,
  });

interface Supplier {
  id: string;
  company_name: string;
  pkp_status: boolean;
  payment_terms_days: number | null;
  default_expense_category: string | null;
  default_pph_code_id: string | null;
  tax_preference: 'none' | 'ppn_only' | 'ppn_pph' | 'pph_only' | null;
  supplier_type?: string | null;
}

interface Batch {
  id: string;
  batch_number: string;
}

interface ImportContainer {
  id: string;
  container_ref: string;
}

interface DeliveryChallan {
  id: string;
  challan_number: string;
  challan_date: string;
  customers?: {
    company_name: string;
  } | null;
}

interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  alias: string | null;
  currency: string;
}

interface TaxCode {
  id: string;
  code: string;
  name: string;
  rate: number;
  tax_type: string;
}

interface COAAccount {
  id: string;
  code: string;
  name: string;
}

interface ExpenseManagerProps {
  canManage: boolean;
  initialViewExpenseId?: string | null;
  onInitialViewHandled?: () => void;
  onSettleBill?: (bill: { id: string; supplier_id: string | null; staff_id: string | null; balance_amount: number }) => void;
  onViewPaymentVoucher?: (paymentVoucherId: string) => void;
}

export function ExpenseManager({ canManage, initialViewExpenseId, onInitialViewHandled, onSettleBill, onViewPaymentVoucher }: ExpenseManagerProps) {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const isAdmin = profile?.role === 'admin';
  // Locally shadow the module-scope expenseCategories with a translated version.
  // Keeps the rest of the file (10+ references) working unchanged.
  const expenseCategories = useMemo(
    () => moduleExpenseCategories.map(c => ({
      ...c,
      label: t(`finance.expense.categories.${c.value}.label`) || c.label,
    })),
    [t]
  );
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [rejectionTarget, setRejectionTarget] = useState<{ id: string; type: 'expense' } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [cancelPostingModalOpen, setCancelPostingModalOpen] = useState(false);
  const [cancelPostingTarget, setCancelPostingTarget] = useState<FinanceExpense | null>(null);
  const [cancelPostingReason, setCancelPostingReason] = useState('');
  const [cancelPostingLoading, setCancelPostingLoading] = useState(false);
  const [expenses, setExpenses] = useState<FinanceExpense[]>([]);
  const [, setBatches] = useState<Batch[]>([]);
  const [containers, setContainers] = useState<ImportContainer[]>([]);
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [reconciledExpenseIds, setReconciledExpenseIds] = useState<Set<string>>(new Set());
  const [selectedBankTransactionId, setSelectedBankTransactionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FinanceExpense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<FinanceExpense | null>(null);
  const [salaryAdvanceApplications, setSalaryAdvanceApplications] = useState<Array<{
    application_id: string;
    advance_payment_voucher_id: string;
    advance_voucher_number: string | null;
    settlement_payment_voucher_id: string;
    settlement_voucher_number: string | null;
    applied_amount: number;
    applied_at: string;
  }>>([]);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [linkedDCQuickView, setLinkedDCQuickView] = useState<{ challan: any; items: any[] } | null>(null);
  const [linkedDCQuickViewLoading, setLinkedDCQuickViewLoading] = useState(false);
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});
  const [filterType, setFilterType] = useState<'all' | 'import' | 'sales' | 'staff' | 'operations' | 'admin'>('all');
  const [reconFilter, setReconFilter] = useState<'all' | 'reconciled' | 'not_reconciled'>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'approved' | 'pending_approval'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [showPasteHint, setShowPasteHint] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [coaAssets, setCoaAssets] = useState<COAAccount[]>([]);
  // Supplier state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<DocumentType | ''>('');
  const [brokerItems, setBrokerItems] = useState<BrokerItem[]>([]);
  // Category-driven pickers (2026-07-08) — Staff Master + Utility Master.
  // These are pure UI selectors; the underlying finance_expenses.supplier_id
  // column stays as-is (utilities resolve through the linked supplier;
  // staff rows leave supplier_id null and prefix the description with the
  // staff name for traceability).
  const [staffRoster, setStaffRoster] = useState<Array<{ id: string; full_name: string; department: string | null; default_gl_code: string | null }>>([]);
  const [utilityRoster, setUtilityRoster] = useState<Array<{ id: string; provider_name: string; utility_type: string; supplier_id: string | null; default_gl_code: string | null }>>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [salaryAdvances, setSalaryAdvances] = useState<Array<{
    advance_id: string;
    voucher_number: string;
    voucher_date: string;
    amount: number;
    applied_amount: number;
    available_amount: number;
  }>>([]);
  const [applySalaryAdvance, setApplySalaryAdvance] = useState(true);
  const [selectedUtilityId, setSelectedUtilityId] = useState<string>('');
  const [periodLabel, setPeriodLabel] = useState<string>('');   // Salary Month / Billing Month
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  // Quick Add Supplier modal
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
  const [quickAddSupplierName, setQuickAddSupplierName] = useState('');
  const [quickAddSupplierLoading, setQuickAddSupplierLoading] = useState(false);
  const [quickAddSupplierType, setQuickAddSupplierType] = useState('General');
  const [quickAddSupplierPKP, setQuickAddSupplierPKP] = useState(false);
  const [quickAddSupplierTerms, setQuickAddSupplierTerms] = useState(30);
  // Attachments collapse
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  // Health Check panel
  const [healthCheckOpen, setHealthCheckOpen] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  interface HealthIssue { key: string; label: string; count: number; severity: 'error' | 'warning' | 'info' }
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);

  // Use master date range from Finance context
  const { dateRange } = useFinance();
  const startDate = dateRange.startDate;
  const endDate = dateRange.endDate;

  const [formData, setFormData] = useState({
    expense_category: 'other',
    amount: 0,
    transaction_currency: 'IDR' as 'IDR' | 'USD',
    exchange_rate: 1,
    expense_date: new Date().toISOString().split('T')[0],
    description: '',
    batch_id: '',
    import_container_id: '',
    delivery_challan_id: '',
    payment_method: 'bank_transfer' as string | null,
    bank_account_id: '',
    payment_reference: '',
    document_urls: [] as string[],
    // New supplier invoice fields
    supplier_id: '',
    invoice_number: '',
    due_date: '',
    // PIB Import breakdown (only used when expense_category = 'pib_import')
    pib_bm_amount: 0,
    pib_ppn_amount: 0,
    pib_pph_amount: 0,
    // Non-PIB tax fields
    ppn_amount: 0,
    // Task 2 (2026-07-06): TRUE once the user has manually edited ppn_amount.
    // Kept for backward compat — new logic below uses ppn_calc_mode instead.
    ppn_manual_override: false,
    // Indonesian PPN calc mode (2026-07-07): standard | dpp_nilai_lain | manual
    ppn_calc_mode: 'standard' as 'standard' | 'dpp_nilai_lain' | 'manual',
    dpp_amount: 0,
    ppn_rate: 11,
    pph_amount: 0,
    pph_code_id: '',
    stamp_duty_amount: 0,
    fixed_asset_account_id: '',
    // Task 5: Utility-only optional bank charges paid alongside the utility bill.
    bank_charges_amount: 0,
  });

  useEffect(() => {
    if (!linkedDCQuickView) return;

    const handleEscapeForLinkedDC = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setLinkedDCQuickView(null);
      }
    };

    document.addEventListener('keydown', handleEscapeForLinkedDC, true);
    return () => document.removeEventListener('keydown', handleEscapeForLinkedDC, true);
  }, [linkedDCQuickView]);

  const openLinkedDCQuickView = async () => {
    if (!viewingExpense?.delivery_challan_id) return;

    setLinkedDCQuickViewLoading(true);
    try {
      const { data: challan, error: challanError } = await supabase
        .from('delivery_challans')
        .select(`*, customers(company_name, address, city, phone, npwp, pharmacy_license, gst_vat_type)`)
        .eq('id', viewingExpense.delivery_challan_id)
        .maybeSingle();

      if (challanError) throw challanError;
      if (!challan) throw new Error('Linked delivery challan not found');

      const { data: items, error: itemsError } = await supabase
        .from('delivery_challan_items')
        .select(`*, products(product_name, product_code, unit), batches(batch_number)`)
        .eq('challan_id', challan.id);

      if (itemsError) throw itemsError;

      setLinkedDCQuickView({ challan, items: items || [] });
    } catch (error) {
      console.error('Error loading linked DC quick view:', error);
      alert('Failed to open Delivery Challan details');
    } finally {
      setLinkedDCQuickViewLoading(false);
    }
  };

  // Initial load + reload when date range changes (loadData itself has no server-side
  // date filter, so reload is only meaningful when other loaders depend on state,
  // but we preserve the original behavior).
  useEffect(() => {
    loadData();
  }, [dateRange]);

  useEffect(() => {
    if (formData.expense_category !== 'salary' || !selectedStaffId) {
      setSalaryAdvances([]);
      setApplySalaryAdvance(true);
      return;
    }
    void supabase.rpc('get_outstanding_salary_advances', {
      p_staff_id: selectedStaffId,
      p_as_of_date: formData.expense_date,
    }).then(({ data, error }) => {
      if (error) {
        // The feature may be awaiting its migration during a rolling deploy.
        console.error('Unable to load salary advances:', error.message);
        setSalaryAdvances([]);
        return;
      }
      setSalaryAdvances((data || []) as typeof salaryAdvances);
      setApplySalaryAdvance(true);
    });
  }, [formData.expense_category, formData.expense_date, selectedStaffId]);

  useEffect(() => {
    if (!viewingExpense || viewingExpense.expense_category !== 'salary') {
      setSalaryAdvanceApplications([]);
      return;
    }
    void supabase.rpc('get_salary_advance_applications', {
      p_salary_expense_id: viewingExpense.id,
    }).then(({ data, error }) => {
      if (error) {
        console.error('Unable to load salary advance applications:', error.message);
        setSalaryAdvanceApplications([]);
        return;
      }
      setSalaryAdvanceApplications((data || []) as typeof salaryAdvanceApplications);
    });
  }, [viewingExpense]);

  // Retry the Staff / Utility load-back after the rosters arrive.
  // handleEdit runs immediately on click; if the rosters were still loading
  // at that moment the picker lookup misses. This effect re-resolves it once
  // the roster fetch settles, without re-parsing the tag.
  useEffect(() => {
    if (!editingExpense) return;
    const rules = getCategoryFieldRules(editingExpense.expense_category);
    const desc = editingExpense.description || '';
    const tagMatch = desc.match(/^\[([^·\]]+?)(?:\s*·\s*([^\]]+))?\]\s*/);
    if (!tagMatch) return;
    const name = tagMatch[1].trim();
    if (rules.staff === 'show' && !selectedStaffId) {
      const s = staffRoster.find(x => x.full_name === name);
      if (s) setSelectedStaffId(s.id);
    } else if (rules.utility === 'show' && !selectedUtilityId) {
      const u = utilityRoster.find(x => x.provider_name === name);
      if (u) setSelectedUtilityId(u.id);
    }
    // Intentional deps: react to roster arrival, not to editingExpense identity churn.
  }, [staffRoster, utilityRoster, editingExpense]);

  // Realtime subscriptions via shared hook. Patch state from payload instead of
  // reloading the entire list.
  const patchExpense = (payload: any) => {
    const evt = payload.eventType;
    if (evt === 'INSERT') {
      // Row is missing joined relations; fall back to a targeted refetch of the row.
      const id = payload.new?.id;
      if (!id) return;
      supabase
        .from('finance_expenses')
        .select(`
          *,
          suppliers(id, company_name),
          batches(batch_number),
          import_containers(container_ref),
          delivery_challans(challan_number),
          bank_accounts(bank_name, account_number, alias, currency),
          bank_statement_lines!bsl_matched_expense_fk(
            id,
            transaction_date,
            description,
            debit_amount,
            credit_amount,
            bank_account_id,
            bank_accounts(bank_name, account_number, alias, currency)
          )
        `)
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setExpenses(prev => (prev.some(e => e.id === id) ? prev : [data as any, ...prev]));
        });
    } else if (evt === 'UPDATE') {
      setExpenses(prev => prev.map(e => (e.id === payload.new.id ? { ...e, ...payload.new } : e)));
    } else if (evt === 'DELETE') {
      setExpenses(prev => prev.filter(e => e.id !== payload.old.id));
    }
  };

  const patchBankLine = (payload: any) => {
    // Reconciled expense-id set only tracks presence — patch the Set accordingly.
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const meid = payload.new?.matched_expense_id;
      if (meid) {
        setReconciledExpenseIds(prev => {
          if (prev.has(meid)) return prev;
          const next = new Set(prev);
          next.add(meid);
          return next;
        });
      } else if (payload.eventType === 'UPDATE') {
        const oldId = payload.old?.matched_expense_id;
        if (oldId) {
          setReconciledExpenseIds(prev => {
            if (!prev.has(oldId)) return prev;
            const next = new Set(prev);
            next.delete(oldId);
            return next;
          });
        }
      }
    } else if (payload.eventType === 'DELETE') {
      const oldId = payload.old?.matched_expense_id;
      if (oldId) {
        setReconciledExpenseIds(prev => {
          if (!prev.has(oldId)) return prev;
          const next = new Set(prev);
          next.delete(oldId);
          return next;
        });
      }
    }
  };

  useSupabaseRealtimeChannel({
    channelName: 'expense_changes_expmgr',
    table: 'finance_expenses',
    onEvent: patchExpense,
  });
  useSupabaseRealtimeChannel({
    channelName: 'bank_lines_expmgr',
    table: 'bank_statement_lines',
    onEvent: patchBankLine,
  });

  // Paste handler for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!modalOpen) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            const fileName = `pasted-image-${Date.now()}.png`;
            const file = new File([blob], fileName, { type: blob.type });
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        setUploadingFiles([...uploadingFiles, ...pastedFiles]);
        setShowPasteHint(true);
        setTimeout(() => setShowPasteHint(false), 2000);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [modalOpen, uploadingFiles]);

  useEffect(() => {
    if (!initialViewExpenseId) return;

    const openExpense = async () => {
      const existing = expenses.find(expense => expense.id === initialViewExpenseId);
      if (existing) {
        setViewingExpense(existing);
        setViewModalOpen(true);
        onInitialViewHandled?.();
        return;
      }

      const { data, error } = await supabase
        .from('finance_expenses')
        .select(`
          *,
          suppliers(id, company_name),
          batches(batch_number),
          import_containers(container_ref),
          delivery_challans(challan_number),
          bank_accounts(bank_name, account_number, alias, currency),
          bank_statement_lines!bsl_matched_expense_fk(
            id,
            transaction_date,
            description,
            debit_amount,
            credit_amount,
            bank_account_id,
            bank_accounts(bank_name, account_number, alias, currency)
          )
        `)
        .eq('id', initialViewExpenseId)
        .maybeSingle();

      if (!error && data) {
        setViewingExpense(data as FinanceExpense);
        setViewModalOpen(true);
      }
      onInitialViewHandled?.();
    };

    openExpense();
  }, [initialViewExpenseId, expenses, onInitialViewHandled]);

  const loadData = async () => {
    try {
      setLoading(true);
      // perf: server-side date filter (was client-side .filter in filteredExpenses).
      let expensesQuery = supabase
        .from('finance_expenses')
        .select(`
          *,
          suppliers(id, company_name),
          batches(batch_number),
          import_containers(container_ref),
          delivery_challans(challan_number),
          bank_accounts(bank_name, account_number, alias, currency),
          bank_statement_lines!bsl_matched_expense_fk(
            id,
            transaction_date,
            description,
            debit_amount,
            credit_amount,
            bank_account_id,
            bank_accounts(bank_name, account_number, alias, currency)
          )
        `)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (startDate) expensesQuery = expensesQuery.gte('expense_date', startDate);
      if (endDate) expensesQuery = expensesQuery.lte('expense_date', endDate);

      const [expensesRes, batchesRes, containersRes, challansRes, banksRes, bankStmtRes] = await Promise.all([
        expensesQuery,
        supabase
          .from('batches')
          .select('id, batch_number')
          .order('batch_number'),
        supabase
          .from('import_containers')
          .select('id, container_ref')
          .order('container_ref'),
        supabase
          .from('delivery_challans')
          .select('id, challan_number, challan_date, customers(company_name)')
          .order('challan_number', { ascending: false })
          .limit(50),
        supabase
          .from('bank_accounts')
          .select('id, bank_name, account_number, alias, currency')
          .order('bank_name'),
        supabase
          .from('bank_statement_lines')
          .select('matched_expense_id')
          .not('matched_expense_id', 'is', null),
      ]);

      if (expensesRes.error) throw expensesRes.error;
      setExpenses(expensesRes.data || []);
      setBatches(batchesRes.data || []);
      setContainers(containersRes.data || []);
      setChallans((challansRes.data || []).map(challan => ({
        ...challan,
        customers: Array.isArray(challan.customers) ? challan.customers[0] || null : challan.customers,
      })));
      setBankAccounts(banksRes.data || []);

      // Build set of reconciled expense IDs
      const reconciledIds = new Set<string>();
      if (bankStmtRes.data) {
        bankStmtRes.data.forEach(line => {
          if (line.matched_expense_id) {
            reconciledIds.add(line.matched_expense_id);
          }
        });
      }
      setReconciledExpenseIds(reconciledIds);

      // Load tax codes (withholding PPh) and asset COA accounts once
      if (taxCodes.length === 0) {
        const { data: tc } = await supabase.from('tax_codes').select('id, code, name, rate, tax_type').eq('is_withholding', true).order('code');
        setTaxCodes(tc || []);
      }
      if (coaAssets.length === 0) {
        const { data: coa } = await supabase.from('chart_of_accounts').select('id, code, name').in('account_type', ['asset', 'Asset']).order('code');
        setCoaAssets(coa || []);
      }
      if (suppliers.length === 0) {
        const { data: sup } = await supabase
          .from('suppliers')
          .select('id, company_name, pkp_status, payment_terms_days, default_expense_category, default_pph_code_id, tax_preference, supplier_type')
          .order('company_name');
        setSuppliers((sup as Supplier[]) || []);
      }
      // Staff Master + Utility Master (dynamic form pickers).
      // Non-blocking — if the tables aren't deployed yet we degrade gracefully.
      if (staffRoster.length === 0) {
        const { data: staff } = await supabase
          .from('finance_staff_master')
          .select('id, full_name, department, default_gl_code')
          .eq('status', 'active')
          .order('full_name');
        if (staff) setStaffRoster(staff);
      }
      if (utilityRoster.length === 0) {
        const { data: utl } = await supabase
          .from('finance_utility_master')
          .select('id, provider_name, utility_type, supplier_id, default_gl_code')
          .eq('status', 'active')
          .order('provider_name');
        if (utl) setUtilityRoster(utl);
      }
    } catch (error: any) {
      console.error('Error loading data:', error.message);
      alert('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  const getSignedUrl = (fileUrl: string): Promise<string> =>
    resolveStorageUrlCached(fileUrl, 3600);

  const openDocument = async (url: string) => {
    const signed = await getSignedUrl(url);
    window.open(signed, '_blank', 'noopener,noreferrer');
  };

  const downloadDocument = async (url: string, filename: string) => {
    try {
      const signed = await getSignedUrl(url);
      const response = await fetch(signed);
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: open directly
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('=== EXPENSE FORM SUBMIT ===');
    console.log('Editing:', !!editingExpense);
    console.log('Files to upload:', uploadingFiles.length);
    console.log('Existing URLs:', formData.document_urls);

    try {
      // Dynamic-form validation — Staff / Utility categories require their
      // respective master row to be picked. Supplier categories keep the
      // existing behaviour (supplier is optional at the DB level).
      const preRules = getCategoryFieldRules(formData.expense_category);
      if (formData.expense_category === 'non_permanent_employee_fee' && selectedSupplier
          && !['employee', 'non-permanent individual', 'freelancer', 'casual worker', 'honorarium recipient']
            .includes((selectedSupplier.supplier_type || '').trim().toLowerCase())) {
        alert('Non-Permanent Employee Fee is intended for an individual subject to PPh 21. Select an Employee, Freelancer, Casual Worker, or Honorarium supplier.');
        return;
      }
      if (preRules.staff === 'show' && !selectedStaffId) {
        alert('Please pick a Staff member for this salary / staff expense.');
        return;
      }
      if (formData.expense_category === 'staff_advance' && !formData.payment_method) {
        alert('A staff advance is money paid out — select how it was paid (it cannot be recorded as an outstanding bill).');
        return;
      }
      if (preRules.utility === 'show' && !selectedUtilityId) {
        alert('Please pick a Utility Provider for this utility expense.');
        return;
      }
      const category = expenseCategories.find(c => c.value === formData.expense_category);

      // PIB Import: validate that the breakdown sums to the payment amount
      if (formData.expense_category === 'pib_import') {
        const breakdown = (formData.pib_bm_amount || 0) + (formData.pib_ppn_amount || 0) + (formData.pib_pph_amount || 0);
        if (Math.abs(breakdown - (formData.amount || 0)) > 1) {
          alert(
            `❌ PIB Breakdown Mismatch\n\n` +
            `BM + PPN + PPh = Rp ${breakdown.toLocaleString('id-ID')}\n` +
            `Payment Amount = Rp ${(formData.amount || 0).toLocaleString('id-ID')}\n\n` +
            `The three components must equal the total payment amount.`
          );
          return;
        }
        if (breakdown === 0) {
          alert('❌ PIB Import requires a breakdown. Please enter BM, PPN, and/or PPh amounts.');
          return;
        }
      }

      // Fixed Asset: account selection is mandatory before save.
      if (formData.expense_category === 'fixed_asset' && !formData.fixed_asset_account_id) {
        alert(
          '❌ Fixed Asset Account Required\n\n' +
          'This expense is categorised as Fixed Asset.\n\n' +
          'Select the Fixed Asset GL account (e.g. Equipment, Furniture, Machinery) ' +
          'before saving. The Journal Entry cannot be generated without it.'
        );
        return;
      }

      // Validate: PPh code is required whenever a PPh amount is entered.
      // pib_import expenses use the pib_pph_amount breakdown field instead.
      if (formData.expense_category !== 'pib_import'
          && (formData.pph_amount || 0) > 0
          && !formData.pph_code_id) {
        alert(
          '❌ PPh Code Required\n\n' +
          'A PPh code must be selected when PPh Withheld is greater than zero.\n\n' +
          'Select the applicable PPh code (e.g. PPh21 Employee, PPh23 Services) ' +
          'so the amount flows correctly into the PPh Register.'
        );
        return;
      }

      // Upload new files first
      const uploadedUrls: string[] = [];
      if (uploadingFiles.length > 0) {
        console.log('=== UPLOADING', uploadingFiles.length, 'FILES ===');

        for (const file of uploadingFiles) {
          console.log('Uploading file:', file.name, '(', file.size, 'bytes)');

          const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const filePath = `${formData.expense_category}/${fileName}`;

          console.log('Storage path:', filePath);

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('expense-documents')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) {
            console.error('Upload error:', uploadError);
            throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
          }

          console.log('Upload successful:', uploadData);

          const { data: { publicUrl } } = supabase.storage
            .from('expense-documents')
            .getPublicUrl(filePath);

          console.log('Public URL:', publicUrl);
          uploadedUrls.push(publicUrl);
        }

        console.log('All uploads complete. Uploaded URLs:', uploadedUrls);
      } else {
        console.log('No new files to upload');
      }

      // Combine existing URLs with newly uploaded ones
      const allDocumentUrls = [...formData.document_urls, ...uploadedUrls];
      console.log('Combined document URLs:', allDocumentUrls);

      // 2026-07 refactor — Broker Invoice amount and reimbursement lines are
      // independent by design (Indonesian brokers issue their own invoice for
      // their fee; reimbursement lines are pass-through sub-supplier invoices).
      // Do NOT validate that lines must sum to invoice amount.

      const isBrokerInvoice = formData.expense_category === 'import_broker';
      const isPib = formData.expense_category === 'pib_import';
      const isFixedAsset = formData.expense_category === 'fixed_asset';
      const isImportCategory = category?.type === 'import';
      // Broker invoices behave like any other supplier invoice at the header
      // level: they own their own PPN / PPh / stamp / DPP-mode. Only pure
      // import cost categories (freight, duty, etc.) still zero out those
      // header tax fields — that logic is unchanged.
      const persistHeaderTax = !isPib && (!isImportCategory || isBrokerInvoice);
      // Dynamic-form prefix — inject Staff / Utility name and period into
      // description for ledger traceability. Prefix is added ONLY when the
      // category dictates and only if the user has not already typed the same
      // value at the start of description.
      const rules = getCategoryFieldRules(formData.expense_category);
      let composedDescription = (formData.description || '').trim();
      if (rules.staff === 'show' && selectedStaffId) {
        const s = staffRoster.find(x => x.id === selectedStaffId);
        if (s) {
          const tag = `[${s.full_name}${periodLabel ? ' · ' + periodLabel : ''}]`;
          if (!composedDescription.startsWith(tag)) composedDescription = `${tag} ${composedDescription}`.trim();
        }
      } else if (rules.utility === 'show' && selectedUtilityId) {
        const u = utilityRoster.find(x => x.id === selectedUtilityId);
        if (u) {
          const tag = `[${u.provider_name}${periodLabel ? ' · ' + periodLabel : ''}]`;
          if (!composedDescription.startsWith(tag)) composedDescription = `${tag} ${composedDescription}`.trim();
        }
      }
      const selectedExpenseBank = bankAccounts.find(bank => bank.id === formData.bank_account_id);
      const transactionCurrency = normalizeCurrency(
        formData.payment_method !== null ? selectedExpenseBank?.currency : formData.transaction_currency,
      ) as 'IDR' | 'USD';
      const exchangeRate = transactionCurrency === 'IDR'
        ? 1
        : (formData.exchange_rate > 1 ? formData.exchange_rate : await getReportingUsdRate());
      const expenseData = {
        expense_category: formData.expense_category,
        expense_type: category?.type || 'admin',
        amount: formData.amount,
        expense_date: formData.expense_date,
        description: composedDescription || null,
        batch_id: formData.batch_id || null,
        import_container_id: formData.import_container_id || null,
        delivery_challan_id: formData.delivery_challan_id || null,
        payment_method: formData.payment_method || null,
        bank_account_id: formData.payment_method && formData.payment_method !== 'outstanding' ? (formData.bank_account_id || null) : null,
        payment_reference: formData.payment_reference || null,
        paid_by: formData.payment_method === null || formData.payment_method === 'outstanding' ? null : 'bank',
        // save_finance_expense expects document_urls to always be a JSON array;
        // null causes jsonb_array_elements_text to fail in the RPC.
        document_urls: allDocumentUrls,
        // Main invoice supplier. NEVER derived from broker_items[i].supplier_id
        // — broker line suppliers are used ONLY for tax invoice / PPN register.
        supplier_id: formData.supplier_id || null,
        // Staff FK (salary / overtime / welfare / advance) — the description
        // prefix stays for ledger traceability, but the FK is authoritative.
        staff_id: rules.staff === 'show' ? (selectedStaffId || null) : null,
        invoice_number: formData.invoice_number || null,
        due_date: formData.due_date || null,
        // Broker items (only for import_broker). Per-line supplier_id inside these
        // items feeds vw_input_ppn_report Branch 5 — the main supplier above is untouched.
        broker_items: isBrokerInvoice && brokerItems.length > 0 ? brokerItems : null,
        // PIB breakdown — only persisted for pib_import category
        pib_bm_amount:  isPib ? (formData.pib_bm_amount  || 0) : null,
        pib_ppn_amount: isPib ? (formData.pib_ppn_amount || 0) : null,
        pib_pph_amount: isPib ? (formData.pib_pph_amount || 0) : null,
        // Non-PIB header tax fields. Broker invoices own their own header tax
        // (independent of reimbursement lines), so persistHeaderTax includes
        // import_broker but excludes pure import cost categories.
        ppn_amount:             persistHeaderTax ? (formData.ppn_amount || 0) : 0,
        ppn_manual_override:    persistHeaderTax ? (formData.ppn_calc_mode === 'manual' || !!formData.ppn_manual_override) : false,
        ppn_calc_mode:          persistHeaderTax ? (formData.ppn_calc_mode || 'standard') : 'standard',
        // Persist header DDP whenever set — used both as the DPP Nilai Lain
        // taxable base AND, for broker invoices, as an independent additive
        // component of Total Payable. Nulled only when the field is empty.
        dpp_amount:             persistHeaderTax && (formData.dpp_amount || 0) > 0 ? (formData.dpp_amount || 0) : null,
        ppn_rate:               persistHeaderTax ? (formData.ppn_rate || 11) : 11,
        pph_amount:             persistHeaderTax ? (formData.pph_amount || 0) : 0,
        pph_code_id:            (persistHeaderTax && formData.pph_code_id) ? formData.pph_code_id : null,
        stamp_duty_amount:      persistHeaderTax ? (formData.stamp_duty_amount || 0) : 0,
        fixed_asset_account_id: isFixedAsset ? (formData.fixed_asset_account_id || null) : null,
        // Task 5: bank charges only for Utility category; all others forced 0
        bank_charges_amount:    formData.expense_category === 'utilities' ? (formData.bank_charges_amount || 0) : 0,
        currency_code: transactionCurrency,
        transaction_currency: transactionCurrency,
        functional_currency: 'IDR' as const,
        exchange_rate: exchangeRate,
        bank_account_currency: selectedExpenseBank?.currency || transactionCurrency,
        payment_currency: transactionCurrency,
      };

      console.log('=== EXPENSE DATA TO SAVE ===');
      console.log('document_urls:', expenseData.document_urls);
      console.log('Full expense data:', expenseData);

      if (editingExpense) {
        // Regular update - bank expenses only (cash expenses go to Petty Cash Manager)
        console.log('=== UPDATING EXPENSE ===');
        console.log('Expense ID:', editingExpense.id);

        await saveFinanceExpense(editingExpense.id, expenseData);

        if (formData.expense_category === 'salary' && selectedStaffId && applySalaryAdvance) {
          const { error: advanceError } = await supabase.rpc('apply_salary_advances_to_expense', {
            p_salary_expense_id: editingExpense.id,
            p_apply: true,
          });
          if (advanceError) throw advanceError;
        }

        console.log('Update successful! Fetching updated data...');

        // Fetch the updated expense with relations
        const { data: updatedExpense, error: fetchError } = await supabase
          .from('finance_expenses')
          .select(`
            *,
            batches (batch_number),
            import_containers (container_ref),
            delivery_challans (challan_number),
            bank_accounts (bank_name, account_number),
            bank_statement_lines!bsl_matched_expense_fk (
              id,
              transaction_date,
              description,
              debit_amount,
              credit_amount,
              bank_account_id,
              bank_accounts (bank_name, account_number)
            )
          `)
          .eq('id', editingExpense.id)
          .single();

        if (fetchError) {
          console.error('Fetch error:', fetchError);
          throw fetchError;
        }

        console.log('=== FETCHED UPDATED EXPENSE ===');
        console.log('document_urls from DB:', updatedExpense.document_urls);
        console.log('Full updated expense:', updatedExpense);

        // Update in local state
        setExpenses(prev => prev.map(exp =>
          exp.id === editingExpense.id ? updatedExpense : exp
        ));

        // Link to bank transaction if selected
        if (selectedBankTransactionId) {
          await approveFinanceExpense(editingExpense.id, profile?.id);
          let linkFailed = false;
          try {
            await linkBankTransaction({
              bankStatementLineId: selectedBankTransactionId,
              matchedExpenseId: editingExpense.id,
              note: `Linked to expense ${updatedExpense.voucher_number || editingExpense.id}`,
            });
          } catch (linkError) {
            linkFailed = true;
            console.error('Error linking to bank transaction:', linkError);
            alert('Expense updated but failed to link to bank transaction. Please link manually from Bank Reconciliation.');
          }

          if (!linkFailed) {
            // Recompute expense paid state so Payment Breakdown matches Bank Reconciliation.
            await supabase.rpc('recalculate_expense_payment_state', { p_expense_id: editingExpense.id });
            // Fetch the expense again to get updated bank_statement_lines
            const { data: refreshedExpense, error: refreshError } = await supabase
              .from('finance_expenses')
              .select(`
                *,
                batches (batch_number),
                import_containers (container_ref),
                delivery_challans (challan_number),
                bank_accounts (bank_name, account_number),
                bank_statement_lines!bsl_matched_expense_fk (
                  id,
                  transaction_date,
                  description,
                  debit_amount,
                  credit_amount,
                  bank_account_id,
                  bank_accounts (bank_name, account_number)
                )
              `)
              .eq('id', editingExpense.id)
              .single();

            if (!refreshError && refreshedExpense) {
              // Update local state with refreshed expense
              setExpenses(prev => prev.map(exp =>
                exp.id === editingExpense.id ? refreshedExpense : exp
              ));

              // Add to reconciled list
              setReconciledExpenseIds(prev => new Set(prev).add(editingExpense.id));
              notifyFinanceReconciliationRefresh();
            }
          }
        }

        alert('Expense updated successfully');
      } else {
        // Create new bank expense - cash expenses should be recorded in Petty Cash Manager
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        console.log('=== CREATING NEW EXPENSE ===');

        const newExpenseId = await saveFinanceExpense(null, { ...expenseData, created_by: user.id });
        if (formData.expense_category === 'salary' && selectedStaffId && applySalaryAdvance) {
          const { error: advanceError } = await supabase.rpc('apply_salary_advances_to_expense', {
            p_salary_expense_id: newExpenseId,
            p_apply: true,
          });
          if (advanceError) throw advanceError;
        }
        const selectClause = `
            *,
            batches (batch_number),
            import_containers (container_ref),
            delivery_challans (challan_number),
            bank_accounts (bank_name, account_number),
            bank_statement_lines!bsl_matched_expense_fk (
              id,
              transaction_date,
              description,
              debit_amount,
              credit_amount,
              bank_account_id,
              bank_accounts (bank_name, account_number)
            )
          `;

        const { data: newExpense, error: insertErr } = await supabase
          .from('finance_expenses').select(selectClause).eq('id', newExpenseId).single();
        if (insertErr) throw insertErr;

        console.log('=== NEW EXPENSE CREATED ===');
        console.log('document_urls from DB:', newExpense?.document_urls);
        console.log('Full new expense:', newExpense);

        // Variable to hold the final expense (may be refreshed if linked to bank)
        let finalExpense = newExpense;

        // Link to bank transaction if selected
        if (selectedBankTransactionId && newExpense) {
          await approveFinanceExpense(newExpense.id, profile?.id);
          let linkFailed = false;
          try {
            await linkBankTransaction({
              bankStatementLineId: selectedBankTransactionId,
              matchedExpenseId: newExpense.id,
              note: `Linked to expense ${newExpense.voucher_number || newExpense.id}`,
            });
          } catch (linkError) {
            linkFailed = true;
            console.error('Error linking to bank transaction:', linkError);
            alert('Expense created but failed to link to bank transaction. Please link manually from Bank Reconciliation.');
          }

          if (!linkFailed) {
            // Recompute expense paid state so Payment Breakdown matches Bank Reconciliation.
            await supabase.rpc('recalculate_expense_payment_state', { p_expense_id: newExpense.id });
            // Fetch the expense again to get updated bank_statement_lines
            const { data: refreshedExpense, error: refreshError } = await supabase
              .from('finance_expenses')
              .select(`
                *,
                batches (batch_number),
                import_containers (container_ref),
                delivery_challans (challan_number),
                bank_accounts (bank_name, account_number),
                bank_statement_lines!bsl_matched_expense_fk (
                  id,
                  transaction_date,
                  description,
                  debit_amount,
                  credit_amount,
                  bank_account_id,
                  bank_accounts (bank_name, account_number)
                )
              `)
              .eq('id', newExpense.id)
              .single();

            if (!refreshError && refreshedExpense) {
              // Use refreshed expense with bank_statement_lines included
              finalExpense = refreshedExpense;

              // Add to reconciled list
              setReconciledExpenseIds(prev => new Set(prev).add(newExpense.id));
              notifyFinanceReconciliationRefresh();
            }
          }
        }

        // Add to local state (with bank link if applicable)
        setExpenses(prev => [finalExpense, ...prev]);
        alert('Expense recorded successfully');
      }

      setModalOpen(false);
      resetForm();
    } catch (error: any) {
      console.error('Error saving expense:', error.message);
      // Show clear error message from backend validation
      const errorMessage = error.message || 'Unknown error occurred';
      if (errorMessage.includes('Import expenses must be linked')) {
        alert('❌ Context Required\n\nImport expenses must be linked to an Import Container.\nPlease select a container before saving.');
      } else {
        alert('Failed to save expense:\n\n' + errorMessage);
      }
    }
  };

  const handleEdit = async (expense: FinanceExpense) => {
    if (expense.approval_status === 'approved') {
      alert('This expense is posted. Cancel Posting first to make changes.');
      return;
    }
    setEditingExpense(expense);

    // Check if expense is reconciled to a bank statement
    const reconciledBankInfo = expense.bank_statement_lines && expense.bank_statement_lines.length > 0
      ? expense.bank_statement_lines[0]
      : null;

    // Use reconciled bank info if available, otherwise use expense's own payment info
    const effectiveBankAccountId = reconciledBankInfo?.bank_account_id || expense.bank_account_id || '';
    const effectivePaymentMethod = reconciledBankInfo?.bank_account_id
      ? 'bank_transfer'
      : (expense.payment_method || 'bank_transfer');

    // Determine document type from category
    const docType = (Object.entries(DOCUMENT_TYPE_GROUPS) as [DocumentType, string[]][])
      .find(([, cats]) => cats.includes(expense.expense_category))?.[0] ?? '' as DocumentType | '';
    setSelectedDocType(docType);

    // Set supplier
    const sup = expense.supplier_id ? suppliers.find(s => s.id === expense.supplier_id) ?? null : null;
    setSelectedSupplier(sup);

    // Set broker items
    setBrokerItems(expense.broker_items ?? []);

    // Dynamic-form load-back — if the expense was saved as Staff or Utility,
    // reconstruct the picker selection + period from the "[Name · Period]"
    // description prefix so the form re-opens in the same state.
    const rules = getCategoryFieldRules(expense.expense_category);
    const desc = expense.description || '';
    const tagMatch = desc.match(/^\[([^·\]]+?)(?:\s*·\s*([^\]]+))?\]\s*/);
    let cleanedDesc = desc;
    let loadedStaffId = '';
    let loadedUtilityId = '';
    let loadedPeriod = '';
    if (tagMatch) {
      const [full, name, period] = tagMatch;
      cleanedDesc = desc.slice(full.length);
      loadedPeriod = (period ?? '').trim();
      if (rules.staff === 'show') {
        const s = staffRoster.find(x => x.full_name === name.trim());
        if (s) loadedStaffId = s.id;
      } else if (rules.utility === 'show') {
        const u = utilityRoster.find(x => x.provider_name === name.trim());
        if (u) loadedUtilityId = u.id;
      }
    }
    // staff_id FK (Phase 2) is authoritative over the description-prefix match
    if (rules.staff === 'show' && expense.staff_id) loadedStaffId = expense.staff_id;
    setSelectedStaffId(loadedStaffId);
    setSelectedUtilityId(loadedUtilityId);
    setPeriodLabel(loadedPeriod);

    setFormData({
      expense_category: expense.expense_category,
      amount: expense.amount,
      transaction_currency: normalizeCurrency(expense.transaction_currency ?? expense.currency_code) as 'IDR' | 'USD',
      exchange_rate: expense.exchange_rate ?? 1,
      expense_date: expense.expense_date,
      description: cleanedDesc,
      batch_id: expense.batch_id || '',
      import_container_id: expense.import_container_id || '',
      delivery_challan_id: expense.delivery_challan_id || '',
      payment_method: effectivePaymentMethod,
      bank_account_id: effectiveBankAccountId,
      payment_reference: expense.payment_reference || '',
      document_urls: expense.document_urls || [],
      supplier_id: expense.supplier_id ?? '',
      invoice_number: expense.invoice_number ?? '',
      due_date: expense.due_date ?? '',
      pib_bm_amount:  expense.pib_bm_amount  ?? 0,
      pib_ppn_amount: expense.pib_ppn_amount ?? 0,
      pib_pph_amount: expense.pib_pph_amount ?? 0,
      ppn_amount: expense.ppn_amount ?? 0,
      ppn_manual_override: expense.ppn_manual_override ?? false,
      // Derive mode when loading pre-existing rows: manual_override was true → 'manual';
      // otherwise fall back to whatever the server tells us, defaulting to 'standard'.
      ppn_calc_mode: (expense.ppn_calc_mode ?? (expense.ppn_manual_override ? 'manual' : 'standard')) as 'standard' | 'dpp_nilai_lain' | 'manual',
      dpp_amount: expense.dpp_amount ?? 0,
      ppn_rate: expense.ppn_rate ?? 11,
      pph_amount: expense.pph_amount ?? 0,
      pph_code_id: expense.pph_code_id ?? '',
      stamp_duty_amount: expense.stamp_duty_amount ?? 0,
      fixed_asset_account_id: expense.fixed_asset_account_id ?? '',
      bank_charges_amount: expense.bank_charges_amount ?? 0,
    });

    // Set selected bank transaction if expense is already linked
    setSelectedBankTransactionId(reconciledBankInfo?.id || '');

    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    try {
      // Reset any bank_statement_lines that link to this expense (or its JE)
      // before we delete. The bsl_matched_expense_fk cascade will null the FK
      // on delete, but leaves reconciliation_status='matched' behind — that
      // is what turns future rows into "Linked (reference unresolved)".
      const { data: expRow } = await supabase
        .from('finance_expenses')
        .select('journal_entry_id')
        .eq('id', id)
        .maybeSingle();

      await supabase
        .from('bank_statement_lines')
        .update({
          matched_expense_id: null,
          reconciliation_status: 'unmatched',
          matched_at: null,
          matched_by: null,
        })
        .eq('matched_expense_id', id);

      if (expRow?.journal_entry_id) {
        await supabase
          .from('bank_statement_lines')
          .update({
            matched_entry_id: null,
            reconciliation_status: 'unmatched',
            matched_at: null,
            matched_by: null,
          })
          .eq('matched_entry_id', expRow.journal_entry_id);
      }

      const { error } = await supabase
        .from('finance_expenses')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Remove from local state
      setExpenses(prev => prev.filter(exp => exp.id !== id));
      alert('Expense deleted successfully');
    } catch (error: any) {
      console.error('Error deleting expense:', error.message);
      alert('Failed to delete expense: ' + error.message);
    }
  };


  const handleApproveExpense = async (id: string) => {
    if (!isAdmin) return;

    // Block approval if this is a fixed_asset expense with no account selected.
    const target = expenses.find(e => e.id === id);
    if (target?.expense_category === 'fixed_asset' && !target.fixed_asset_account_id) {
      alert(
        '❌ Cannot Approve — Fixed Asset Account Missing\n\n' +
        'This expense is categorised as Fixed Asset but no GL account has been selected.\n\n' +
        'Open the expense, select the Fixed Asset Account, save it, then approve.'
      );
      return;
    }

    setApprovalLoading(id);
    try {
      await approveFinanceExpense(id, profile?.id);
      setExpenses(prev => prev.map(e => e.id === id ? { ...e, approval_status: 'approved', approved_by: profile?.id ?? null, approved_at: new Date().toISOString() } : e));
    } catch (err: any) {
      alert('Failed to approve: ' + err.message);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleRejectExpenseConfirm = async () => {
    if (!rejectionTarget || !rejectionReason.trim()) return;
    setApprovalLoading(rejectionTarget.id);
    try {
      const { error } = await supabase
        .from('finance_expenses')
        .update({ approval_status: 'rejected', approved_by: profile?.id, approved_at: new Date().toISOString(), rejection_reason: rejectionReason })
        .eq('id', rejectionTarget.id);
      if (error) throw error;
      setExpenses(prev => prev.map(e => e.id === rejectionTarget.id ? { ...e, approval_status: 'rejected', rejection_reason: rejectionReason } : e));
      setRejectionModalOpen(false);
      setRejectionTarget(null);
      setRejectionReason('');
    } catch (err: any) {
      alert('Failed to reject: ' + err.message);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleCancelPostingConfirm = async () => {
    if (!cancelPostingTarget || !cancelPostingReason.trim()) return;
    setCancelPostingLoading(true);
    try {
      const { error } = await supabase.rpc('cancel_expense_posting', {
        p_exp_id:       cancelPostingTarget.id,
        p_cancelled_by: profile?.id,
        p_reason:       cancelPostingReason,
      });
      if (error) throw error;
      setCancelPostingModalOpen(false);
      setCancelPostingTarget(null);
      setCancelPostingReason('');
      loadData();
    } catch (err) {
      const msg = supabaseErrorMessage(err);
      alert(msg.includes('closed') ? `Period closed: ${msg}` : `Failed to cancel posting: ${msg}`);
    } finally {
      setCancelPostingLoading(false);
    }
  };

  const handleUnlinkFromBankStatement = async (expenseId: string) => {
    if (!confirm(
      'Are you sure you want to unlink this expense from the bank statement?\n\n' +
      'The bank statement line will be set back to "Unmatched" status.'
    )) return;

    try {
      const linkedLine = editingExpense?.bank_statement_lines?.[0];
      if (!linkedLine) throw new Error('Linked bank transaction not found.');
      await unlinkBankTransaction(linkedLine.id);

      // Recompute expense paid state so Payment Breakdown matches Bank Reconciliation.
      await supabase.rpc('recalculate_expense_payment_state', { p_expense_id: expenseId });

      // Fetch the updated expense with relations
      const { data: updatedExpense, error: fetchError } = await supabase
        .from('finance_expenses')
        .select(`
          *,
          batches (batch_number),
          import_containers (container_ref),
          delivery_challans (challan_number),
          bank_accounts (bank_name, account_number),
          bank_statement_lines!bsl_matched_expense_fk (
            id,
            transaction_date,
            description,
            debit_amount,
            credit_amount,
            bank_account_id,
            bank_accounts (bank_name, account_number)
          )
        `)
        .eq('id', expenseId)
        .single();

      if (fetchError) throw fetchError;

      // Update in local state
      setExpenses(prev => prev.map(exp =>
        exp.id === expenseId ? updatedExpense : exp
      ));
      notifyFinanceReconciliationRefresh();

      alert('Expense unlinked from bank statement successfully');
      setModalOpen(false);
      setEditingExpense(null);
      resetForm();
    } catch (error: any) {
      console.error('Error unlinking expense:', error.message);
      alert('Failed to unlink expense: ' + error.message);
    }
  };

  const handleRemoveDocument = (urlToRemove: string) => {
    setFormData({
      ...formData,
      document_urls: formData.document_urls.filter(url => url !== urlToRemove)
    });
  };

  const handleRemoveUploadingFile = (indexToRemove: number) => {
    setUploadingFiles(uploadingFiles.filter((_, index) => index !== indexToRemove));
  };

  const resetForm = () => {
    setEditingExpense(null);
    setUploadingFiles([]);
    setSelectedSupplier(null);
    setSelectedDocType('');
    setBrokerItems([]);
    setSelectedStaffId('');
    setSalaryAdvances([]);
    setApplySalaryAdvance(true);
    setSelectedUtilityId('');
    setPeriodLabel('');
    setFormData({
      expense_category: 'other',
      amount: 0,
      transaction_currency: 'IDR',
      exchange_rate: 1,
      expense_date: new Date().toISOString().split('T')[0],
      description: '',
      batch_id: '',
      import_container_id: '',
      delivery_challan_id: '',
      payment_method: 'bank_transfer',
      bank_account_id: '',
      payment_reference: '',
      document_urls: [],
      supplier_id: '',
      invoice_number: '',
      due_date: '',
      pib_bm_amount: 0,
      pib_ppn_amount: 0,
      pib_pph_amount: 0,
      ppn_amount: 0,
      ppn_manual_override: false,
      ppn_calc_mode: 'standard',
      dpp_amount: 0,
      ppn_rate: 11,
      pph_amount: 0,
      pph_code_id: '',
      stamp_duty_amount: 0,
      fixed_asset_account_id: '',
      bank_charges_amount: 0,
    });
  };

  // Handle supplier selection — auto-fills category, due_date, tax fields
  const handleSupplierSelect = (supplierId: string) => {
    const sup = suppliers.find(s => s.id === supplierId) ?? null;
    setSelectedSupplier(sup);
    setFormData(prev => {
      const updates: Partial<typeof prev> = { supplier_id: supplierId };
      if (sup) {
        // Auto-fill category if supplier has a default
        if (sup.default_expense_category) {
          updates.expense_category = sup.default_expense_category;
          // Also update docType
          const docType = (Object.entries(DOCUMENT_TYPE_GROUPS) as [DocumentType, string[]][])
            .find(([, cats]) => cats.includes(sup.default_expense_category!))?.[0];
          if (docType) setSelectedDocType(docType);
        }
        // Auto-fill PPh code
        if (sup.default_pph_code_id && (sup.tax_preference === 'pph_only' || sup.tax_preference === 'ppn_pph')) {
          updates.pph_code_id = sup.default_pph_code_id;
        }
        // Auto-fill PPN only for PKP suppliers AND when we're in STANDARD calc mode.
        // DPP Nilai Lain and MANUAL modes keep whatever the user has entered.
        const mode = prev.ppn_calc_mode || 'standard';
        if (mode === 'standard' && sup.pkp_status && (sup.tax_preference === 'ppn_only' || sup.tax_preference === 'ppn_pph') && !prev.ppn_manual_override) {
          updates.ppn_amount = calculatePPN(prev.amount, true);
        }
        // Auto-fill due_date from payment terms
        if (prev.expense_date && sup.payment_terms_days) {
          updates.due_date = getDueDateFromTerms(prev.expense_date, sup.payment_terms_days);
        }
      }
      return { ...prev, ...updates };
    });
  };

  // Quick Add Supplier handler
  const handleQuickAddSupplier = async () => {
    if (!quickAddSupplierName.trim()) return;
    setQuickAddSupplierLoading(true);
    try {
      const typeConfig = SUPPLIER_TYPES.find(t => t.value === quickAddSupplierType);
      const { data: newSupplier, error } = await supabase
        .from('suppliers')
        .insert([{
          company_name: quickAddSupplierName.trim(),
          supplier_type: quickAddSupplierType || null,
          pkp_status: quickAddSupplierPKP,
          payment_terms_days: quickAddSupplierTerms,
          tax_preference: typeConfig?.taxPreference ?? 'none',
          default_expense_category: typeConfig?.defaultCategory ?? null,
          country: 'Indonesia',
          is_active: true,
        }])
        .select('id, company_name, pkp_status, payment_terms_days, default_expense_category, default_pph_code_id, tax_preference, supplier_type')
        .single();
      if (error) throw error;
      const sup = newSupplier as Supplier;
      setSuppliers(prev => [...prev, sup].sort((a, b) => a.company_name.localeCompare(b.company_name)));
      setShowQuickAddSupplier(false);
      setQuickAddSupplierName('');
      setQuickAddSupplierType('General');
      setQuickAddSupplierPKP(false);
      setQuickAddSupplierTerms(30);
      // Auto-select the new supplier
      handleSupplierSelect(sup.id);
    } catch (err: any) {
      alert('Failed to add supplier: ' + err.message);
    } finally {
      setQuickAddSupplierLoading(false);
    }
  };

  // Finance Health Check
  const loadHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
        supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).is('payment_method', null).is('supplier_id', null),
        supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).is('payment_method', null).is('due_date', null),
        supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).or('document_urls.is.null,document_urls.eq.{}').gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
        supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('expense_category', 'fixed_asset').is('fixed_asset_account_id', null),
        supabase.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('expense_category', 'import_broker').is('import_container_id', null),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).is('default_expense_category', null).eq('is_active', true),
        supabase.rpc('get_outstanding_expense_bills', { p_as_of_date: today }),
      ]);
      const issues: HealthIssue[] = [
        { key: 'outstanding_no_supplier', label: 'Outstanding bills without supplier', count: r1.count ?? 0, severity: 'warning' },
        { key: 'outstanding_no_due', label: 'Outstanding bills missing due date', count: r2.count ?? 0, severity: 'error' },
        { key: 'no_attachment', label: 'Expenses without attachment (last 90d)', count: r3.count ?? 0, severity: 'info' },
        { key: 'fa_no_account', label: 'Fixed assets without asset account', count: r4.count ?? 0, severity: 'error' },
        { key: 'broker_no_container', label: 'Broker invoices not linked to container', count: r5.count ?? 0, severity: 'warning' },
        { key: 'supplier_no_defaults', label: 'Active suppliers without expense defaults', count: r6.count ?? 0, severity: 'info' },
        { key: 'all_outstanding', label: 'Total outstanding expense bills', count: (r7.data ?? []).length, severity: 'info' },
      ].filter(i => i.count > 0) as HealthIssue[];
      setHealthIssues(issues);
    } catch (err) {
      console.error('Health check failed:', err);
    } finally {
      setHealthLoading(false);
    }
  };

  const selectedCategory = expenseCategories.find(c => c.value === formData.expense_category);
  const requiresContainer = selectedCategory?.type === 'import';
  const requiresDC = selectedCategory?.type === 'sales';

  const filteredExpenses = expenses.filter(exp => {
    // Filter by type
    if (filterType !== 'all') {
      const cat = expenseCategories.find(c => c.value === exp.expense_category);
      if (cat?.type !== filterType) return false;
    }

    // Filter by specific category
    if (categoryFilter !== 'all' && exp.expense_category !== categoryFilter) {
      return false;
    }

    // Filter by supplier
    if (supplierFilter !== 'all') {
      if (supplierFilter === 'no_supplier') {
        if (exp.supplier_id) return false;
      } else {
        if (exp.supplier_id !== supplierFilter) return false;
      }
    }

    // Filter by reconciliation status
    if (reconFilter === 'reconciled') {
      if (!reconciledExpenseIds.has(exp.id)) return false;
    } else if (reconFilter === 'not_reconciled') {
      if (reconciledExpenseIds.has(exp.id)) return false;
    }

    // Filter by approval status
    if (approvalFilter === 'approved') {
      if (exp.approval_status !== 'approved') return false;
    } else if (approvalFilter === 'pending_approval') {
      if (exp.approval_status !== 'pending_approval') return false;
    }

    // perf: date range filtered server-side in loadData().

    return true;
  });

  // Sorting function
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Accountant-priority sort: Pending Approval → Approved+Outstanding → Partial → Paid+Unlinked → Paid+Linked.
  // Only applies when no explicit user sort is active.
  const accountantPriorityRank = (exp: FinanceExpense): number => {
    const isReconciled = exp.bank_statement_lines && exp.bank_statement_lines.length > 0;
    if (exp.approval_status === 'pending_approval') return 0;
    if (exp.approval_status === 'rejected') return 1;
    if (exp.payment_method === null) {
      const balance = (exp.amount || 0) - (exp.paid_amount ?? 0);
      if (balance > 0.01 && (exp.paid_amount ?? 0) > 0) return 2; // Partial
      if (balance > 0.01) return 2; // Approved but Outstanding
      return 3; // Paid (A/P settled)
    }
    if (!isReconciled) return 4; // Paid but Unlinked
    return 5; // Paid & Linked
  };

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    if (!sortConfig) {
      const rankA = accountantPriorityRank(a);
      const rankB = accountantPriorityRank(b);
      if (rankA !== rankB) return rankA - rankB;
      // Secondary: newest first within the same rank
      return new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime();
    }

    const { key, direction } = sortConfig;
    let aValue: any;
    let bValue: any;

    if (key === 'date') {
      aValue = new Date(a.expense_date).getTime();
      bValue = new Date(b.expense_date).getTime();
    } else if (key === 'category') {
      const aCat = expenseCategories.find(c => c.value === a.expense_category);
      const bCat = expenseCategories.find(c => c.value === b.expense_category);
      aValue = aCat?.label?.toLowerCase() || '';
      bValue = bCat?.label?.toLowerCase() || '';
    } else if (key === 'amount') {
      aValue = Number(a.amount) || 0;
      bValue = Number(b.amount) || 0;
    } else if (key === 'description') {
      aValue = (a.description || '').toLowerCase();
      bValue = (b.description || '').toLowerCase();
    } else if (key === 'payment_method') {
      // Sort by payment method (bank expenses only - cash expenses are in Petty Cash)
      aValue = (a.payment_method || 'unknown').toLowerCase();
      bValue = (b.payment_method || 'unknown').toLowerCase();
    } else if (key === 'reconciliation') {
      // Sort by reconciliation status
      const aReconciled = a.bank_statement_lines && a.bank_statement_lines.length > 0;
      const bReconciled = b.bank_statement_lines && b.bank_statement_lines.length > 0;
      aValue = aReconciled ? 1 : 0;
      bValue = bReconciled ? 1 : 0;
    } else if (key === 'payment_status') {
      // Sort by payment status: Outstanding(0) < Partial(1) < Paid(2)
      const payRank = (e: FinanceExpense) => {
        if (e.payment_method !== null) return 2;
        const bal = (e.amount || 0) - (e.paid_amount ?? 0);
        if (bal <= 0.01) return 2;
        if ((e.paid_amount ?? 0) > 0) return 1;
        return 0;
      };
      aValue = payRank(a);
      bValue = payRank(b);
    } else {
      aValue = a[key as keyof FinanceExpense];
      bValue = b[key as keyof FinanceExpense];
      if (typeof aValue === 'string') aValue = aValue.toLowerCase();
      if (typeof bValue === 'string') bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const exportToCSV = () => {
    if (filteredExpenses.length === 0) {
      alert('No expenses to export');
      return;
    }

    const headers = [
      'Number',
      'Type',
      'Date',
      'Category',
      'Description',
      'Linked To',
      'Currency',
      'Amount',
      'Payment Method',
      'Bank Account',
      'Payment Status',
      'Recon Status',
      'Approval Status',
    ];
    const rows = filteredExpenses.map(exp => {
      const category = expenseCategories.find(c => c.value === exp.expense_category);
      const linkedTo =
        exp.import_containers?.container_ref ||
        exp.delivery_challans?.challan_number ||
        '';
      const bankInfo = exp.bank_accounts
        ? (exp.bank_accounts.alias || exp.bank_accounts.bank_name)
        : (exp.bank_statement_lines?.[0]?.bank_accounts?.alias ||
           exp.bank_statement_lines?.[0]?.bank_accounts?.bank_name ||
           '');
      // Payment status (independent of reconciliation)
      let paymentStatus = 'Paid';
      if (exp.payment_method === null) {
        const balance = (exp.amount || 0) - (exp.paid_amount ?? 0);
        if (balance > 0.01 && (exp.paid_amount ?? 0) > 0) paymentStatus = 'Partial';
        else if (balance > 0.01) paymentStatus = 'Outstanding';
      }
      // Recon status (independent of payment)
      const isReconciled = exp.bank_statement_lines && exp.bank_statement_lines.length > 0;
      const reconStatus = isReconciled ? 'Linked' : 'Unlinked';
      return [
        exp.voucher_number || '',
        category?.type || '',
        exp.expense_date,
        category?.label || exp.expense_category,
        (() => {
          const rules = getCategoryFieldRules(exp.expense_category);
          let partyName = '';
          if (rules.staff === 'show' && exp.staff_id) {
            partyName = staffRoster.find(s => s.id === exp.staff_id)?.full_name || '';
          } else if (exp.suppliers) {
            partyName = exp.suppliers.company_name;
          }
          const desc = exp.description || '';
          if (partyName && desc) return `[${partyName}] ${desc}`;
          if (partyName) return `[${partyName}]`;
          return desc;
        })(),
        linkedTo,
        getExpenseCurrency(exp),
        exp.amount.toString(),
        (exp.payment_method || '').replace(/_/g, ' '),
        bankInfo,
        paymentStatus,
        reconStatus,
        exp.approval_status || '',
      ];
    });

    const escape = (cell: string) => `"${String(cell).replace(/"/g, '""')}"`;
    const csvContent = [
      headers.map(escape).join(','),
      ...rows.map(row => row.map(c => escape(String(c))).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `expenses_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'import': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'sales': return 'bg-green-100 text-green-800 border-green-300';
      case 'staff': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'operations': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'admin': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatExpenseTotals = (expensesToTotal: FinanceExpense[]) => {
    const totals = expensesToTotal.reduce<Record<string, number>>((result, expense) => {
      const currency = getExpenseCurrency(expense);
      result[currency] = (result[currency] || 0) + Number(expense.amount || 0);
      return result;
    }, {});
    return Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => formatCurrency(amount, currency, {
        minimumFractionDigits: currency === 'IDR' ? 0 : 2,
        maximumFractionDigits: currency === 'IDR' ? 0 : 2,
      }))
      .join(' · ');
  };

  const expenseFormCurrency = normalizeCurrency(
    bankAccounts.find((bank) => bank.id === formData.bank_account_id)?.currency ?? formData.transaction_currency,
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    const [year, month, day] = dateString.slice(0, 10).split('-');
    return `${day}/${month}/${year?.slice(-2)}`;
  };

  return (
    <div className="space-y-4">
      {/* Compact single-strip header — KPIs + primary actions */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded px-2 py-1 text-white shadow-sm flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-800 whitespace-nowrap">Expenses</h2>
          <div className="flex gap-1.5">
            <div className="bg-white/20 rounded px-1.5 py-0.5">
              <span className="text-blue-100 text-[9px] mr-1">TOTAL</span>
              <span className="text-[11px] font-bold">
                {formatExpenseTotals(filteredExpenses) || formatCurrency(0)}
              </span>
            </div>
            <div className="bg-white/20 rounded px-1.5 py-0.5">
              <span className="text-blue-100 text-[9px] mr-1">LINKED</span>
              <span className="text-[11px] font-bold">
                {expenses.filter(e => reconciledExpenseIds.has(e.id)).length} / {expenses.length}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setHealthCheckOpen(o => !o);
              if (!healthCheckOpen && healthIssues.length === 0) loadHealthCheck();
            }}
            className={`relative inline-flex items-center gap-1 h-6 px-2 rounded font-medium text-[11px] border transition-colors ${healthCheckOpen ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white/95 border-transparent text-gray-700 hover:bg-white'}`}
            title="Finance Health Check"
          >
            <AlertCircle className="w-3 h-3" />
            Health
            {healthIssues.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {healthIssues.length}
              </span>
            )}
          </button>
          {canManage && (
            <button
              onClick={() => { resetForm(); setModalOpen(true); }}
              className="inline-flex items-center gap-1 h-6 px-2 bg-white text-blue-700 rounded font-semibold text-[11px] hover:bg-blue-50"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          )}
        </div>
      </div>

      {/* Compact filter bar (single row) */}
      <div className="bg-white rounded border border-gray-200 px-2 py-1 flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5">
          {[
            { value: 'all', label: 'All' },
            { value: 'import', label: 'Import' },
            { value: 'sales', label: 'Sales' },
            { value: 'staff', label: 'Staff' },
            { value: 'operations', label: 'Ops' },
            { value: 'admin', label: 'Admin' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilterType(tab.value as any)}
              className={`h-6 px-2 rounded text-[11px] font-medium transition-colors ${
                filterType === tab.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-300"></div>

        <div className="flex gap-0.5">
          {[
            { value: 'all', label: 'All' },
            { value: 'reconciled', label: 'Linked' },
            { value: 'not_reconciled', label: 'Unlinked' },
          ].map((filter) => (
            <button
              key={filter.value}
              onClick={() => setReconFilter(filter.value as any)}
              className={`h-6 px-2 rounded text-[11px] font-medium transition-colors ${
                reconFilter === filter.value ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-300"></div>

        <div className="flex gap-0.5">
          {[
            { value: 'all', label: 'All' },
            { value: 'pending_approval', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
          ].map((filter) => (
            <button
              key={filter.value}
              onClick={() => setApprovalFilter(filter.value as any)}
              className={`h-6 px-2 rounded text-[11px] font-medium transition-colors ${
                approvalFilter === filter.value ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-6 px-1.5 border border-gray-300 rounded text-[11px] bg-white"
        >
          <option value="all">All Categories</option>
          {sortExpenseCategories(expenseCategories)
            .map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
        </select>

        {suppliers.length > 0 && (
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-6 px-1.5 border border-gray-300 rounded text-[11px] bg-white"
          >
            <option value="all">All Suppliers</option>
            <option value="no_supplier">— No Supplier —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.company_name}</option>
            ))}
          </select>
        )}

        <button
          onClick={exportToCSV}
          disabled={filteredExpenses.length === 0}
          className="ml-auto inline-flex items-center gap-1 h-6 px-2 bg-green-600 text-white rounded text-[11px] font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          <Download className="w-3 h-3" /> Export ({filteredExpenses.length})
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600">No.</th>
              <th
                onClick={() => handleSort('date')}
                className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
              >
                <div className="flex items-center gap-1">
                  Date
                  {sortConfig?.key === 'date' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('category')}
                className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
              >
                <div className="flex items-center gap-1">
                  Category
                  {sortConfig?.key === 'category' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600">Context</th>
              <th
                onClick={() => handleSort('description')}
                className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
              >
                <div className="flex items-center gap-1">
                  Description
                  {sortConfig?.key === 'description' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('amount')}
                className="px-2 py-1.5 text-right text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
              >
                <div className="flex items-center justify-end gap-1">
                  Amount
                  {sortConfig?.key === 'amount' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-600">Type</th>
              <th
                onClick={() => handleSort('payment_status')}
                className="px-2 py-1.5 text-center text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-center gap-1">
                  Payment
                  {sortConfig?.key === 'payment_status' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('reconciliation')}
                className="px-2 py-1.5 text-center text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-center gap-1">
                  Recon
                  {sortConfig?.key === 'reconciliation' && (
                    <span className="text-blue-600 text-sm">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-600">Approval</th>
              {canManage && <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-600">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={canManage ? 11 : 10} className="px-6 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 11 : 10} className="px-6 py-8 text-center text-gray-500">
                  No expenses found
                </td>
              </tr>
            ) : (
              sortedExpenses.map((expense) => {
                const category = expenseCategories.find(c => c.value === expense.expense_category);

                // Fix: Check reconciliation from actual bank_statement_lines relationship
                const isReconciled = expense.bank_statement_lines && expense.bank_statement_lines.length > 0;

                return (
                  <tr key={expense.id} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="font-mono text-xs text-gray-500">
                        {expense.voucher_number || '—'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="text-xs text-gray-900 font-medium">
                        {formatDate(expense.expense_date)}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-xs font-medium text-gray-900">
                        {category?.label || expense.expense_category}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {expense.import_container_id && expense.import_containers ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Package className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                          <span className="text-blue-700 font-medium">
                            {expense.import_containers.container_ref}
                          </span>
                        </div>
                      ) : expense.delivery_challan_id && expense.delivery_challans ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Truck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                          <span className="text-green-700 font-medium">
                            {expense.delivery_challans.challan_number}
                          </span>
                        </div>
                      ) : category?.requiresContainer ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 rounded">
                          ⚠️ Missing
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-xs text-gray-700 line-clamp-1">
                        {(() => {
                          const rules = getCategoryFieldRules(expense.expense_category);
                          let partyName = '';
                          if (rules.staff === 'show' && expense.staff_id) {
                            partyName = staffRoster.find(s => s.id === expense.staff_id)?.full_name || '';
                          } else if (expense.suppliers) {
                            partyName = expense.suppliers.company_name;
                          }
                          const desc = expense.description || '';
                          if (partyName && desc) return `[${partyName}] ${desc}`;
                          if (partyName) return `[${partyName}]`;
                          return desc || '—';
                        })()}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-right">
                      <div className="text-xs font-semibold text-gray-900">
                        {formatCurrency(expense.amount, getExpenseCurrency(expense), {
                          minimumFractionDigits: getExpenseCurrency(expense) === 'IDR' ? 0 : 2,
                          maximumFractionDigits: getExpenseCurrency(expense) === 'IDR' ? 0 : 2,
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center">
                      <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded ${getTypeColor(category?.type || 'admin')}`}>
                        {category?.type === 'import' && 'CAP'}
                        {category?.type === 'sales' && 'EXP'}
                        {category?.type === 'staff' && 'EXP'}
                        {category?.type === 'operations' && 'EXP'}
                        {category?.type === 'admin' && 'EXP'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center">
                      {(() => {
                        // Payment status — Banknote icon colored by status
                        if (expense.payment_method !== null) {
                          return (
                            <span
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700"
                              title="Paid"
                            >
                              <Banknote className="w-3 h-3" />
                            </span>
                          );
                        }
                        const billBalance = (expense.amount || 0) - (expense.paid_amount ?? 0);
                        if (billBalance <= 0.01) {
                          return (
                            <span
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700"
                              title="Paid"
                            >
                              <Banknote className="w-3 h-3" />
                            </span>
                          );
                        }
                        if ((expense.paid_amount ?? 0) > 0) {
                          return (
                            <span
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100 text-yellow-700"
                              title={`Partial · Paid ${formatCurrency(expense.paid_amount ?? 0, getExpenseCurrency(expense))} of ${formatCurrency(expense.amount || 0, getExpenseCurrency(expense))} · ${formatCurrency(billBalance, getExpenseCurrency(expense))} left`}
                            >
                              <Banknote className="w-3 h-3" />
                            </span>
                          );
                        }
                        return (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700"
                            title="Outstanding"
                          >
                            <Banknote className="w-3 h-3" />
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center">
                      {isReconciled ? (
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700"
                          title="Linked"
                        >
                          <Link2 className="w-3 h-3" />
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-400"
                          title="Unlinked"
                        >
                          <Link2 className="w-3 h-3" />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center">
                      {expense.approval_status === 'approved' ? (
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700"
                          title="Approved"
                        >
                          <ClipboardCheck className="w-3 h-3" />
                        </span>
                      ) : expense.approval_status === 'rejected' ? (
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700"
                          title={`Rejected${expense.rejection_reason ? ': ' + expense.rejection_reason : ''}`}
                        >
                          <ClipboardCheck className="w-3 h-3" />
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100 text-yellow-700"
                          title="Pending"
                        >
                          <ClipboardCheck className="w-3 h-3" />
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-2 py-1.5 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <FinanceActionButton
                            action="view"
                            onClick={async () => {
                              setViewingExpense(expense);
                              setViewModalOpen(true);
                              if (expense.document_urls?.length) {
                                const entries = await Promise.all(
                                  expense.document_urls.map(async (url) => [url, await getSignedUrl(url)] as [string, string])
                                );
                                setSignedUrlCache(prev => ({ ...prev, ...Object.fromEntries(entries) }));
                              }
                            }}
                          />
                          {expense.approval_status !== 'approved' && (
                            <FinanceActionButton action="edit" onClick={() => handleEdit(expense)} />
                          )}
                          {onSettleBill &&
                            expense.payment_method === null &&
                            expense.approval_status === 'approved' &&
                            (expense.supplier_id || expense.staff_id) &&
                            (expense.amount || 0) - (expense.paid_amount ?? 0) > 0.01 && (
                            <button
                              onClick={() => onSettleBill({
                                id: expense.id,
                                supplier_id: expense.supplier_id ?? null,
                                staff_id: expense.staff_id ?? null,
                                balance_amount: (expense.amount || 0) - (expense.paid_amount ?? 0),
                              })}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                              title="Settle via Payment Voucher"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isAdmin && expense.approval_status === 'pending_approval' && (
                            <>
                              <FinanceActionButton
                                action="approve"
                                onClick={() => handleApproveExpense(expense.id)}
                                disabled={approvalLoading === expense.id}
                              />
                              <FinanceActionButton
                                action="reject"
                                onClick={() => { setRejectionTarget({ id: expense.id, type: 'expense' }); setRejectionModalOpen(true); }}
                                disabled={approvalLoading === expense.id}
                              />
                            </>
                          )}
                          {isAdmin && expense.approval_status === 'approved' && (
                            <FinanceActionButton
                              action="reverse"
                              label="Cancel Posting"
                              onClick={() => { setCancelPostingTarget(expense); setCancelPostingReason(''); setCancelPostingModalOpen(true); }}
                            />
                          )}
                          {expense.approval_status !== 'approved' && (
                            <FinanceActionButton action="delete" onClick={() => handleDelete(expense.id)} />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
            {/* Totals Row */}
            {!loading && sortedExpenses.length > 0 && (
              <tr className="bg-gradient-to-r from-blue-50 to-blue-100 border-t-2 border-blue-200 font-bold">
                <td colSpan={5} className="px-2 py-1.5 text-right text-xs text-gray-900">
                  TOTAL ({sortedExpenses.length} expenses):
                </td>
                <td className="px-2 py-1.5 text-right text-sm text-blue-900 font-bold">
                  {formatExpenseTotals(sortedExpenses)}
                </td>
                <td colSpan={canManage ? 5 : 4}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <FinanceModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); resetForm(); }}
          title={editingExpense ? 'Edit Expense' : 'Record New Expense'}
          subtitle={editingExpense?.voucher_number || undefined}
          size="2xl"
          footer={
            <>
              <button type="button" onClick={() => { setModalOpen(false); resetForm(); }} className={F_BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" form="expense-form" className={F_BTN_PRIMARY}>
                {editingExpense ? 'Update' : 'Save'} Expense
              </button>
            </>
          }
        >
          <form id="expense-form" onSubmit={handleSubmit}>
            {/* ══════════════════════════════════════════════════════════════
                 SAP Business One – style header
                 Horizontal-label 3-column grid. Every field is `label | input`
                 on ONE line. Fields flow left-to-right in the 12-col grid.
                 Same handlers as before — pure layout change (STEP 4).
                 ══════════════════════════════════════════════════════════════ */}
            {(() => {
              const rules   = getCategoryFieldRules(formData.expense_category);
              const taxCfg  = selectedDocType ? DOCUMENT_TYPE_TAX_CONFIG[selectedDocType as DocumentType] : null;
              const isBroker = formData.expense_category === 'import_broker';
              const isOverdue = !!formData.due_date && formData.due_date < new Date().toISOString().split('T')[0];
              return (
                <div className="pb-2 mb-2 border-b border-gray-200 flex flex-col gap-1.5">
                  {/* ── Row A: Category · Doc Date · Due Date ── */}
                  <SapRow>
                    <SapField label="Category" required span={4}>
                      <SearchableSelect
                        value={formData.expense_category}
                        onChange={(val) => {
                          const cat = val || '';
                          let dt: DocumentType | '' = '';
                          for (const [docType, cats] of Object.entries(DOCUMENT_TYPE_GROUPS) as [DocumentType, string[]][]) {
                            if (cats.includes(cat)) { dt = docType; break; }
                          }
                          setSelectedDocType(dt);
                          setFormData(prev => ({
                            ...prev,
                            expense_category: cat,
                            ...(cat === 'non_permanent_employee_fee'
                              ? { pph_code_id: taxCodes.find(tc => tc.code === 'PPH21')?.id || prev.pph_code_id }
                              : {}),
                          }));
                        }}
                        options={(Object.entries(DOCUMENT_TYPE_GROUPS) as [DocumentType, string[]][]).flatMap(([docType, cats]) =>
                          cats.map(cat => {
                            const translated = expenseCategories.find(c => c.value === cat)?.label;
                            return { value: cat, label: translated || EXPENSE_CATEGORY_LABELS[cat] || cat, group: docType };
                          })
                        )}
                        placeholder="Select category"
                      />
                    </SapField>
                    <SapField
                      label={rules.billingMonth === 'show' ? 'Billing Date' : 'Doc Date'}
                      required span={4}
                    >
                      <input type="date" value={formData.expense_date}
                        onChange={(e) => {
                          const d = e.target.value;
                          setFormData(prev => ({
                            ...prev, expense_date: d,
                            due_date: selectedSupplier?.payment_terms_days ? getDueDateFromTerms(d, selectedSupplier.payment_terms_days) : prev.due_date,
                          }));
                        }}
                        className={SAP_INPUT} required
                        title={rules.billingMonth === 'show' ? 'Date printed on the utility bill' : undefined} />
                    </SapField>
                    <SapField label="Due Date" span={4}
                      right={isOverdue ? <span className="text-[9px] text-red-600 font-semibold px-1">⚠ Overdue</span> : null}>
                      <input type="date" value={formData.due_date}
                        onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                        className={SAP_INPUT + (isOverdue ? ' !border-red-400 !bg-red-50' : '')} />
                    </SapField>
                  </SapRow>

                  {/* ── Row B: Category-driven picker (Supplier/Staff/Utility) · Inv No · Period ── */}
                  <SapRow>
                    <SapField
                      label={rules.staff === 'show' ? 'Staff' : rules.utility === 'show' ? 'Utility' : (isBroker ? 'Broker' : 'Supplier')}
                      required={rules.staff === 'show' || rules.utility === 'show' || rules.supplier === 'show'}
                      span={4}
                      right={selectedSupplier && rules.staff !== 'show' && rules.utility !== 'show' ? (
                        <div className="flex gap-1 text-[9px] shrink-0">
                          {selectedSupplier.pkp_status && <span className="px-1 py-0.5 bg-green-100 text-green-700 rounded font-medium">PKP</span>}
                          {selectedSupplier.payment_terms_days ? <span className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">N{selectedSupplier.payment_terms_days}</span> : null}
                        </div>
                      ) : null}>
                      {rules.staff === 'show' ? (
                        <SearchableSelect
                          value={selectedStaffId}
                          onChange={(val) => {
                            setSelectedStaffId(val);
                            setFormData(prev => ({ ...prev, supplier_id: '' }));
                            setSelectedSupplier(null);
                          }}
                          options={[{ value: '', label: '— None —' }, ...staffRoster.map(s => ({ value: s.id, label: `${s.full_name}${s.department ? ' · ' + s.department : ''}` }))]}
                          placeholder="Search staff..."
                        />
                      ) : rules.utility === 'show' ? (
                        <SearchableSelect
                          value={selectedUtilityId}
                          onChange={(val) => {
                            setSelectedUtilityId(val);
                            const util = utilityRoster.find(u => u.id === val);
                            if (util?.supplier_id) handleSupplierSelect(util.supplier_id);
                            else { setFormData(prev => ({ ...prev, supplier_id: '' })); setSelectedSupplier(null); }
                          }}
                          options={[{ value: '', label: '— None —' }, ...utilityRoster.map(u => ({ value: u.id, label: `${u.provider_name} · ${u.utility_type}` }))]}
                          placeholder="Search utility..."
                        />
                      ) : (
                        <SearchableSelect
                          value={formData.supplier_id}
                          onChange={(val) => handleSupplierSelect(val)}
                          options={[{ value: '', label: '— None —' }, ...suppliers.map((s) => ({ value: s.id, label: `${s.company_name}${s.pkp_status ? ' ✓PKP' : ''}` }))]}
                          placeholder="Search supplier..."
                          onCreateNew={(name) => { setQuickAddSupplierName(name); setShowQuickAddSupplier(true); }}
                        />
                      )}
                    </SapField>
                    <SapField
                      label={rules.billingMonth === 'show' ? 'Billing Reference' : 'Supplier Invoice Number'}
                      span={4}
                    >
                      <input type="text" value={formData.invoice_number}
                        onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                        className={SAP_INPUT}
                        placeholder={rules.billingMonth === 'show' ? 'Bill number / account ref' : 'Enter invoice number'} />
                    </SapField>
                    {rules.salaryMonth === 'show' ? (
                      <SapField label="Salary Month" required span={4}>
                        <input type="month" value={periodLabel}
                          onChange={(e) => setPeriodLabel(e.target.value)}
                          className={SAP_INPUT} />
                      </SapField>
                    ) : rules.billingMonth === 'show' ? (
                      <SapField label="Billing Month" required span={4}>
                        <input type="month" value={periodLabel}
                          onChange={(e) => setPeriodLabel(e.target.value)}
                          className={SAP_INPUT} title="The month this bill covers" />
                      </SapField>
                    ) : (
                      <SapField label="Reference / Cheque No." span={4}>
                        <input type="text" value={formData.payment_reference}
                          onChange={(e) => setFormData({ ...formData, payment_reference: e.target.value })}
                          className={SAP_INPUT} placeholder="TT ref / cheque #" />
                      </SapField>
                    )}
                  </SapRow>

                  {rules.staff === 'show' && formData.expense_category === 'salary' && selectedStaffId && salaryAdvances.length > 0 && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-amber-900">Outstanding Salary Advance</div>
                          <div className="text-[10px] text-amber-700">Applied oldest first. Any balance beyond this salary remains outstanding.</div>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                          <input
                            type="checkbox"
                            checked={applySalaryAdvance}
                            onChange={(e) => setApplySalaryAdvance(e.target.checked)}
                            className="rounded border-amber-400 text-amber-600"
                          />
                          Apply Advance
                        </label>
                      </div>
                      <div className="mt-2 space-y-1 text-xs">
                        {salaryAdvances.map((advance) => (
                          <div key={advance.advance_id} className="flex items-center justify-between border-t border-amber-100 pt-1 text-amber-900">
                            <span>{advance.voucher_number} · {new Date(advance.voucher_date).toLocaleDateString('en-GB')}</span>
                            <span className="font-mono">Available {formatCurrency(advance.available_amount, expenseFormCurrency)}</span>
                          </div>
                        ))}
                      </div>
                      {applySalaryAdvance && (
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-amber-200 pt-2 text-xs">
                          <div><span className="text-amber-700">Gross Salary</span><div className="font-mono font-semibold text-amber-950">{formatCurrency(formData.amount, expenseFormCurrency)}</div></div>
                          <div><span className="text-amber-700">Less Salary Advance</span><div className="font-mono font-semibold text-amber-950">−{formatCurrency(Math.min(formData.amount || 0, salaryAdvances.reduce((sum, item) => sum + item.available_amount, 0)), expenseFormCurrency)}</div></div>
                          <div><span className="text-amber-700">Net Payable</span><div className="font-mono font-bold text-emerald-800">{formatCurrency(Math.max((formData.amount || 0) - Math.min(formData.amount || 0, salaryAdvances.reduce((sum, item) => sum + item.available_amount, 0)), 0), expenseFormCurrency)}</div></div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Row C: Invoice Amount · Invoice DPP (broker) · PPN · PPh · Stamp · Bank Chg ── */}
                  <SapRow>
                    <SapField label={`${isBroker ? 'Broker Invoice Amount' : 'Amount'} (${expenseFormCurrency})`} required span={4}>
                      <MoneyInput value={formData.amount} required placeholder="0.00"
                        onChange={(amt) => {
                          setFormData(prev => {
                            const mode = prev.ppn_calc_mode || 'standard';
                            const rate = prev.ppn_rate || 11;
                            const ppn = !isBroker && mode === 'standard' && selectedSupplier?.pkp_status
                              ? Math.round(amt * rate / 100) : prev.ppn_amount;
                            const tc = prev.pph_code_id ? taxCodes.find(t => t.id === prev.pph_code_id) : null;
                            const pph = tc ? Math.round(amt * tc.rate / 100) : prev.pph_amount;
                            return { ...prev, amount: amt, ppn_amount: ppn, pph_amount: pph };
                          });
                        }}
                        className={SAP_INPUT + ' !text-right !font-mono !font-semibold'} />
                    </SapField>
                    {isBroker && (
                      <SapField label="Invoice DPP (Tax Base)" span={4}>
                        <MoneyInput value={formData.dpp_amount} placeholder="0.00"
                          onChange={(dpp) => setFormData(prev => {
                            // If a preset PPN rate is active (not manual), recompute PPN from new DPP.
                            const rate = prev.ppn_rate ?? 11;
                            const isManual = prev.ppn_calc_mode === 'manual';
                            const ppn = isManual ? prev.ppn_amount : Math.round(dpp * rate / 100);
                            return { ...prev, dpp_amount: dpp, ppn_amount: ppn };
                          })}
                          className={SAP_INPUT + ' !text-right !font-mono'} />
                      </SapField>
                    )}
                    {taxCfg?.ppn && !isBroker && formData.ppn_calc_mode === 'dpp_nilai_lain' && (
                      <>
                        <SapField label="DPP (Nilai Lain)" span={4}>
                          <MoneyInput value={formData.dpp_amount} placeholder="0"
                            onChange={(dpp) => setFormData(prev => ({ ...prev, dpp_amount: dpp, ppn_amount: Math.round(dpp * (prev.ppn_rate || 11) / 100) }))}
                            className={SAP_INPUT + ' !text-right !font-mono'} />
                        </SapField>
                        <SapField label="PPN" span={4}
                          right={<PpnModeToggle value={formData.ppn_calc_mode} onChange={(mode) => setFormData(prev => {
                            const rate = prev.ppn_rate || 11;
                            let ppn = prev.ppn_amount;
                            if (mode === 'standard') ppn = selectedSupplier?.pkp_status ? Math.round((prev.amount || 0) * rate / 100) : 0;
                            else if (mode === 'dpp_nilai_lain') ppn = Math.round((prev.dpp_amount || 0) * rate / 100);
                            return { ...prev, ppn_calc_mode: mode, ppn_amount: ppn, ppn_manual_override: mode === 'manual', dpp_amount: mode === 'dpp_nilai_lain' ? (prev.dpp_amount || prev.amount || 0) : 0 };
                          })} />}>
                          <MoneyInput value={formData.ppn_amount} placeholder="0"
                            onChange={(v) => setFormData(prev => ({ ...prev, ppn_amount: v }))}
                            className={SAP_INPUT + ' !text-right !font-mono text-blue-700'} />
                        </SapField>
                      </>
                    )}
                    {taxCfg?.ppn && !(formData.ppn_calc_mode === 'dpp_nilai_lain' && !isBroker) && (
                      <>
                        {isBroker && (
                          <SapField label="PPN %" span={4}>
                            <BrokerPpnRateSelector
                              rate={formData.ppn_rate ?? 11}
                              isCustom={formData.ppn_calc_mode === 'manual'}
                              onChange={({ rate, custom }) => setFormData(prev => {
                                const dpp = prev.dpp_amount || 0;
                                if (custom) {
                                  return {
                                    ...prev,
                                    ppn_rate: rate,
                                    ppn_calc_mode: 'manual',
                                    ppn_manual_override: true,
                                  };
                                }
                                return {
                                  ...prev,
                                  ppn_rate: rate,
                                  ppn_calc_mode: 'standard',
                                  ppn_manual_override: false,
                                  ppn_amount: Math.round(dpp * rate / 100),
                                };
                              })}
                            />
                          </SapField>
                        )}
                        <SapField label={isBroker ? 'Invoice PPN' : 'PPN'} span={4}
                          right={!isBroker ? <PpnModeToggle value={formData.ppn_calc_mode} onChange={(mode) => setFormData(prev => {
                            const rate = prev.ppn_rate || 11;
                            let ppn = prev.ppn_amount;
                            if (mode === 'standard') ppn = selectedSupplier?.pkp_status ? Math.round((prev.amount || 0) * rate / 100) : 0;
                            else if (mode === 'dpp_nilai_lain') ppn = Math.round((prev.dpp_amount || 0) * rate / 100);
                            return { ...prev, ppn_calc_mode: mode, ppn_amount: ppn, ppn_manual_override: mode === 'manual', dpp_amount: mode === 'dpp_nilai_lain' ? (prev.dpp_amount || prev.amount || 0) : 0 };
                          })} /> : null}>
                          <MoneyInput value={formData.ppn_amount} placeholder="0.00"
                            readOnly={isBroker && formData.ppn_calc_mode !== 'manual'}
                            onChange={(v) => setFormData(prev => {
                              if (prev.expense_category === 'import_broker') {
                                // Broker: manual-only mode allows edit; preset modes are read-only above.
                                return { ...prev, ppn_amount: v };
                              }
                              return {
                                ...prev,
                                ppn_amount: v,
                                ppn_calc_mode: 'manual',
                                ppn_manual_override: true,
                              };
                            })}
                            className={SAP_INPUT + ' !text-right !font-mono text-blue-700'
                              + (isBroker && formData.ppn_calc_mode !== 'manual' ? ' !bg-gray-100 !text-gray-600' : '')} />
                        </SapField>
                      </>
                    )}
                    {(taxCfg?.pph23 || taxCfg?.pph21) && (
                      <>
                        <SapField label={taxCfg?.pph23 ? 'PPh Withheld' : 'PPh 21'} span={4}>
                          <MoneyInput value={formData.pph_amount} placeholder="0.00"
                            onChange={(v) => setFormData({ ...formData, pph_amount: v })}
                            className={SAP_INPUT + ' !text-right !font-mono text-orange-700'} />
                        </SapField>
                        <SapField label="PPh Code" span={4}>
                          <SearchableSelect
                            value={formData.pph_code_id}
                            onChange={(val) => {
                              const tc = taxCodes.find(t => t.id === val);
                              setFormData(prev => ({
                                ...prev,
                                pph_code_id: val,
                                // Only auto-calc when rate > 0. PPh21 codes carry rate=0 because
                                // the actual withholding is bracket-based and entered manually.
                                // Clearing the code (val='') resets amount to 0.
                                // Preserving the existing amount avoids wiping a manually entered value.
                                pph_amount: !val ? 0 : (tc && tc.rate > 0) ? Math.round(prev.amount * tc.rate / 100) : prev.pph_amount,
                              }));
                            }}
                            options={[{ value: '', label: 'None' }, ...taxCodes.map(tc => ({
                              value: tc.id,
                              label: tc.tax_type === 'PPh21' ? `${tc.code} (Manual)` : `${tc.code} — ${tc.rate}%`,
                            }))]}
                            placeholder="None"
                          />
                        </SapField>
                      </>
                    )}
                    {taxCfg?.stamp && (
                      <SapField label="Stamp Duty" span={4}>
                        <MoneyInput value={formData.stamp_duty_amount} placeholder="0"
                          onChange={(v) => setFormData({ ...formData, stamp_duty_amount: v })}
                          className={SAP_INPUT + ' !text-right !font-mono'} />
                      </SapField>
                    )}
                    {formData.expense_category === 'utilities' && (
                      <SapField label="Bank Charges" span={4}>
                        <MoneyInput value={formData.bank_charges_amount} placeholder="0.00"
                          onChange={(v) => setFormData({ ...formData, bank_charges_amount: v })}
                          className={SAP_INPUT + ' !text-right !font-mono'} />
                      </SapField>
                    )}
                  </SapRow>

                  {/* ── Row D: Contextual — Container · DC · Fixed Asset ── */}
                  {((requiresContainer || isBroker) || requiresDC || formData.expense_category === 'fixed_asset') && (
                    <SapRow>
                      {(requiresContainer || isBroker) && (
                        <SapField label="Import Container" required={requiresContainer} span={4}>
                          <SearchableSelect
                            value={formData.import_container_id}
                            onChange={(val) => setFormData({ ...formData, import_container_id: val })}
                            options={[{ value: '', label: 'Select import container' }, ...containers.map(c => ({ value: c.id, label: c.container_ref }))]}
                            placeholder="Select import container"
                          />
                        </SapField>
                      )}
                      {requiresDC && (
                        <SapField label="DC" span={4}>
                          <SearchableSelect
                            value={formData.delivery_challan_id}
                            onChange={(val) => setFormData({ ...formData, delivery_challan_id: val })}
                            options={[{ value: '', label: 'None' }, ...challans.map(ch => ({ value: ch.id, label: `${ch.challan_number} — ${new Date(ch.challan_date).toLocaleDateString('en-GB')} — ${ch.customers?.company_name || ''}` }))]}
                            placeholder="None"
                          />
                        </SapField>
                      )}
                      {formData.expense_category === 'fixed_asset' && (
                        <SapField label="Asset Acct" required span={4}>
                          <SearchableSelect
                            value={formData.fixed_asset_account_id}
                            onChange={(val) => setFormData({ ...formData, fixed_asset_account_id: val })}
                            options={[{ value: '', label: 'Select account' }, ...coaAssets.map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }))]}
                            placeholder="Select account"
                          />
                        </SapField>
                      )}
                    </SapRow>
                  )}

                  {/* ── Row E: Description (full width) ── */}
                  <SapRow>
                    <SapField label="Invoice Description" span={12}>
                      <input type="text" value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className={SAP_INPUT} placeholder="Describe what this invoice covers..." />
                    </SapField>
                  </SapRow>
                </div>
              );
            })()}

            {/* ── Tax Section (conditional, full width) ── */}
            {selectedDocType && (() => {
              const taxCfg = DOCUMENT_TYPE_TAX_CONFIG[selectedDocType as DocumentType];
              if (!taxCfg || (!taxCfg.ppn && !taxCfg.pph23 && !taxCfg.pph21 && !taxCfg.stamp && !taxCfg.pib && !taxCfg.brokerItems)) return null;
              return (
                <div className="py-2 border-b">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Tax</p>

                  {/* PIB Breakdown */}
                  {taxCfg.pib && (() => {
                    const pibSum = (formData.pib_bm_amount || 0) + (formData.pib_ppn_amount || 0) + (formData.pib_pph_amount || 0);
                    const pibOk = Math.abs(pibSum - (formData.amount || 0)) < 1 && pibSum > 0;
                    return (
                      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-2.5">
                        <div className="text-xs font-semibold text-amber-800 mb-2">PIB Tax Breakdown — must sum to invoice amount</div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          {([
                            { key: 'pib_bm_amount' as const, label: 'Import Duty (BM)', hint: 'DR 5200 Landed Cost' },
                            { key: 'pib_ppn_amount' as const, label: 'PPN Import', hint: 'DR 1150 Input VAT' },
                            { key: 'pib_pph_amount' as const, label: 'PPh 22 Import', hint: 'DR 1155 Prepaid Tax' },
                          ] as const).map(({ key, label, hint }) => (
                            <div key={key}>
                              <label className="block text-[10px] font-semibold text-amber-900 mb-0.5">{label}</label>
                              <MoneyInput value={formData[key]} placeholder="0"
                                onChange={(v) => setFormData({ ...formData, [key]: v })}
                                className="w-full px-2 py-1 border border-amber-300 rounded text-xs bg-white text-right font-mono" />
                              <p className="text-[9px] text-amber-700 mt-0.5">{hint}</p>
                            </div>
                          ))}
                        </div>
                        <div className={`flex items-center justify-between px-2 py-1 rounded text-xs font-medium ${pibOk ? 'bg-green-50 border border-green-300 text-green-800' : pibSum > 0 ? 'bg-red-50 border border-red-300 text-red-800' : 'bg-amber-100 border border-amber-300 text-amber-800'}`}>
                          <span>BM + PPN + PPh = Rp {pibSum.toLocaleString('id-ID')}</span>
                          <span>{pibOk ? '✓ Matches' : formData.amount > 0 ? `Diff: Rp ${Math.abs(pibSum - formData.amount).toLocaleString('id-ID')}` : ''}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ══════════════════════════════════════════════════════════════
                       BROKER CALCULATION ENGINE — 2026-07-08 spec
                       ══════════════════════════════════════════════════════════════
                       Broker Invoice, Header DDP, and every Reimbursement Line are
                       INDEPENDENT inputs. NOTHING rolls up into anything else.
                       They only meet inside the Total Payable formula.

                       Line columns (per user brief):
                         # | Supplier | Invoice No | Tax Inv # | Inv Date |
                         Amount | DDP | PPN% | PPN Amount | Total | Delete

                       Per-line formulas:
                         PPN Amount (Auto)  = round(DDP × PPN%)
                         PPN Amount (Manual) = user-typed value; NOT overwritten
                         Line Total          = Amount + DDP + PPN Amount

                       Auto vs Manual (Excel semantics, per row):
                         • Editing DDP or PPN%   → Auto (recompute PPN Amount).
                         • Editing PPN Amount    → Manual (freeze PPN Amount).
                         • ppn_mode: 'auto' | 'manual' — persisted per line via a
                           dedicated `ppn_treatment` alias to avoid a schema change.

                       Total Payable:
                         Broker Invoice          (header, independent)
                         + Header DDP            (header, independent)
                         + Σ Line.Amount         (all lines)
                         + Σ Line.DDP            (all lines)
                         + Σ Line.PPN Amount     (all lines)
                         + Broker PPN            (header, independent)
                         − Broker PPh            (header, independent)
                         + Broker Stamp Duty     (header, independent)
                     ══════════════════════════════════════════════════════════════ */}
                  {taxCfg.brokerItems && (() => {
                    // ─── updateLine — pure line mutator, NEVER touches header state.
                    const updateLine = (idx: number, patch: Partial<BrokerItem>) => {
                      setBrokerItems(prev => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const merged = { ...it, ...patch };
                        const inManualMode = merged.ppn_treatment === 'included'; // 'included' = manual PPN flag (repurposed to avoid new schema field)
                        const explicitPpn = 'ppn_amount' in patch;
                        const dppChanged  = 'dpp_amount' in patch;
                        const rateChanged = 'ppn_rate' in patch;
                        // Rule 1: user typed a PPN Amount directly → flip row to manual.
                        if (explicitPpn) {
                          merged.ppn_treatment = 'included';
                        }
                        // Rule 2: user edited DDP or % → flip row BACK to auto and recompute.
                        else if (dppChanged || rateChanged) {
                          merged.ppn_treatment = 'excluded';
                          const dpp = merged.dpp_amount ?? 0;
                          const rate = merged.ppn_rate ?? 0;
                          merged.ppn_amount = Math.round(dpp * rate / 100);
                        }
                        // Rule 3: auto-mode row with no explicit patch → keep formula alive
                        // if amount changes. We do NOT auto-seed DDP from Amount (they're
                        // independent per the user's brief). Legacy fallback preserved.
                        else if (!inManualMode && 'amount' in patch && merged.dpp_amount == null && merged.ppn_rate == null) {
                          merged.ppn_amount = computeBrokerLinePpn(merged.amount, merged.ppn_treatment);
                        }
                        return merged;
                      }));
                      // NO setFormData here. Header stays put by construction.
                    };
                    const addLine = () => setBrokerItems(prev => [...prev, {
                      type: 'other', description: '', amount: 0,
                      supplier_id: null, invoice_number: '',
                      tax_invoice_number: '', invoice_date: '',
                      ppn_treatment: 'excluded', ppn_amount: 0,
                      dpp_amount: 0, ppn_rate: 11,
                    } as BrokerItem]);
                    const removeLine = (idx: number) => setBrokerItems(prev => prev.filter((_, i) => i !== idx));

                    // ─── Read-only derivations — never written back to state ───
                    const brokerTotals = calculateBrokerExpenseTotals({ ...formData, broker_items: brokerItems });
                    const {
                      brokerInvoiceAmount,
                      reimbursementTotal: reimbAmount, reimbursementDpp: reimbDpp,
                      reimbursementPpn: reimbPpn,
                      totalPpn, pphWithheld: parentPph, stampDuty: parentStamp,
                    } = brokerTotals;
                    const fmt = (n: number) => formatCurrency(n, expenseFormCurrency, {
                      minimumFractionDigits: expenseFormCurrency === 'IDR' ? 0 : 2,
                      maximumFractionDigits: expenseFormCurrency === 'IDR' ? 0 : 2,
                    });
                    // Excel density — 10 data cells per row + delete.
                    const cellInputCls = 'w-full h-[26px] px-1 border-0 focus:ring-1 focus:ring-blue-400 focus:outline-none rounded-none text-[10px] bg-transparent';
                    // # | Supplier | Inv# | Tax Inv# | Inv Date | Amount | DDP | PPN% | PPN Amt | Total | Del
                    const grid = 'grid grid-cols-[24px_minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_52px_minmax(0,1.3fr)_minmax(0,1.3fr)_28px]';
                    return (
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[11px] text-gray-500">
                            <span className="font-semibold text-gray-800 text-sm">Reimbursement Lines</span>
                            <span className="ml-2">Sub-suppliers only affect the Input PPN report — parent supplier stays as the payable.</span>
                          </div>
                          <button type="button" onClick={addLine}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:text-blue-900">
                            <Plus className="w-3.5 h-3.5" /> Add Line
                          </button>
                        </div>

                        {brokerItems.length > 0 && (
                          <div className="border border-gray-300 rounded-md bg-white shadow-sm overflow-x-auto">
                            {/* Header row */}
                            <div className={`${grid} bg-gray-100 border-b border-gray-300 text-[10px] font-semibold text-gray-600 uppercase tracking-wide`}>
                              <div className="px-1 py-1 border-r border-gray-300 text-center">#</div>
                              <div className="px-1.5 py-1 border-r border-gray-300">Supplier</div>
                              <div className="px-1.5 py-1 border-r border-gray-300">Invoice Number</div>
                              <div className="px-1.5 py-1 border-r border-gray-300">Tax Invoice #</div>
                              <div className="px-1.5 py-1 border-r border-gray-300">Invoice Date</div>
                              <div className="px-1.5 py-1 border-r border-gray-300 text-right">Amount</div>
                              <div className="px-1.5 py-1 border-r border-gray-300 text-right">DPP</div>
                              <div className="px-1 py-1 border-r border-gray-300 text-center">PPN %</div>
                              <div className="px-1.5 py-1 border-r border-gray-300 text-right">PPN Amount</div>
                              <div className="px-1.5 py-1 border-r border-gray-300 text-right">Line Total</div>
                              <div className="px-0.5 py-1 text-center">✕</div>
                            </div>
                            {brokerItems.map((item, idx) => {
                              // Line Total (per user brief) = Amount + DDP + PPN Amount.
                              // NO conditionals — every line uses the same formula so what the
                              // user sees is what the Payable calc uses.
                              const lineTotal = brokerLineTotal(item);
                              const rateDisplay = item.ppn_rate ?? 0;
                              const isManual = item.ppn_treatment === 'included';
                              return (
                                <div key={idx}
                                  className={`${grid} items-stretch border-b border-gray-200 last:border-b-0 hover:bg-blue-50/40 group`}>
                                  <div className="border-r border-gray-200 flex items-center justify-center h-[26px] text-[10px] text-gray-500 font-medium">
                                    {idx + 1}
                                  </div>
                                  {/* Supplier */}
                                  <div className="border-r border-gray-200 [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!shadow-none [&_button]:!bg-transparent [&_button]:!h-[30px] [&_button]:!py-0 [&_button]:!px-2 [&_button]:!text-[11px]">
                                    <SearchableSelect
                                      value={item.supplier_id || ''}
                                      onChange={(val) => updateLine(idx, { supplier_id: val || null })}
                                      options={[
                                        { value: '', label: '— None —' },
                                        ...suppliers.map(s => ({ value: s.id, label: `${s.company_name}${s.pkp_status ? ' ✓PKP' : ''}` })),
                                      ]}
                                      placeholder="Search..."
                                    />
                                  </div>
                                  {/* Invoice No */}
                                  <div className="border-r border-gray-200">
                                    <input type="text" value={item.invoice_number || ''}
                                      onChange={(e) => updateLine(idx, { invoice_number: e.target.value })}
                                      className={cellInputCls} placeholder="Enter invoice number" />
                                  </div>
                                  {/* Tax Invoice # (Faktur Pajak) */}
                                  <div className="border-r border-gray-200">
                                    <input type="text" value={item.tax_invoice_number || ''}
                                      onChange={(e) => updateLine(idx, { tax_invoice_number: e.target.value })}
                                      className={cellInputCls} placeholder="Faktur Pajak #" title="Faktur Pajak number" />
                                  </div>
                                  {/* Invoice Date */}
                                  <div className="border-r border-gray-200">
                                    <input type="date" value={item.invoice_date || ''}
                                      onChange={(e) => updateLine(idx, { invoice_date: e.target.value })}
                                      className={cellInputCls + ' font-mono'} title="Select invoice date" />
                                  </div>
                                  {/* Amount — independent input */}
                                  <div className="border-r border-gray-200">
                                    <MoneyInput value={item.amount} placeholder="0.00"
                                      onChange={(amt) => updateLine(idx, { amount: amt })}
                                      className={cellInputCls + ' text-right font-mono'} />
                                  </div>
                                  {/* DPP — independent input; Auto mode PPN recomputes from this */}
                                  <div className="border-r border-gray-200">
                                    <MoneyInput value={item.dpp_amount ?? 0} placeholder="0.00"
                                      onChange={(v) => updateLine(idx, { dpp_amount: v })}
                                      className={cellInputCls + ' text-right font-mono text-gray-700'} />
                                  </div>
                                  {/* PPN % — typing 11 → PPN Amt = DPP × 11% (Auto) */}
                                  <div className="border-r border-gray-200">
                                    <input type="number" min="0" max="100" step="0.5"
                                      value={rateDisplay === 0 ? '' : rateDisplay}
                                      onChange={(e) => {
                                        const rate = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                        updateLine(idx, { ppn_rate: rate });
                                      }}
                                      className={cellInputCls + ' text-center font-mono'} placeholder="0" />
                                  </div>
                                  {/* PPN Amount — editing this flips row to Manual mode */}
                                  <div className="border-r border-gray-200 relative">
                                    <MoneyInput value={item.ppn_amount} placeholder="0.00"
                                      onChange={(v) => updateLine(idx, { ppn_amount: v })}
                                      className={cellInputCls + ` text-right font-mono ${isManual ? 'text-amber-700' : 'text-blue-700'}`}
                                      title={isManual ? 'Manual mode — edit DPP or PPN% to return to Auto' : 'Auto = DPP × PPN%'} />
                                    {isManual && (
                                      <span className="absolute right-1 top-0.5 text-[8px] font-bold text-amber-600 uppercase tracking-wide pointer-events-none">M</span>
                                    )}
                                  </div>
                                  {/* Total = Amount + DDP + PPN (per user brief) */}
                                  <div className="border-r border-gray-200 flex items-center justify-end px-1 h-[26px] font-mono text-[10px] font-semibold text-gray-900">
                                    {lineTotal ? lineTotal.toLocaleString('id-ID') : ''}
                                  </div>
                                  {/* Delete */}
                                  <div className="flex items-center justify-center h-[26px]">
                                    <button type="button" onClick={() => removeLine(idx)}
                                      className="text-red-500 hover:text-red-700 p-0.5" title="Remove line" tabIndex={-1}>
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {/* Footer totals row */}
                            <div className={`${grid} bg-gray-50 border-t border-gray-300 text-[11px] font-semibold text-gray-700`}>
                              <div className="border-r border-gray-300 px-1 py-1 text-center"></div>
                              <div className="border-r border-gray-300 px-1.5 py-1">Reimbursement Total ({brokerItems.length})</div>
                              <div className="border-r border-gray-300 px-1.5 py-1"></div>
                              <div className="border-r border-gray-300 px-1.5 py-1"></div>
                              <div className="border-r border-gray-300 px-1.5 py-1"></div>
                              <div className="border-r border-gray-300 px-1.5 py-1 text-right font-mono text-gray-900">{reimbAmount.toLocaleString('id-ID')}</div>
                              <div className="border-r border-gray-300 px-1.5 py-1 text-right font-mono text-gray-900">{reimbDpp.toLocaleString('id-ID')}</div>
                              <div className="border-r border-gray-300 px-1 py-1"></div>
                              <div className="border-r border-gray-300 px-1.5 py-1 text-right font-mono text-blue-700">{reimbPpn.toLocaleString('id-ID')}</div>
                              <div className="border-r border-gray-300 px-1.5 py-1 text-right font-mono text-gray-900">{(reimbAmount + reimbPpn).toLocaleString('id-ID')}</div>
                              <div></div>
                            </div>
                          </div>
                        )}

                        {/* Payment Summary — Broker Invoice + Header DDP + Reimb Amt + Reimb DDP + PPN − PPh + Stamp = Payable */}
                        {(() => {
                          type FormulaCell = { label: string; value: number; valueColor: string; op?: string };
                          const cells: FormulaCell[] = [
                            { label: 'Broker Invoice Amount', value: brokerInvoiceAmount, valueColor: 'text-gray-900', op: '+' },
                            { label: 'Reimbursement Total',   value: reimbAmount,         valueColor: 'text-gray-900', op: '+' },
                            { label: 'Expense Total',         value: brokerTotals.expenseTotal, valueColor: 'text-gray-900', op: '+' },
                            { label: 'Recoverable PPN',       value: totalPpn,            valueColor: 'text-blue-700', op: '+' },
                            { label: 'PPh Withheld',          value: parentPph,           valueColor: 'text-orange-700', op: '−' },
                            { label: 'Stamp Duty',            value: parentStamp,         valueColor: 'text-gray-900' },
                          ];
                          return (
                            <div className="mt-2">
                              <div className="flex items-stretch border border-gray-200 rounded-lg bg-white overflow-hidden">
                                {cells.map((cell, i) => (
                                  <div key={cell.label} className="flex items-stretch min-w-0">
                                    <div className={`flex flex-col justify-center px-3 py-2 min-w-[90px] ${i < cells.length - 1 ? 'border-r border-gray-200' : ''}`}>
                                      <span className="text-[9px] text-gray-400 font-medium whitespace-nowrap">{cell.label}</span>
                                      <span className={`text-xs font-bold font-mono mt-0.5 ${cell.valueColor}`}>{fmt(cell.value)}</span>
                                    </div>
                                    {cell.op && (
                                      <div className="flex items-center px-1.5 text-xs font-bold text-gray-400 border-r border-gray-200 bg-gray-50 select-none">{cell.op}</div>
                                    )}
                                  </div>
                                ))}
                                <div className="flex items-center px-1.5 text-xs font-bold text-gray-400 bg-gray-50 select-none">=</div>
                                <div className="flex flex-col justify-center px-4 py-2 bg-emerald-50 border-l-2 border-emerald-400 min-w-[110px]">
                                  <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide">FINAL CASH PAYABLE</span>
                                  <span className="text-sm font-bold font-mono text-emerald-900 mt-0.5">{fmt(brokerTotals.finalCashPayable)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {/* Non-broker payment summary — horizontal formula bar */}
                  {formData.expense_category !== 'import_broker' && !taxCfg.pib && (formData.amount > 0 || formData.ppn_amount > 0 || formData.pph_amount > 0 || formData.stamp_duty_amount > 0) && (() => {
                    const totals = calculateExpenseTotals(formData);
                    const bc = totals.bankChargesAmount;
                    const payable = totals.netPayable;
                    const fmt = (n: number) => formatCurrency(n, expenseFormCurrency, {
                      minimumFractionDigits: expenseFormCurrency === 'IDR' ? 0 : 2,
                      maximumFractionDigits: expenseFormCurrency === 'IDR' ? 0 : 2,
                    });
                    type FormulaCell = { label: string; value: number; valueColor: string; op?: string; show: boolean };
                    const cells: FormulaCell[] = [
                      { label: 'Invoice Amount', value: formData.amount || 0, valueColor: 'text-gray-900', op: '+', show: true },
                      { label: 'PPN', value: formData.ppn_amount || 0, valueColor: 'text-blue-700', op: '−', show: (formData.ppn_amount || 0) > 0 },
                      { label: 'PPh Withheld', value: formData.pph_amount || 0, valueColor: 'text-orange-700', op: '+', show: (formData.pph_amount || 0) > 0 },
                      { label: 'Stamp Duty', value: formData.stamp_duty_amount || 0, valueColor: 'text-gray-900', op: '+', show: (formData.stamp_duty_amount || 0) > 0 },
                      { label: 'Bank Charges', value: bc, valueColor: 'text-purple-700', show: bc > 0 },
                    ].filter(c => c.show);
                    return (
                      <div className="mt-2 flex items-stretch border border-gray-200 rounded-lg bg-white overflow-hidden">
                        {cells.map((cell, i) => (
                          <div key={cell.label} className="flex items-stretch min-w-0">
                            <div className={`flex flex-col justify-center px-3 py-2 min-w-[90px] ${i < cells.length - 1 ? 'border-r border-gray-200' : ''}`}>
                              <span className="text-[9px] text-gray-400 font-medium whitespace-nowrap">{cell.label}</span>
                              <span className={`text-xs font-bold font-mono mt-0.5 ${cell.valueColor}`}>{fmt(cell.value)}</span>
                            </div>
                            {cell.op && i < cells.length - 1 && (
                              <div className="flex items-center px-1.5 text-xs font-bold text-gray-400 border-r border-gray-200 bg-gray-50 select-none">{cell.op}</div>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center px-1.5 text-xs font-bold text-gray-400 bg-gray-50 select-none">=</div>
                        <div className="flex flex-col justify-center px-4 py-2 bg-emerald-50 border-l-2 border-emerald-400 min-w-[110px]">
                          <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide">TOTAL PAYABLE</span>
                          <span className="text-sm font-bold font-mono text-emerald-900 mt-0.5">{fmt(payable)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* ── Bottom two-column: Payment (L) + Attachments (R) ── */}
            <div className="grid grid-cols-2 gap-x-6 pt-2">
              {/* LEFT: Payment */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Payment</p>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Method <span className="text-red-500">*</span></label>
                  <select value={formData.payment_method ?? 'outstanding'}
                    onChange={(e) => {
                      const val = e.target.value === 'outstanding' ? null : e.target.value;
                      setFormData(prev => ({ ...prev, payment_method: val, bank_account_id: val ? prev.bank_account_id : '' }));
                      if (!e.target.value || e.target.value === 'outstanding') {
                        setSelectedBankTransactionId('');
                      }
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs" required>
                    <option value="bank_transfer">🏦 Bank Transfer</option>
                    <option value="check">📝 Cheque</option>
                    <option value="giro">📋 Giro</option>
                    <option value="other">📌 Other</option>
                    <option value="outstanding">📋 Outstanding (A/P)</option>
                  </select>
                  {formData.payment_method === null && (
                    <p className="text-[9px] text-amber-700 mt-0.5 font-medium">Posted as A/P 2110 — appears in Payables</p>
                  )}
                </div>

                {formData.payment_method !== null && (
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Bank Account <span className="text-red-500">*</span></label>
                    <select value={formData.bank_account_id}
                      onChange={(e) => {
                        const bank = bankAccounts.find(item => item.id === e.target.value);
                        const currency = normalizeCurrency(bank?.currency) as 'IDR' | 'USD';
                        setFormData({ ...formData, bank_account_id: e.target.value, transaction_currency: currency,
                          exchange_rate: currency === 'IDR' ? 1 : formData.exchange_rate });
                        setSelectedBankTransactionId('');
                      }}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs" required={formData.payment_method !== null}>
                      <option value="">Select account</option>
                      {bankAccounts.map(bank => <option key={bank.id} value={bank.id}>{bank.bank_name} — {bank.alias || bank.account_number}</option>)}
                    </select>
                  </div>
                )}

                {formData.payment_method === null && (
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Transaction Currency <span className="text-red-500">*</span></label>
                    <select value={formData.transaction_currency}
                      onChange={(e) => setFormData({ ...formData,
                        transaction_currency: e.target.value as 'IDR' | 'USD',
                        exchange_rate: e.target.value === 'IDR' ? 1 : formData.exchange_rate })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs">
                      <option value="IDR">IDR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                )}

                {formData.payment_method !== null && formData.bank_account_id && (
                  <BankTransactionLinkField
                    bankAccountId={formData.bank_account_id}
                    selectedTransactionId={selectedBankTransactionId}
                    linkedTransaction={editingExpense?.bank_statement_lines?.[0] || null}
                    currentExpenseId={editingExpense?.id}
                    canUnlink={canManage}
                    onSelect={(transaction) => setSelectedBankTransactionId(transaction.id)}
                    onUnlink={() => handleUnlinkFromBankStatement(editingExpense!.id)}
                  />
                )}

                {formData.payment_method === null && formData.due_date && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                    <span className="font-semibold text-amber-800">Due: </span>
                    <span className="text-amber-900">{formatDate(formData.due_date)}</span>
                    <span className="ml-1.5 text-[9px] text-amber-600">Settle via Payment Voucher</span>
                  </div>
                )}

              </div>

              {/* RIGHT: Attachments */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Attachments</p>
                  <button type="button" onClick={() => setAttachmentsExpanded(e => !e)}
                    className="text-[10px] text-blue-600 hover:text-blue-800">
                    {formData.document_urls.length + uploadingFiles.length > 0
                      ? `${formData.document_urls.length + uploadingFiles.length} file(s) ${attachmentsExpanded ? '▲' : '▼'}`
                      : attachmentsExpanded ? 'Hide ▲' : 'Add files ▼'}
                  </button>
                </div>

                {(attachmentsExpanded || formData.document_urls.length > 0 || uploadingFiles.length > 0) && (
                  <>
                    {formData.document_urls.map((url, i) => (
                      <div key={i} className="flex items-center gap-1.5 p-1.5 bg-green-50 border border-green-200 rounded text-xs">
                        <FileText className="w-3 h-3 text-green-600 flex-shrink-0" />
                        <button type="button" onClick={() => openDocument(url)} className="flex-1 text-green-700 truncate text-left">Doc {i + 1}</button>
                        <button type="button" onClick={() => openDocument(url)} className="p-0.5 text-green-600 hover:bg-green-100 rounded"><ExternalLink className="w-3 h-3" /></button>
                        <button type="button" onClick={() => handleRemoveDocument(url)} className="p-0.5 text-red-600 hover:bg-red-100 rounded"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                    {uploadingFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-1.5 p-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
                        <Upload className="w-3 h-3 text-blue-600 flex-shrink-0" />
                        <span className="flex-1 text-blue-700 truncate">{file.name}</span>
                        <span className="text-[9px] text-blue-500">{(file.size/1024).toFixed(0)}KB</span>
                        <button type="button" onClick={() => handleRemoveUploadingFile(i)} className="p-0.5 text-red-600 hover:bg-red-100 rounded"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                    <div className="border-2 border-dashed border-gray-300 rounded p-3 text-center hover:border-gray-400 transition-colors"
                      onMouseEnter={() => setShowPasteHint(true)} onMouseLeave={() => setShowPasteHint(false)}>
                      <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                        onChange={(e) => { if (e.target.files?.length) setUploadingFiles([...uploadingFiles, ...Array.from(e.target.files)]); }}
                        className="hidden" id="expense-file-upload" />
                      <label htmlFor="expense-file-upload" className="cursor-pointer flex flex-col items-center gap-1">
                        <Upload className="w-5 h-5 text-gray-400" />
                        <span className="text-xs text-blue-600">Click to upload</span>
                      </label>
                      {showPasteHint && (
                        <div className="flex items-center justify-center gap-1 text-[10px] text-green-600 font-medium mt-1 animate-pulse">
                          <Clipboard className="w-3 h-3" /> Ctrl+V paste
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

          </form>
        </FinanceModal>
      )}

      {/* Quick Add Supplier Modal — redesigned with type, PKP, terms */}
      {showQuickAddSupplier && (
        <Modal isOpen={showQuickAddSupplier} onClose={() => { setShowQuickAddSupplier(false); setQuickAddSupplierName(''); }} title="Quick Add Supplier" size="sm">
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Minimum info. Fill full details in Suppliers Master later.</p>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Company Name <span className="text-red-500">*</span></label>
              <input type="text" value={quickAddSupplierName} autoFocus
                onChange={(e) => setQuickAddSupplierName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddSupplier(); } }}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm"
                placeholder="e.g. PT. Mitra Logistik Indonesia" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Supplier Type</label>
              <select value={quickAddSupplierType}
                onChange={(e) => {
                  const st = e.target.value;
                  setQuickAddSupplierType(st);
                  const cfg = SUPPLIER_TYPES.find(t => t.value === st);
                  if (cfg) setQuickAddSupplierTerms(cfg.paymentTerms);
                }}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm">
                {SUPPLIER_TYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
              </select>
              {quickAddSupplierType && (() => {
                const cfg = SUPPLIER_TYPES.find(t => t.value === quickAddSupplierType);
                return cfg ? (
                  <p className="text-[9px] text-gray-500 mt-0.5">→ Tax: {cfg.taxPreference.replace(/_/g,' ')} · Category: {cfg.defaultCategory}</p>
                ) : null;
              })()}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">PKP Registered</label>
                <div className="flex gap-2 mt-1.5">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="radio" name="qs_pkp" checked={quickAddSupplierPKP} onChange={() => setQuickAddSupplierPKP(true)} /> Yes
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="radio" name="qs_pkp" checked={!quickAddSupplierPKP} onChange={() => setQuickAddSupplierPKP(false)} /> No
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Payment Terms (days)</label>
                <input type="number" min="0" value={quickAddSupplierTerms}
                  onChange={(e) => setQuickAddSupplierTerms(parseInt(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => { setShowQuickAddSupplier(false); setQuickAddSupplierName(''); }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleQuickAddSupplier}
                disabled={!quickAddSupplierName.trim() || quickAddSupplierLoading}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" />
                {quickAddSupplierLoading ? 'Adding...' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Finance Health Check slide-over panel */}
      {healthCheckOpen && (
        <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-600" />
              <span className="text-sm font-semibold text-gray-800">Finance Health Check</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadHealthCheck} className="text-xs text-blue-600 hover:text-blue-800" title="Refresh">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setHealthCheckOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {healthLoading ? (
              <div className="text-sm text-gray-500 text-center py-8">Checking...</div>
            ) : healthIssues.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-green-700 font-medium">No issues found</p>
                <p className="text-xs text-gray-400 mt-1">Finance data looks healthy</p>
              </div>
            ) : (
              <div className="space-y-2">
                {healthIssues.map(issue => (
                  <div key={issue.key} className={`flex items-start gap-3 p-2.5 rounded border text-xs ${
                    issue.severity === 'error' ? 'bg-red-50 border-red-200' :
                    issue.severity === 'warning' ? 'bg-amber-50 border-amber-200' :
                    'bg-blue-50 border-blue-200'
                  }`}>
                    <span className={`font-bold text-base leading-none ${
                      issue.severity === 'error' ? 'text-red-600' :
                      issue.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'
                    }`}>{issue.count}</span>
                    <span className={`leading-tight ${
                      issue.severity === 'error' ? 'text-red-800' :
                      issue.severity === 'warning' ? 'text-amber-800' : 'text-blue-800'
                    }`}>{issue.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t text-[10px] text-gray-400 text-center">
            Read-only — no data is modified
          </div>
        </div>
      )}

      {viewModalOpen && viewingExpense && (() => {
        // Currency-aware formatter — resolves from the joined bank account (if the
        // expense was paid from a bank), or falls back to the reconciled bank line's
        // account, or IDR when there's no bank context (petty cash / outstanding).
        // Priority 8 #1: never hardcode Rp.
        const currency = getExpenseCurrency(viewingExpense);
        const fmtMoney = (n: number | null | undefined, decimals: 0 | 2 = 0) => {
          return formatCurrency(n, currency, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          });
        };
        return (
        <Modal
          isOpen={viewModalOpen}
          onClose={() => {
            setViewModalOpen(false);
            setViewingExpense(null);
            setLinkedDCQuickView(null);
          }}
          title="Expense Details"
          size="xl"
        >
          <div className="space-y-3">
            {/* ── Expense Summary (compact single card) ── */}
            <div className="border border-gray-200 rounded-lg bg-white">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Expense Summary</span>
                  {viewingExpense.voucher_number && (
                    <span className="text-[11px] font-mono text-gray-600">{viewingExpense.voucher_number}</span>
                  )}
                </div>
                <span className="text-xs text-gray-700">
                  {formatDate(viewingExpense.expense_date)}
                </span>
              </div>
              <div className="px-3 py-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div>
                  <div className="text-[10px] uppercase font-medium text-gray-400">Category</div>
                  <div className="text-gray-900">
                    {expenseCategories.find(c => c.value === viewingExpense.expense_category)?.label || viewingExpense.expense_category}
                  </div>
                </div>
                {viewingExpense.suppliers && (
                  <div>
                    <div className="text-[10px] uppercase font-medium text-gray-400">Supplier</div>
                    <div className="text-gray-900 font-medium">{viewingExpense.suppliers.company_name}</div>
                  </div>
                )}
                {(() => {
                  const rules = getCategoryFieldRules(viewingExpense.expense_category);
                  if (rules.staff !== 'show' || !viewingExpense.staff_id) return null;
                  const staff = staffRoster.find(s => s.id === viewingExpense.staff_id);
                  if (!staff) return null;
                  return (
                    <div>
                      <div className="text-[10px] uppercase font-medium text-gray-400">Employee</div>
                      <div className="text-gray-900 font-medium">{staff.full_name}</div>
                    </div>
                  );
                })()}
                <div>
                  <div className="text-[10px] uppercase font-medium text-gray-400">Amount</div>
                  <div className="text-base font-bold text-gray-900 font-mono">{fmtMoney(viewingExpense.amount, 2)}</div>
                </div>
                {viewingExpense.invoice_number && (
                  <div>
                    <div className="text-[10px] uppercase font-medium text-gray-400">Invoice No.</div>
                    <div className="text-gray-900 font-mono text-xs">{viewingExpense.invoice_number}</div>
                  </div>
                )}
                {viewingExpense.due_date && (
                  <div>
                    <div className="text-[10px] uppercase font-medium text-gray-400">Due Date</div>
                    <div className="text-gray-900 text-xs">{formatDate(viewingExpense.due_date)}</div>
                  </div>
                )}
                {viewingExpense.payment_reference && (
                  <div>
                    <div className="text-[10px] uppercase font-medium text-gray-400">Reference</div>
                    <div className="text-gray-900 text-xs font-mono">{viewingExpense.payment_reference}</div>
                  </div>
                )}
                {viewingExpense.description && (
                  <div className="col-span-3">
                    <div className="text-[10px] uppercase font-medium text-gray-400">Description</div>
                    <div className="text-gray-900 text-xs whitespace-pre-wrap">{viewingExpense.description}</div>
                  </div>
                )}
              </div>
            </div>

            {viewingExpense.expense_category === 'salary' && salaryAdvanceApplications.length > 0 && (
              <div className="border border-amber-200 rounded-lg bg-amber-50 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-amber-200 text-[10px] font-semibold text-amber-800 uppercase tracking-wide">Salary Advance Applications</div>
                <div className="px-3 py-2 space-y-1 text-xs text-amber-950">
                  {salaryAdvanceApplications.map((application) => (
                    <div key={application.application_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-1 last:border-0 last:pb-0">
                      <span>
                        Advance {application.advance_voucher_number || application.advance_payment_voucher_id} → Settlement {application.settlement_voucher_number || application.settlement_payment_voucher_id}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{fmtMoney(application.applied_amount)}</span>
                        {onViewPaymentVoucher && (
                          <button type="button" onClick={() => onViewPaymentVoucher(application.settlement_payment_voucher_id)} className="text-blue-700 hover:underline">View Payment</button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Tax breakdown (only if non-zero) ── */}
            {viewingExpense.expense_category !== 'import_broker' && (() => {
              // Resolve the PPh code so the withheld row shows WHICH type
              // was deducted (PPh 23 vs PPh 21 vs PPh 4(2), etc.) rather
              // than a bare amount. Falls back gracefully when the code
              // hasn't loaded yet or isn't set.
              const pphCode = viewingExpense.pph_code_id
                ? taxCodes.find(t => t.id === viewingExpense.pph_code_id)
                : null;
              const pphLabel = pphCode
                ? `PPh Withheld · ${pphCode.tax_type}${pphCode.rate ? ` @ ${pphCode.rate}%` : ''}`
                : 'PPh Withheld';
              const rows: Array<[string, number, string]> = [];
              if ((viewingExpense.ppn_amount || 0) > 0) rows.push(['PPN', viewingExpense.ppn_amount || 0, 'text-blue-700']);
              if ((viewingExpense.pph_amount || 0) > 0) rows.push([pphLabel, -(viewingExpense.pph_amount || 0), 'text-orange-700']);
              if ((viewingExpense.stamp_duty_amount || 0) > 0) rows.push(['Stamp Duty', viewingExpense.stamp_duty_amount || 0, 'text-gray-700']);
              if ((viewingExpense.bank_charges_amount || 0) > 0) rows.push(['Bank Charges', viewingExpense.bank_charges_amount || 0, 'text-purple-700']);
              if ((viewingExpense.pib_bm_amount || 0) > 0) rows.push(['Import Duty (BM)', viewingExpense.pib_bm_amount || 0, 'text-amber-700']);
              if ((viewingExpense.pib_ppn_amount || 0) > 0) rows.push(['PPN Import', viewingExpense.pib_ppn_amount || 0, 'text-amber-700']);
              if ((viewingExpense.pib_pph_amount || 0) > 0) rows.push(['PPh 22 Import', viewingExpense.pib_pph_amount || 0, 'text-amber-700']);
              if (rows.length === 0) return null;
              const netPayable = calculateExpenseTotals(viewingExpense).netPayable;
              return (
                <div className="border border-gray-200 rounded-lg bg-white">
                  <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Tax & Charges</div>
                  <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500 text-xs">Invoice</span>
                    <span className="font-mono text-gray-800">{fmtMoney(viewingExpense.amount)}</span>
                    {rows.map(([label, value, tint]) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className="text-gray-400 text-base font-light">{value < 0 ? '−' : '+'}</span>
                        <span className="text-gray-500 text-xs">{label}</span>
                        <span className={`font-mono ${tint}`}>{fmtMoney(Math.abs(value))}</span>
                      </span>
                    ))}
                    <span className="text-gray-400 text-base font-light">=</span>
                    <span className="ml-auto flex items-center gap-1.5 px-2 py-0.5 border border-emerald-300 bg-emerald-50 rounded">
                      <span className="text-[10px] font-semibold text-emerald-700 uppercase">Payable</span>
                      <span className="font-mono font-bold text-emerald-900">{fmtMoney(netPayable, 2)}</span>
                    </span>
                  </div>
                </div>
              );
            })()}

            {viewingExpense.expense_category === 'import_broker' && (() => {
              const totals = calculateBrokerExpenseTotals(viewingExpense);
              const rows: Array<[string, number, string]> = [
                ['Broker Invoice Amount', totals.brokerInvoiceAmount, 'text-gray-900'],
                ['Reimbursement Total', totals.reimbursementTotal, 'text-gray-900'],
                ['Reimbursement DPP', totals.reimbursementDpp, 'text-gray-700'],
                ['Total PPN', totals.totalPpn, 'text-blue-700'],
                ['PPh Withheld', totals.pphWithheld, 'text-orange-700'],
                ['Stamp Duty', totals.stampDuty, 'text-gray-700'],
                ['Expense Total', totals.expenseTotal, 'text-gray-900'],
              ];
              return (
                <div className="border border-gray-200 rounded-lg bg-white">
                  <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Broker Invoice Summary</div>
                  <div className="px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                    {rows.map(([label, value, tint]) => (
                      <div key={label}>
                        <div className="text-[10px] uppercase font-medium text-gray-400">{label}</div>
                        <div className={`font-mono font-semibold ${tint}`}>{fmtMoney(value)}</div>
                      </div>
                    ))}
                    <div className="col-span-2 md:col-span-4 flex items-center justify-between border-t border-gray-100 pt-2">
                      <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Final Cash Payable</span>
                      <span className="font-mono font-bold text-emerald-900">{fmtMoney(totals.finalCashPayable, 2)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Reimbursement Lines (only if broker items exist) ── */}
            {viewingExpense.broker_items && viewingExpense.broker_items.length > 0 && (
              <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Reimbursement Lines</div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Sub-supplier</th>
                      <th className="px-2 py-1 text-left font-medium">Invoice Number</th>
                      <th className="px-2 py-1 text-left font-medium">Tax Invoice Number</th>
                      <th className="px-2 py-1 text-left font-medium">Invoice Date</th>
                      <th className="px-2 py-1 text-right font-medium">Amount</th>
                      <th className="px-2 py-1 text-right font-medium">DPP</th>
                      <th className="px-2 py-1 text-center font-medium">PPN%</th>
                      <th className="px-2 py-1 text-right font-medium">PPN Amt</th>
                      <th className="px-2 py-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingExpense.broker_items.map((item, i) => {
                      const dpp = item.dpp_amount ?? 0;
                      const rate = item.ppn_rate ?? 0;
                      const total = brokerLineTotal(item);
                      const supplierName = item.supplier_id
                        ? suppliers.find(s => s.id === item.supplier_id)?.company_name
                        : null;
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-gray-700 truncate max-w-[160px]">{supplierName || '—'}</td>
                          <td className="px-2 py-1 text-gray-600 font-mono">{item.invoice_number || '—'}</td>
                          <td className="px-2 py-1 text-gray-600 font-mono">{item.tax_invoice_number || '—'}</td>
                          <td className="px-2 py-1 text-gray-600 font-mono">{formatDate(item.invoice_date || '')}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-900">{fmtMoney(item.amount)}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-700">{fmtMoney(dpp)}</td>
                          <td className="px-2 py-1 text-center font-mono text-gray-700">{rate || 0}%</td>
                          <td className="px-2 py-1 text-right font-mono text-blue-700">{fmtMoney(item.ppn_amount || 0)}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-900">{fmtMoney(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Payment Information (only shows fields that exist) ── */}
            {(viewingExpense.payment_method !== undefined || viewingExpense.bank_accounts) && (() => {
              const isOutstanding = viewingExpense.payment_method === null;
              const balance = (viewingExpense.amount || 0) - (viewingExpense.paid_amount ?? 0);
              return (
                <div className="border border-gray-200 rounded-lg bg-white">
                  <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Payment</div>
                  <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px] uppercase font-medium text-gray-400">Method</span>
                      {isOutstanding ? (
                        <span className="px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded">A/P Outstanding</span>
                      ) : (
                        <span className="text-gray-900 capitalize">{viewingExpense.payment_method?.replace('_', ' ')}</span>
                      )}
                    </span>
                    {viewingExpense.bank_accounts && (
                      <span className="flex items-center gap-1">
                        <span className="text-[10px] uppercase font-medium text-gray-400">Bank</span>
                        <span className="text-gray-900 text-xs">
                          {viewingExpense.bank_accounts.alias || viewingExpense.bank_accounts.bank_name} · {viewingExpense.bank_accounts.account_number}
                          {viewingExpense.bank_accounts.currency && viewingExpense.bank_accounts.currency !== 'IDR' && (
                            <span className="ml-1 text-[10px] text-purple-700 font-semibold">({viewingExpense.bank_accounts.currency})</span>
                          )}
                        </span>
                      </span>
                    )}
                    {isOutstanding && (viewingExpense.amount || 0) > 0 && (
                      <span className="ml-auto flex items-center gap-1">
                        <span className="text-[10px] uppercase font-medium text-gray-400">Balance</span>
                        <span className={`font-mono font-bold ${balance > 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {fmtMoney(balance)}
                        </span>
                        {(viewingExpense.paid_amount ?? 0) > 0 && (
                          <span className="text-[10px] text-gray-500">(Paid {fmtMoney(viewingExpense.paid_amount)})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Payment Breakdown — only when >= 1 payment line exists ── */}
            {(() => {
              const allocs = viewingExpense.voucher_allocations || [];
              const bslLines = viewingExpense.bank_statement_lines || [];
              // Only render when there's actual settlement data.
              if (allocs.length === 0 && bslLines.length === 0) return null;
              const supplierTarget = calculateExpenseTotals(viewingExpense).netPayable;
              const supplierPaid = viewingExpense.paid_amount ?? 0;
              const pphTarget = viewingExpense.pph_amount || 0;
              const pphPaid = viewingExpense.pph_paid_amount ?? 0;
              const badge = (paid: number, target: number) => {
                if (target <= 0) return null;
                if (paid <= 0) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Pending</span>;
                if (paid >= target - 1) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Paid ✓</span>;
                return <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">Partial</span>;
              };
              // Hide the supplier row if there's nothing owed (fully unbilled etc).
              const showSupplier = supplierTarget > 0 || supplierPaid > 0;
              const showPph = pphTarget > 0 || pphPaid > 0;
              return (
                <div className="border border-gray-200 rounded-lg bg-white">
                  <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    Payment Breakdown ({allocs.length + bslLines.length} {allocs.length + bslLines.length === 1 ? 'line' : 'lines'})
                  </div>
                  <div className="px-3 py-2 text-sm space-y-1">
                    {showSupplier && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700 text-xs">Supplier</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-900 text-xs">{fmtMoney(supplierPaid)} / {fmtMoney(supplierTarget)}</span>
                          {badge(supplierPaid, supplierTarget)}
                        </div>
                      </div>
                    )}
                    {showPph && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700 text-xs">PPh Withholding</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-900 text-xs">{fmtMoney(pphPaid)} / {fmtMoney(pphTarget)}</span>
                          {badge(pphPaid, pphTarget)}
                        </div>
                      </div>
                    )}
                  </div>
                  {(allocs.length + bslLines.length) > 1 && (
                    <div className="px-3 pb-2">
                      <table className="w-full text-xs">
                        <thead className="text-gray-500 text-[10px] uppercase">
                          <tr className="border-t border-gray-100">
                            <th className="text-left font-medium py-1">Date</th>
                            <th className="text-left font-medium py-1">Ref</th>
                            <th className="text-right font-medium py-1">Amount</th>
                            <th className="text-right font-medium py-1">Kind</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allocs.map((a) => (
                            <tr key={`va-${a.id}`} className="border-t border-gray-100">
                              <td className="py-1 text-gray-700">{a.payment_vouchers?.payment_date ? formatDate(a.payment_vouchers.payment_date) : '—'}</td>
                              <td className="py-1 text-gray-700 font-mono">{a.payment_vouchers?.voucher_number || 'PV'}</td>
                              <td className="py-1 text-right font-mono">{fmtMoney(a.allocated_amount)}</td>
                              <td className="py-1 text-right text-gray-600 capitalize">{a.payment_kind || 'supplier'}</td>
                            </tr>
                          ))}
                          {bslLines.map((b) => {
                            const lineCurrency = b.bank_accounts?.currency ?? currency;
                            const lineAmount = (b.debit_amount || 0) + (b.credit_amount || 0);
                            const fmtLine = (n: number) => formatCurrency(n, lineCurrency, {
                              minimumFractionDigits: lineCurrency === 'IDR' ? 0 : 2,
                              maximumFractionDigits: lineCurrency === 'IDR' ? 0 : 2,
                            });
                            return (
                              <tr key={`bsl-${b.id}`} className="border-t border-gray-100">
                                <td className="py-1 text-gray-700">{formatDate(b.transaction_date)}</td>
                                <td className="py-1 text-gray-700 truncate max-w-[180px]">{b.description || 'Bank'}</td>
                                <td className="py-1 text-right font-mono">{fmtLine(lineAmount)}</td>
                                <td className="py-1 text-right text-gray-600 capitalize">{b.payment_kind || 'supplier'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Context Links — compact inline chips (only when linked) */}
            {(viewingExpense.batches || viewingExpense.import_containers || viewingExpense.delivery_challans) && (
              <div className="border border-gray-200 rounded-lg bg-white px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase font-medium text-gray-400">Linked to</span>
                {viewingExpense.batches && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">
                    <Package className="w-3 h-3" /> Batch {viewingExpense.batches.batch_number}
                  </span>
                )}
                {viewingExpense.import_containers && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">
                    <Package className="w-3 h-3" /> {viewingExpense.import_containers.container_ref}
                  </span>
                )}
                {viewingExpense.delivery_challans && (
                  <button
                    type="button"
                    onClick={openLinkedDCQuickView}
                    disabled={linkedDCQuickViewLoading}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 disabled:opacity-50"
                  >
                    <Truck className="w-3 h-3" /> DC {viewingExpense.delivery_challans.challan_number}
                    {linkedDCQuickViewLoading && ' …'}
                  </button>
                )}
              </div>
            )}

            {linkedDCQuickView && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-lg bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h4 className="text-base font-semibold text-gray-900">
                      Delivery Challan {linkedDCQuickView.challan.challan_number}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setLinkedDCQuickView(null)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-4 overflow-y-auto p-4 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-medium">Date</div>
                        <div className="font-medium">{formatDate(linkedDCQuickView.challan.challan_date)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-medium">Customer</div>
                        <div className="font-medium">{linkedDCQuickView.challan.customers?.company_name || '-'}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 uppercase font-medium mb-2">Items</div>
                      {linkedDCQuickView.items.length === 0 ? (
                        <div className="text-gray-500">No items found for this DC.</div>
                      ) : (
                        <div className="overflow-x-auto border rounded">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-gray-600">Product</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-600">Batch</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-600">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linkedDCQuickView.items.map((item) => (
                                <tr key={item.id} className="border-t">
                                  <td className="px-3 py-2">{item.products?.product_name || '-'}</td>
                                  <td className="px-3 py-2">{item.batches?.batch_number || '-'}</td>
                                  <td className="px-3 py-2 text-right">{Number(item.quantity || 0).toLocaleString('id-ID')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">Press Esc to close.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Bank Reconciliation — only rendered when a match exists */}
            {viewingExpense.bank_statement_lines && viewingExpense.bank_statement_lines.length > 0 && (
              <div className="border border-green-200 rounded-lg bg-green-50">
                <div className="px-3 py-1.5 border-b border-green-200 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-green-800 uppercase tracking-wide flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Bank Reconciliation
                  </span>
                  <span className="text-[10px] font-bold text-green-700 bg-green-200 px-1.5 py-0.5 rounded">✓ LINKED</span>
                </div>
                <div className="px-3 py-2 space-y-2">
                  {viewingExpense.bank_statement_lines.map((line) => {
                    const lineCurrency = line.bank_accounts?.currency ?? currency;
                    const fmtLine = (n: number) => formatCurrency(n, lineCurrency);
                    const bankAmount = line.debit_amount || line.credit_amount || 0;
                    return (
                      <div key={line.id} className="text-xs">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-gray-700">
                            <span className="text-[10px] uppercase font-medium text-gray-500 mr-1">Date</span>
                            {formatDate(line.transaction_date)}
                          </span>
                          <span className="text-gray-700">
                            <span className="text-[10px] uppercase font-medium text-gray-500 mr-1">Ref</span>
                            {line.description?.slice(0, 30) || '—'}
                          </span>
                          <span className="ml-auto flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <span className="text-[10px] uppercase font-medium text-gray-500">Bank Txn</span>
                              <span className="font-mono font-bold text-green-700">{fmtLine(bankAmount)}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-[10px] uppercase font-medium text-gray-500">Expense</span>
                              <span className="font-mono font-bold text-gray-900">{fmtMoney(viewingExpense.amount, 2)}</span>
                            </span>
                          </span>
                        </div>
                        {line.description && (
                          <div className="mt-1 text-[11px] text-gray-700 bg-white px-2 py-1 rounded border border-green-200 truncate">
                            {line.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Documents — only when attachments exist */}
            {viewingExpense.document_urls && viewingExpense.document_urls.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 block">
                  <FileText className="w-3.5 h-3.5 inline mr-1" />
                  Supporting Documents ({viewingExpense.document_urls.length})
                </label>
                <div className="grid grid-cols-1 gap-3">
                  {viewingExpense.document_urls.map((url, index) => {
                    const isImage = /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(url);
                    return (
                      <div key={index} className="p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                            <span className="text-sm text-blue-900 font-medium">Document {index + 1}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openDocument(url)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50"
                            >
                              <ExternalLink className="w-3 h-3" />
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadDocument(url, `Document ${index + 1}`)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-white border border-green-300 rounded hover:bg-green-50"
                            >
                              <Download className="w-3 h-3" />
                              Download
                            </button>
                          </div>
                        </div>
                        {isImage && (
                          <div className="mt-2">
                            <img
                              src={signedUrlCache[url] || url}
                              alt={`Document ${index + 1}`}
                              className="w-full max-w-md rounded-lg border-2 border-gray-300 hover:border-blue-400 cursor-pointer shadow-sm hover:shadow-md transition-all"
                              style={{ maxHeight: '300px', objectFit: 'contain' }}
                              onClick={() => openDocument(url)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Close Button */}
            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button
                onClick={() => {
                  setViewModalOpen(false);
                  setViewingExpense(null);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Cancel Posting modal */}
      {cancelPostingModalOpen && cancelPostingTarget && (
        <Modal isOpen={cancelPostingModalOpen} onClose={() => { setCancelPostingModalOpen(false); setCancelPostingTarget(null); setCancelPostingReason(''); }} title="Cancel Expense Posting" size="sm">
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
              <p className="font-semibold mb-1">{cancelPostingTarget.expense_category} — {formatCurrency(cancelPostingTarget.amount, getExpenseCurrency(cancelPostingTarget))}</p>
              <p>This will delete the posted journal entry and return the expense to Draft. Edit and re-approve to repost.</p>
              <p className="mt-1 text-xs flex items-center gap-1"><Lock className="w-3 h-3" /> Not allowed if the accounting period is closed.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea
                value={cancelPostingReason}
                onChange={e => setCancelPostingReason(e.target.value)}
                rows={3}
                placeholder="Reason for cancelling posting..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setCancelPostingModalOpen(false); setCancelPostingTarget(null); setCancelPostingReason(''); }} className="h-7 px-2 text-xs border border-gray-300 rounded hover:bg-gray-50">Back</button>
              <button
                onClick={handleCancelPostingConfirm}
                disabled={!cancelPostingReason.trim() || cancelPostingLoading}
                className="h-7 px-2 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {cancelPostingLoading ? 'Cancelling...' : 'Cancel Posting'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rejection reason modal */}
      {rejectionModalOpen && (
        <Modal isOpen={rejectionModalOpen} onClose={() => { setRejectionModalOpen(false); setRejectionReason(''); }} title="Reject Expense" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Please provide a reason for rejecting this expense entry.</p>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejectionModalOpen(false); setRejectionReason(''); }} className="h-7 px-2 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleRejectExpenseConfirm}
                disabled={!rejectionReason.trim() || !!approvalLoading}
                className="h-7 px-2 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
