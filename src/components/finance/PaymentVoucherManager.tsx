import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Search, ArrowUpCircle, Pencil, Trash2, Eye, Printer, Lock, RotateCcw, CheckCircle } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchableSelect } from '../SearchableSelect';
import { FinancePage } from './FinancePage';
import { FinanceTable } from './FinanceTable';
import { FinanceModal } from './FinanceModal';
import { F_BTN_PRIMARY, F_BTN_SECONDARY } from './FinanceForm';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
import { supabaseErrorMessage } from '../../utils/supabaseError';
import { formatCurrency } from '../../utils/currency';
import { linkBankStatementLine, savePaymentVoucher } from '../../services/financeCommands';
import { BankTransactionLinkField } from './BankTransactionLinkField';
import {
  type BankTransactionLine,
  linkBankTransaction,
  notifyFinanceReconciliationRefresh,
  unlinkBankTransaction,
} from './bankTransactionLinking';

interface Supplier {
  id: string;
  company_name: string;
}

interface StaffMember {
  id: string;
  full_name: string;
  employee_code: string | null;
}

interface BankAccount {
  id: string;
  account_name: string;
  bank_name: string;
  alias: string | null;
  currency: string;
}

interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  currency: string;
}

interface TaxCode {
  id: string;
  code: string;
  name: string;
  rate: number;
}

interface PaymentVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  supplier_id: string | null;
  staff_id: string | null;
  payment_method: string;
  bank_account_id: string | null;
  reference_number: string | null;
  amount: number;
  pph_amount: number;
  pph_code_id: string | null;
  net_amount: number;
  payment_currency: string | null;
  exchange_rate: number | null;
  bank_amount: number | null;
  bank_charge: number | null;
  description: string | null;
  is_posted: boolean;
  journal_entry_id: string | null;
  bank_statement_line_id?: string | null;
  bank_statement_line?: BankTransactionLine | null;
  suppliers?: { company_name: string };
  finance_staff_master?: { full_name: string };
  bank_accounts?: { account_name: string; bank_name: string; alias: string | null; currency: string | null };
  // derived
  invoice_currency: string;
  invoice_numbers: { id: string; number: string }[];
}

interface PrefillInvoice {
  id: string;
  invoice_number: string;
  supplier_id: string;
  balance_amount: number;
  currency?: string;
}

interface PrefillExpenseBill {
  id: string;
  supplier_id: string | null;
  staff_id?: string | null;
  balance_amount: number;
}

interface PaymentVoucherManagerProps {
  canManage: boolean;
  initialViewVoucherId?: string | null;
  onInitialViewHandled?: () => void;
  prefillInvoice?: PrefillInvoice | null;
  onPrefillConsumed?: () => void;
  prefillExpenseBill?: PrefillExpenseBill | null;
  onPrefillExpenseBillConsumed?: () => void;
  onViewInvoice?: (invoiceId: string) => void;
  prefillFromBankReconciliation?: {
    bankAccountId: string; statementLineId: string; date: string; amount: number; currency: 'IDR' | 'USD'; reference: string; description: string;
  } | null;
  onBankReconciliationPrefillConsumed?: () => void;
}

interface PaymentAllocationRow {
  payment_voucher_id: string | null;
  allocated_currency: string | null;
  purchase_invoices?: { id: string; invoice_number: string } | null;
  finance_expenses?: { id: string; voucher_number: string | null } | null;
}

interface ViewAllocationRow {
  allocated_amount: number | null;
  allocated_currency: string | null;
  purchase_invoices?: { id: string; invoice_number: string; invoice_date: string } | null;
  finance_expenses?: { id: string; voucher_number: string | null; invoice_number: string | null } | null;
}

// Outstanding expense bill for allocation in PV
interface OutstandingExpenseBillForPV {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  expense_category: string;
  description: string | null;
  amount: number;
  paid_amount: number;
  balance_amount: number;
  days_overdue: number;
}

function fmt(amount: number, currency: string) {
  return formatCurrency(amount, currency, {
    minimumFractionDigits: currency === 'IDR' ? 0 : 2,
    maximumFractionDigits: currency === 'IDR' ? 0 : 2,
  });
}


export function PaymentVoucherManager({ canManage, initialViewVoucherId, onInitialViewHandled, prefillInvoice, onPrefillConsumed, prefillExpenseBill, onPrefillExpenseBillConsumed, onViewInvoice, prefillFromBankReconciliation, onBankReconciliationPrefillConsumed }: PaymentVoucherManagerProps) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [cancelPostingTarget, setCancelPostingTarget] = useState<PaymentVoucher | null>(null);
  const [cancelPostingReason, setCancelPostingReason] = useState('');
  const [cancelPostingLoading, setCancelPostingLoading] = useState(false);
  const [postingLoading, setPostingLoading] = useState<string | null>(null);
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PurchaseInvoice[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [allocations, setAllocations] = useState<{ invoiceId: string; amount: number; currency: string }[]>([]);
  const [expenseBillAllocations, setExpenseBillAllocations] = useState<{ expenseId: string; amount: number }[]>([]);
  const [outstandingExpenseBills, setOutstandingExpenseBills] = useState<OutstandingExpenseBillForPV[]>([]);
  const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<PaymentVoucher | null>(null);
  const [viewingVoucher, setViewingVoucher] = useState<PaymentVoucher | null>(null);
  const [bankReconStatementLineId, setBankReconStatementLineId] = useState<string | null>(null);
  const [viewAllocations, setViewAllocations] = useState<Array<{ invoice_id: string; invoice_number: string; invoice_date: string; allocated_amount: number; allocated_currency: string; is_expense_bill?: boolean; expense_id?: string }>>([]);

  const [formData, setFormData] = useState({
    voucher_date: new Date().toISOString().split('T')[0],
    payee_type: 'supplier' as 'supplier' | 'staff',
    supplier_id: '',
    staff_id: '',
    payment_method: 'bank_transfer',
    bank_account_id: '',
    reference_number: '',
    amount: 0,
    bank_charge: 0,
    pph_code_id: '',
    pph_amount: 0,
    description: '',
    payment_currency: 'IDR',
    exchange_rate: 1,
  });

  useEffect(() => {
    loadVouchers();
    loadSuppliers();
    loadStaff();
    loadBankAccounts();
    loadTaxCodes();
  }, []);

  useEffect(() => {
    if (prefillInvoice && !loading) {
      setFormData(prev => ({ ...prev, supplier_id: prefillInvoice.supplier_id, amount: prefillInvoice.balance_amount }));
      setModalOpen(true);
      onPrefillConsumed?.();
    }
  }, [prefillInvoice, loading]);

  useEffect(() => {
    // "Settle" from ExpenseManager: open a new voucher pre-allocated to the
    // outstanding expense bill (same engine as manual expense allocation).
    // Works for supplier bills and staff bills (salary/advance).
    if (prefillExpenseBill && !loading) {
      const isStaff = !!prefillExpenseBill.staff_id;
      setFormData(prev => ({
        ...prev,
        payee_type: isStaff ? 'staff' : 'supplier',
        supplier_id: isStaff ? '' : (prefillExpenseBill.supplier_id || ''),
        staff_id: isStaff ? (prefillExpenseBill.staff_id || '') : '',
        amount: prefillExpenseBill.balance_amount,
      }));
      loadOutstandingExpenseBillsForPayee(
        isStaff ? null : prefillExpenseBill.supplier_id,
        isStaff ? prefillExpenseBill.staff_id || null : null,
      );
      setExpenseBillAllocations([{ expenseId: prefillExpenseBill.id, amount: prefillExpenseBill.balance_amount }]);
      setModalOpen(true);
      onPrefillExpenseBillConsumed?.();
    }
  }, [prefillExpenseBill, loading]);

  useEffect(() => {
    if (!prefillFromBankReconciliation || loading) return;
    setEditingVoucher(null);
    setBankReconStatementLineId(prefillFromBankReconciliation.statementLineId);
    setAllocations([]);
    setExpenseBillAllocations([]);
    setFormData(prev => ({
      ...prev,
      voucher_date: prefillFromBankReconciliation.date,
      bank_account_id: prefillFromBankReconciliation.bankAccountId,
      reference_number: prefillFromBankReconciliation.reference,
      amount: prefillFromBankReconciliation.amount,
      description: prefillFromBankReconciliation.description,
      payment_method: 'bank_transfer',
      payment_currency: prefillFromBankReconciliation.currency,
      exchange_rate: prefillFromBankReconciliation.currency === 'IDR' ? 1 : 0,
    }));
    setSelectedBank(bankAccounts.find(bank => bank.id === prefillFromBankReconciliation.bankAccountId) || null);
    setModalOpen(true);
    onBankReconciliationPrefillConsumed?.();
  }, [prefillFromBankReconciliation, loading, bankAccounts]);

  useEffect(() => {
    // In edit mode handleEdit manages invoice loading — skip this effect entirely
    if (editingVoucher) return;
    if (formData.payee_type === 'staff') {
      // Staff payee: no purchase invoices, only the staff member's outstanding bills
      setPendingInvoices([]);
      setAllocations([]);
      if (formData.staff_id) {
        loadOutstandingExpenseBillsForPayee(null, formData.staff_id);
      } else {
        setOutstandingExpenseBills([]);
        setExpenseBillAllocations([]);
      }
      return;
    }
    if (formData.supplier_id) {
      const isPrefill = prefillInvoice && prefillInvoice.supplier_id === formData.supplier_id;
      loadPendingInvoices(
        formData.supplier_id,
        isPrefill ? prefillInvoice.id : undefined,
        isPrefill ? prefillInvoice.balance_amount : undefined,
        isPrefill ? (prefillInvoice.currency || 'IDR') : undefined,
      );
    } else {
      setPendingInvoices([]);
      setAllocations([]);
    }
  }, [formData.supplier_id, formData.staff_id, formData.payee_type, editingVoucher]);

  useEffect(() => {
    if (formData.bank_account_id) {
      const bank = bankAccounts.find(b => b.id === formData.bank_account_id);
      if (bank) {
        setSelectedBank(bank);
        if (!editingVoucher) {
          setFormData(prev => ({ ...prev, payment_currency: bank.currency || 'IDR', exchange_rate: 1 }));
        }
      }
    } else {
      setSelectedBank(null);
    }
  }, [formData.bank_account_id, bankAccounts, editingVoucher]);

  useEffect(() => {
    if (formData.pph_code_id && formData.amount > 0) {
      const tax = taxCodes.find(t => t.id === formData.pph_code_id);
      if (tax) {
        setFormData(prev => ({ ...prev, pph_amount: Math.round(formData.amount * (tax.rate / 100)) }));
      }
    } else {
      setFormData(prev => ({ ...prev, pph_amount: 0 }));
    }
  }, [formData.pph_code_id, formData.amount, taxCodes]);

  const loadVouchers = async () => {
    try {
      // finance_staff_master embed requires the staff-accounting migration;
      // fall back to the supplier-only select on a DB that predates it.
      let { data, error } = await supabase
        .from('payment_vouchers')
        .select('*, suppliers(company_name), finance_staff_master(full_name), bank_accounts(account_name, bank_name, alias, currency)')
        .order('voucher_date', { ascending: false })
        .order('voucher_number', { ascending: false });
      if (error && /finance_staff_master|staff_id/i.test(error.message || '')) {
        ({ data, error } = await supabase
          .from('payment_vouchers')
          .select('*, suppliers(company_name), bank_accounts(account_name, bank_name, alias, currency)')
          .order('voucher_date', { ascending: false })
          .order('voucher_number', { ascending: false }));
      }
      if (error) throw error;

      const voucherIds = (data || []).map((v: PaymentVoucher) => v.id);
      const journalEntryIds = (data || [])
        .map((v: PaymentVoucher) => v.journal_entry_id)
        .filter((id): id is string => !!id);
      const allocCcyMap: Record<string, string> = {};
      const invoicesMap: Record<string, { id: string; number: string }[]> = {};
      const bankLineMap = new Map<string, BankTransactionLine>();
      if (voucherIds.length > 0) {
        const { data: allocs } = await supabase
          .from('voucher_allocations')
          .select('payment_voucher_id, allocated_currency, purchase_invoices(id, invoice_number)')
          .in('payment_voucher_id', voucherIds);
        for (const a of (allocs || []) as unknown as PaymentAllocationRow[]) {
          if (!a.payment_voucher_id) continue;
          if (!allocCcyMap[a.payment_voucher_id]) {
            allocCcyMap[a.payment_voucher_id] = a.allocated_currency || '';
          }
          if (a.purchase_invoices) {
            invoicesMap[a.payment_voucher_id] = invoicesMap[a.payment_voucher_id] || [];
            invoicesMap[a.payment_voucher_id].push({
              id: a.purchase_invoices.id,
              number: a.purchase_invoices.invoice_number,
            });
          }
        }
      }

      if (journalEntryIds.length > 0) {
        const { data: bankLines, error: bankLineError } = await supabase
          .from('bank_statement_lines')
          .select(`
            id,
            transaction_date,
            description,
            reference,
            debit_amount,
            credit_amount,
            bank_account_id,
            matched_entry_id,
            bank_accounts(bank_name, account_name, account_number, alias, currency)
          `)
          .in('matched_entry_id', journalEntryIds);
        if (bankLineError) throw bankLineError;
        for (const line of (bankLines || []) as unknown as BankTransactionLine[]) {
          if (line.matched_entry_id) bankLineMap.set(line.matched_entry_id, line);
        }
      }

      const enriched = (data || []).map((v: PaymentVoucher) => {
        const bankCcy = v.bank_accounts?.currency || 'IDR';
        const isCross = v.bank_amount != null && v.bank_amount > 0 && Math.abs((v.exchange_rate || 1) - 1) > 0.0001;
        const invCcy = allocCcyMap[v.id] || v.payment_currency || (isCross ? 'USD' : bankCcy);
        const bankLine = v.journal_entry_id ? bankLineMap.get(v.journal_entry_id) || null : null;
        return {
          ...v,
          invoice_currency: invCcy,
          invoice_numbers: invoicesMap[v.id] || [],
          bank_statement_line_id: bankLine?.id || null,
          bank_statement_line: bankLine,
        };
      });
      setVouchers(enriched);
    } catch (error) {
      console.error('Error loading vouchers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSuppliers = async () => {
    const { data } = await supabase.from('suppliers').select('id, company_name').order('company_name');
    setSuppliers(data || []);
  };

  const loadStaff = async () => {
    const { data } = await supabase
      .from('finance_staff_master')
      .select('id, full_name, employee_code')
      .eq('status', 'active')
      .order('full_name');
    setStaffList(data || []);
  };

  const loadBankAccounts = async () => {
    const { data } = await supabase.from('bank_accounts').select('id, account_name, bank_name, alias, currency').eq('is_active', true);
    setBankAccounts(data || []);
  };

  const loadTaxCodes = async () => {
    const { data } = await supabase.from('tax_codes').select('id, code, name, rate').eq('is_withholding', true);
    setTaxCodes(data || []);
  };

  const loadPendingInvoices = async (supplierId: string, preSelectId?: string, preSelectAmount?: number, preSelectCurrency?: string) => {
    const { data } = await supabase
      .from('purchase_invoices')
      .select('id, invoice_number, invoice_date, total_amount, paid_amount, balance_amount, currency')
      .eq('supplier_id', supplierId)
      .gt('balance_amount', 0)
      .order('invoice_date');
    setPendingInvoices(data || []);
    if (preSelectId && preSelectAmount) {
      setAllocations([{ invoiceId: preSelectId, amount: preSelectAmount, currency: preSelectCurrency || 'IDR' }]);
    } else {
      setAllocations([]);
    }

    // Also load outstanding expense bills for this supplier
    await loadOutstandingExpenseBillsForPayee(supplierId, null);
    setExpenseBillAllocations([]);
  };

  const loadOutstandingExpenseBillsForPayee = async (supplierId: string | null, staffId: string | null) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase.rpc('get_outstanding_expense_bills', { p_as_of_date: today });
      const filtered = (data || []).filter((b: OutstandingExpenseBillForPV) =>
        staffId ? b.staff_id === staffId
        : supplierId ? b.supplier_id === supplierId
        : true
      );
      setOutstandingExpenseBills(filtered);
    } catch (err) {
      console.error('Error loading outstanding expense bills:', err);
    }
  };

  const handleExpenseBillAllocationChange = (bill: OutstandingExpenseBillForPV, amount: number) => {
    setExpenseBillAllocations(prev => {
      const existing = prev.find(a => a.expenseId === bill.id);
      if (existing) {
        if (amount <= 0) return prev.filter(a => a.expenseId !== bill.id);
        return prev.map(a => a.expenseId === bill.id ? { ...a, amount } : a);
      }
      if (amount > 0) return [...prev, { expenseId: bill.id, amount }];
      return prev;
    });
  };

  const handleAllocationChange = (invoice: PurchaseInvoice, amount: number) => {
    setAllocations(prev => {
      const existing = prev.find(a => a.invoiceId === invoice.id);
      if (existing) {
        if (amount <= 0) return prev.filter(a => a.invoiceId !== invoice.id);
        return prev.map(a => a.invoiceId === invoice.id ? { ...a, amount } : a);
      }
      if (amount > 0) return [...prev, { invoiceId: invoice.id, amount, currency: invoice.currency || 'IDR' }];
      return prev;
    });
  };

  const invoiceCurrency = pendingInvoices.length > 0 ? (pendingInvoices[0].currency || 'IDR') : 'IDR';
  const bankCurrency = formData.payment_currency;
  const isCrossCurrency = pendingInvoices.length > 0 && invoiceCurrency !== bankCurrency;

  // Bank accounts split by whether they match the invoice currency
  const matchingBankAccounts = bankAccounts.filter(b => (b.currency || 'IDR') === invoiceCurrency);
  const otherBankAccounts   = bankAccounts.filter(b => (b.currency || 'IDR') !== invoiceCurrency);

  // True when user picked a mismatched bank but hasn't set an exchange rate
  const currencyMismatchWithoutRate =
    isCrossCurrency &&
    selectedBank !== null &&
    formData.exchange_rate <= 1;
  const invoiceInIDR = isCrossCurrency ? formData.amount * formData.exchange_rate : formData.amount;
  const bankCharge = formData.bank_charge || 0;
  const totalBankDebit = invoiceInIDR + bankCharge;
  const netInvoiceAmount = formData.amount - formData.pph_amount;
  const netBankDebit = isCrossCurrency
    ? netInvoiceAmount * formData.exchange_rate + bankCharge
    : netInvoiceAmount + bankCharge;
  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const totalExpenseBillAllocated = expenseBillAllocations.reduce((sum, a) => sum + a.amount, 0);

  const resetForm = () => {
    setFormData({
      voucher_date: new Date().toISOString().split('T')[0],
      payee_type: 'supplier',
      supplier_id: '',
      staff_id: '',
      payment_method: 'bank_transfer',
      bank_account_id: '',
      reference_number: '',
      amount: 0,
      bank_charge: 0,
      pph_code_id: '',
      pph_amount: 0,
      description: '',
      payment_currency: 'IDR',
      exchange_rate: 1,
    });
    setAllocations([]);
    setExpenseBillAllocations([]);
    setOutstandingExpenseBills([]);
    setPendingInvoices([]);
    setSelectedBank(null);
    setEditingVoucher(null);
    setBankReconStatementLineId(null);
  };

  const handlePostVoucher = async (v: PaymentVoucher) => {
    if (!profile?.id) return;
    setPostingLoading(v.id);
    try {
      const { error } = await supabase.rpc('post_payment_voucher', {
        p_pv_id: v.id,
        p_posted_by: profile.id,
      });
      if (error) throw error;
      loadVouchers();
    } catch (err) {
      alert('Failed to post: ' + supabaseErrorMessage(err));
    } finally {
      setPostingLoading(null);
    }
  };

  const openCancelPostingModal = (v: PaymentVoucher) => {
    setCancelPostingTarget(v);
    setCancelPostingReason('');
  };

  const handleCancelPostingConfirm = async () => {
    if (!cancelPostingTarget || !profile?.id) return;
    setCancelPostingLoading(true);
    try {
      const { error } = await supabase.rpc('cancel_payment_voucher_posting', {
        p_pv_id: cancelPostingTarget.id,
        p_cancelled_by: profile.id,
        p_reason: cancelPostingReason || null,
      });
      if (error) {
        if (error.message?.includes('period') && error.message?.includes('closed')) {
          alert('Cannot cancel posting: the accounting period for this voucher is closed.');
          return;
        }
        throw error;
      }
      setCancelPostingTarget(null);
      setCancelPostingReason('');
      loadVouchers();
    } catch (err) {
      alert('Failed to cancel posting: ' + supabaseErrorMessage(err));
    } finally {
      setCancelPostingLoading(false);
    }
  };

  const handleEdit = async (v: PaymentVoucher) => {
    if (v.is_posted) {
      alert('This payment voucher has been posted to the GL. Cancel posting first to edit it.');
      return;
    }
    setEditingVoucher(v);
    setFormData({
      voucher_date: v.voucher_date,
      payee_type: v.staff_id ? 'staff' : 'supplier',
      supplier_id: v.supplier_id || '',
      staff_id: v.staff_id || '',
      payment_method: v.payment_method,
      bank_account_id: v.bank_account_id || '',
      reference_number: v.reference_number || '',
      amount: v.amount,
      bank_charge: v.bank_charge || 0,
      pph_code_id: v.pph_code_id || '',
      pph_amount: v.pph_amount || 0,
      description: v.description || '',
      payment_currency: v.payment_currency || 'IDR',
      exchange_rate: v.exchange_rate || 1,
    });
    if (v.bank_account_id) {
      const bank = bankAccounts.find(b => b.id === v.bank_account_id);
      if (bank) setSelectedBank(bank);
    }
    // Load all invoices for this supplier (including paid ones so we can re-allocate).
    // Staff vouchers have no purchase invoices.
    const { data: invData } = v.supplier_id
      ? await supabase
          .from('purchase_invoices')
          .select('id, invoice_number, invoice_date, total_amount, paid_amount, balance_amount, currency')
          .eq('supplier_id', v.supplier_id)
          .order('invoice_date')
      : { data: [] as PurchaseInvoice[] };
    setPendingInvoices(invData || []);
    // Load existing allocations for this voucher — both invoice and expense-bill
    // kinds, so updating the voucher doesn't silently drop expense allocations.
    const { data: allocs } = await supabase
      .from('voucher_allocations')
      .select('purchase_invoice_id, finance_expense_id, allocated_amount, allocated_currency')
      .eq('payment_voucher_id', v.id);
    setAllocations((allocs || []).filter(a => a.purchase_invoice_id).map(a => {
      // Always use invoice currency for allocation amounts.
      // If stored currency doesn't match the invoice currency (e.g. IDR bank debit was
      // accidentally stored instead of the USD invoice amount), normalise to invoice currency
      // and cap at invoice total to prevent false Over! warnings.
      const matchedInv = (invData || []).find(inv => inv.id === a.purchase_invoice_id);
      const invCurrency = matchedInv?.currency || a.allocated_currency || 'IDR';
      const currencyMismatch = a.allocated_currency && matchedInv?.currency &&
        a.allocated_currency !== matchedInv.currency;
      const safeAmount = currencyMismatch
        ? Math.min(a.allocated_amount, matchedInv!.total_amount)
        : a.allocated_amount;
      return {
        invoiceId: a.purchase_invoice_id,
        amount: safeAmount,
        currency: invCurrency,
      };
    }));
    // Expense-bill allocations: restore them and show the payee's bills so
    // they remain editable (previously they were dropped on edit).
    const expenseAllocs = (allocs || []).filter(a => a.finance_expense_id);
    setExpenseBillAllocations(expenseAllocs.map(a => ({
      expenseId: a.finance_expense_id as string,
      amount: a.allocated_amount,
    })));
    await loadOutstandingExpenseBillsForPayee(v.supplier_id, v.staff_id);
    if (expenseAllocs.length > 0) {
      // Bills fully paid by THIS voucher won't be in the outstanding list —
      // fetch them so their allocation rows stay visible/editable.
      const { data: allocBills } = await supabase
        .from('finance_expenses')
        .select('id, supplier_id, staff_id, invoice_number, expense_date, due_date, expense_category, description, amount, paid_amount')
        .in('id', expenseAllocs.map(a => a.finance_expense_id as string));
      setOutstandingExpenseBills(prev => {
        const have = new Set(prev.map(b => b.id));
        const extra = (allocBills || [])
          .filter(b => !have.has(b.id))
          .map(b => ({
            id: b.id,
            supplier_id: b.supplier_id,
            supplier_name: null,
            staff_id: b.staff_id,
            staff_name: null,
            invoice_number: b.invoice_number,
            invoice_date: b.expense_date,
            due_date: b.due_date,
            expense_category: b.expense_category,
            description: b.description,
            amount: b.amount,
            paid_amount: b.paid_amount ?? 0,
            balance_amount: (b.amount || 0) - (b.paid_amount ?? 0),
            days_overdue: 0,
          }));
        return [...prev, ...extra];
      });
    }
    setModalOpen(true);
  };

  const handleView = async (v: PaymentVoucher) => {
    setViewingVoucher(v);
    const { data } = await supabase
      .from('voucher_allocations')
      .select('allocated_amount, allocated_currency, purchase_invoices(id, invoice_number, invoice_date), finance_expenses(id, voucher_number, invoice_number, expense_date)')
      .eq('payment_voucher_id', v.id);
    setViewAllocations(
      ((data || []) as unknown as (ViewAllocationRow & { finance_expenses?: { id: string; voucher_number: string | null; invoice_number: string | null; expense_date?: string } | null })[]).map((a) => ({
        invoice_id: a.purchase_invoices?.id || a.finance_expenses?.id || '',
        invoice_number: a.purchase_invoices?.invoice_number
          || (a.finance_expenses ? `${a.finance_expenses.invoice_number || a.finance_expenses.voucher_number || 'Expense Bill'}` : '—'),
        invoice_date: a.purchase_invoices?.invoice_date || a.finance_expenses?.expense_date || '',
        allocated_amount: a.allocated_amount || 0,
        allocated_currency: a.allocated_currency || 'IDR',
        is_expense_bill: !!a.finance_expenses,
        expense_id: a.finance_expenses?.id,
      })),
    );
  };

  useEffect(() => {
    if (!initialViewVoucherId || loading) return;
    const voucher = vouchers.find(item => item.id === initialViewVoucherId);
    if (voucher) void handleView(voucher);
    onInitialViewHandled?.();
  }, [initialViewVoucherId, loading, vouchers, onInitialViewHandled]);

  const handleDelete = async (v: PaymentVoucher) => {
    if (v.is_posted) {
      alert('This payment voucher has been posted to the GL. Cancel posting first to delete it.');
      return;
    }
    if (!confirm(`Delete payment ${v.voucher_number}? This will reverse all invoice allocations.`)) return;
    try {
      const { error } = await supabase.rpc('delete_payment_voucher_with_allocations', {
        p_voucher_id: v.id,
      });
      if (error) throw error;

      loadVouchers();
    } catch (err) {
      alert('Delete failed: ' + supabaseErrorMessage(err));
    }
  };

  const handleLinkBankTransaction = async (voucher: PaymentVoucher, transaction: BankTransactionLine) => {
    if (!voucher.is_posted || !voucher.journal_entry_id) {
      throw new Error('Post the payment voucher before linking a bank transaction.');
    }

    try {
      await linkBankTransaction({
        bankStatementLineId: transaction.id,
        matchedJournalEntryId: voucher.journal_entry_id,
        note: `Linked to supplier payment ${voucher.voucher_number}`,
      });

      const updatedVoucher = {
        ...voucher,
        bank_statement_line_id: transaction.id,
        bank_statement_line: transaction,
      };
      setVouchers((prev) => prev.map((item) => item.id === voucher.id ? updatedVoucher : item));
      setViewingVoucher(updatedVoucher);
      notifyFinanceReconciliationRefresh();
    } catch (error) {
      console.error('Error linking payment voucher to bank transaction:', error);
      alert('Failed to link bank transaction: ' + supabaseErrorMessage(error));
      throw error;
    }
  };

  const handleUnlinkBankTransaction = async (voucher: PaymentVoucher) => {
    if (!voucher.bank_statement_line_id) return;
    if (!confirm(
      `Unlink ${voucher.voucher_number} from this bank transaction?\n\n` +
      'The bank statement line will return to Unmatched.'
    )) return;

    try {
      await unlinkBankTransaction(voucher.bank_statement_line_id);
      const updatedVoucher = {
        ...voucher,
        bank_statement_line_id: null,
        bank_statement_line: null,
      };
      setVouchers((prev) => prev.map((item) => item.id === voucher.id ? updatedVoucher : item));
      setViewingVoucher(updatedVoucher);
      notifyFinanceReconciliationRefresh();
    } catch (error) {
      console.error('Error unlinking payment voucher from bank transaction:', error);
      alert('Failed to unlink bank transaction: ' + supabaseErrorMessage(error));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isStaffPayee = formData.payee_type === 'staff';
    if (isStaffPayee ? !formData.staff_id : !formData.supplier_id) {
      alert(isStaffPayee ? 'Please select a staff member.' : 'Please select a supplier.');
      return;
    }
    if (formData.payment_method === 'advance_adjustment' && !isStaffPayee) {
      alert('Advance Adjustment is only available for staff payees.');
      return;
    }

    // ── Currency / bank account guard ──────────────────────────────
    if (currencyMismatchWithoutRate) {
      alert(
        `Currency mismatch: the invoice is in ${invoiceCurrency} but the selected bank account is ${selectedBank?.currency || 'IDR'}.\n\n` +
        `Either select a ${invoiceCurrency} bank account, or enter the exchange rate in the Currency Conversion panel.`
      );
      return;
    }
    if (isCrossCurrency && formData.exchange_rate <= 1) {
      alert(`Cross-currency payment requires an exchange rate greater than 1. Please enter the rate in the Currency Conversion panel.`);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const payload = {
        voucher_date: formData.voucher_date,
        supplier_id: isStaffPayee ? null : formData.supplier_id,
        staff_id: isStaffPayee ? formData.staff_id : null,
        payment_method: formData.payment_method,
        bank_account_id: formData.bank_account_id || null,
        reference_number: formData.reference_number || null,
        amount: formData.amount,
        pph_amount: formData.pph_amount,
        pph_code_id: formData.pph_code_id || null,
        description: formData.description || null,
        payment_currency: formData.payment_currency,
        exchange_rate: formData.exchange_rate,
        bank_amount: isCrossCurrency ? totalBankDebit : null,
        bank_charge: formData.bank_charge || 0,
      };

      const savedVoucher = await savePaymentVoucher(editingVoucher?.id || null, {
        ...payload,
        payment_currency: payload.payment_currency as 'IDR' | 'USD',
        created_by: user.id,
      }, [
          // Purchase invoice allocations
          ...allocations.map(alloc => ({
            invoice_id: alloc.invoiceId,
            amount: alloc.amount,
            currency: alloc.currency,
          })),
          // Expense bill allocations (finance_expense_id key, handled by extended RPC)
          ...expenseBillAllocations.map(alloc => ({
            finance_expense_id: alloc.expenseId,
            amount: alloc.amount,
            currency: 'IDR',
          })),
        ]);

      if (bankReconStatementLineId && !editingVoucher) {
        const { error: postError } = await supabase.rpc('post_payment_voucher', {
          p_pv_id: savedVoucher.id,
          p_posted_by: user.id,
        });
        if (postError) throw postError;
        await linkBankStatementLine(bankReconStatementLineId, 'payment', savedVoucher.id);
        setBankReconStatementLineId(null);
        notifyFinanceReconciliationRefresh();
      }

      setModalOpen(false);
      resetForm();
      loadVouchers();
    } catch (error: unknown) {
      console.error('Error saving voucher:', error);
      alert('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const filteredVouchers = vouchers.filter(v =>
    v.voucher_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.suppliers?.company_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <>
      <FinancePage
        title="Payment Vouchers"
        actions={canManage && (
          <button
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="inline-flex items-center gap-1 h-7 px-2 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700"
          >
            <ArrowUpCircle className="w-3 h-3" />
            New Payment
          </button>
        )}
        toolbar={
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 w-3 h-3" />
            <input
              type="text"
              placeholder="Search payments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded"
            />
          </div>
        }
      >
        <FinanceTable
          rows={filteredVouchers}
          rowKey={(v) => v.id}
          empty="No payment vouchers found"
          expandable={(v) => {
            const invs = v.invoice_numbers || [];
            if (invs.length <= 1) return null;
            return {
              label: `+${invs.length - 1} more`,
              content: (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Paid Invoices</span>
                  {invs.map(inv => (
                    <button
                      key={inv.id}
                      onClick={(e) => { e.stopPropagation(); onViewInvoice?.(inv.id); }}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-mono"
                      title="View purchase invoice"
                    >
                      {inv.number}
                    </button>
                  ))}
                </div>
              ),
            };
          }}
          columns={[
            { header: 'Voucher No', cell: (v) => <span className="font-mono font-medium">{v.voucher_number}</span> },
            { header: 'Date',       cell: (v) => new Date(v.voucher_date).toLocaleDateString('id-ID') },
            { header: 'Payee',      cell: (v) => v.suppliers?.company_name
              ?? (v.finance_staff_master ? <span>{v.finance_staff_master.full_name} <span className="text-[9px] text-teal-600 font-semibold">STAFF</span></span> : '—') },
            { header: 'Method',     cell: (v) => (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] capitalize">
                {v.payment_method.replace(/_/g, ' ')}
              </span>
            ) },
            { header: 'Invoice',    cell: (v) => {
              const invs = v.invoice_numbers || [];
              if (invs.length === 0) return <span className="text-gray-400">—</span>;
              const first = invs[0];
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); onViewInvoice?.(first.id); }}
                  className="text-blue-600 hover:text-blue-800 hover:underline font-mono"
                >
                  {first.number}
                </button>
              );
            } },
            { header: 'Bank',       cell: (v) => v.bank_accounts
              ? `${v.bank_accounts.alias || v.bank_accounts.account_name} (${v.bank_accounts.currency})`
              : <span className="text-gray-400">—</span> },
            { header: 'Bank Debit', align: 'right', cell: (v) => {
              const bankCcy = v.bank_accounts?.currency || v.payment_currency || 'IDR';
              const invCcy = v.invoice_currency || 'IDR';
              const isCross = invCcy !== bankCcy && v.bank_amount != null && v.bank_amount > 0;
              const debit = isCross ? (v.bank_amount || 0) : (v.amount || 0) + (v.bank_charge || 0);
              return <span className="font-medium text-blue-700">{fmt(debit, bankCcy)}</span>;
            } },
            { header: 'Net Paid',   align: 'right', cell: (v) => (
              <span className="font-medium text-red-600">{fmt(v.net_amount, v.invoice_currency || 'IDR')}</span>
            ) },
            ...(canManage ? [{
              header: 'Actions',
              align: 'center' as const,
              cell: (v: PaymentVoucher) => (
                <div className="flex items-center justify-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleView(v); }}
                    className="p-1 text-gray-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                    title="View"
                  ><Eye className="w-3.5 h-3.5" /></button>
                  {!v.is_posted && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePostVoucher(v); }}
                        disabled={postingLoading === v.id}
                        className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                        title="Post to GL"
                      ><CheckCircle className="w-3.5 h-3.5" /></button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(v); }}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit"
                      ><Pencil className="w-3.5 h-3.5" /></button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(v); }}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete"
                      ><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                  {v.is_posted && (
                    <span className="flex items-center gap-0.5 px-1 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                      <Lock className="w-3 h-3" /> Posted
                    </span>
                  )}
                  {v.is_posted && isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openCancelPostingModal(v); }}
                      className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                      title="Cancel Posting"
                    ><RotateCcw className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ),
            }] : []),
          ]}
        />
      </FinancePage>

      <FinanceModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); resetForm(); }}
        title={editingVoucher ? `Edit ${editingVoucher.voucher_number}` : 'New Payment Voucher'}
        size="lg"
        footer={
          <>
            <button type="button" onClick={() => { setModalOpen(false); resetForm(); }} className={F_BTN_SECONDARY}>
              Cancel
            </button>
            <button type="submit" form="payment-voucher-form" className={`${F_BTN_PRIMARY} bg-red-600 hover:bg-red-700`}>
              {editingVoucher ? 'Update Payment' : 'Save Payment'}
            </button>
          </>
        }
      >
        <form id="payment-voucher-form" onSubmit={handleSubmit} className="flex flex-col gap-1.5">

          {/* Row A: Date · Payee · Method */}
          <SapRow>
            <SapField label="Date" required span={3}>
              <input type="date" required value={formData.voucher_date}
                onChange={(e) => setFormData({ ...formData, voucher_date: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Pay To" required span={2}>
              <select
                value={formData.payee_type}
                onChange={(e) => {
                  const payeeType = e.target.value as 'supplier' | 'staff';
                  setFormData({
                    ...formData,
                    payee_type: payeeType,
                    supplier_id: '',
                    staff_id: '',
                    payment_method: formData.payment_method === 'advance_adjustment' ? 'bank_transfer' : formData.payment_method,
                  });
                  setExpenseBillAllocations([]);
                  setOutstandingExpenseBills([]);
                }}
                className={SAP_INPUT}>
                <option value="supplier">Supplier</option>
                <option value="staff">Staff</option>
              </select>
            </SapField>
            <SapField label={formData.payee_type === 'staff' ? 'Staff Member' : 'Supplier'} required span={3}>
              {formData.payee_type === 'staff' ? (
                <SearchableSelect
                  value={formData.staff_id}
                  onChange={(val) => setFormData({ ...formData, staff_id: val })}
                  options={staffList.map(s => ({ value: s.id, label: s.employee_code ? `${s.full_name} (${s.employee_code})` : s.full_name }))}
                  placeholder="Select staff"
                />
              ) : (
                <SearchableSelect
                  value={formData.supplier_id}
                  onChange={(val) => setFormData({ ...formData, supplier_id: val })}
                  options={suppliers.map(s => ({ value: s.id, label: s.company_name }))}
                  placeholder="Select supplier"
                />
              )}
            </SapField>
            <SapField label="Method" required span={4}>
              <select required value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className={SAP_INPUT}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="check">Check</option>
                <option value="giro">Giro</option>
                <option value="other">Other</option>
                {formData.payee_type === 'staff' && (
                  <option value="advance_adjustment">Adjust Against Staff Advance</option>
                )}
              </select>
            </SapField>
          </SapRow>

          {/* Row B: Amount · Bank Account · Reference (bank account/ref only for
              methods that actually move money through a bank) */}
          <SapRow>
            <SapField
              label={`Amount${pendingInvoices.length > 0 ? ` (${invoiceCurrency})` : ''}`}
              required
              span={['cash', 'advance_adjustment'].includes(formData.payment_method) ? 12 : 4}>
              <input type="number" required step="0.01" value={formData.amount || ''}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                className={SAP_INPUT + ' !text-right !font-mono !font-semibold'} />
            </SapField>
            {!['cash', 'advance_adjustment'].includes(formData.payment_method) && (
              <>
                <SapField
                  label="Bank Account"
                  span={4}
                  right={selectedBank ? (
                    <span className={`px-1 py-0.5 text-[9px] font-bold rounded ${
                      isCrossCurrency ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>{selectedBank.currency || 'IDR'}</span>
                  ) : null}>
                  <select
                    value={formData.bank_account_id}
                    onChange={(e) => setFormData({ ...formData, bank_account_id: e.target.value })}
                    className={SAP_INPUT + (
                      currencyMismatchWithoutRate ? ' !border-red-400 !bg-red-50'
                      : isCrossCurrency ? ' !border-amber-400' : ''
                    )}>
                    <option value="">Select account</option>
                    {pendingInvoices.length > 0 ? (
                      <>
                        {matchingBankAccounts.length > 0 && (
                          <optgroup label={`✓ ${invoiceCurrency} accounts (recommended)`}>
                            {matchingBankAccounts.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.alias || `${b.bank_name} - ${b.account_name}`} ({b.currency || 'IDR'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherBankAccounts.length > 0 && (
                          <optgroup label="⚠ Other currency — exchange rate required">
                            {otherBankAccounts.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.alias || `${b.bank_name} - ${b.account_name}`} ({b.currency || 'IDR'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      bankAccounts.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.alias || `${b.bank_name} - ${b.account_name}`} ({b.currency || 'IDR'})
                        </option>
                      ))
                    )}
                  </select>
                </SapField>
                <SapField label="Reference No" span={4}>
                  <input type="text" value={formData.reference_number}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    className={SAP_INPUT} />
                </SapField>
              </>
            )}
          </SapRow>
          {!['cash', 'advance_adjustment'].includes(formData.payment_method) && (
            <>
              {currencyMismatchWithoutRate && (
                <p className="text-[10px] text-red-600 font-medium">
                  ✗ {selectedBank?.currency} account selected for a {invoiceCurrency} invoice — enter an exchange rate below, or choose a {invoiceCurrency} account.
                </p>
              )}
              {isCrossCurrency && !currencyMismatchWithoutRate && (
                <p className="text-[10px] text-amber-700">
                  Cross-currency: enter exchange rate in the panel below.
                </p>
              )}
            </>
          )}

          {/* Cross-currency panel */}
          {isCrossCurrency && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 mb-2">
                Currency Conversion
                <span className="ml-2 font-normal text-amber-600">{invoiceCurrency} invoice → {bankCurrency} bank debit</span>
              </p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">Invoice ({invoiceCurrency})</label>
                  <input
                    readOnly
                    value={formData.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-50 text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">Rate (1 {invoiceCurrency} = {bankCurrency})</label>
                  <input
                    type="number"
                    required={isCrossCurrency}
                    step="0.000001"
                    min="0.000001"
                    value={formData.exchange_rate || ''}
                    onChange={(e) => setFormData({ ...formData, exchange_rate: parseFloat(e.target.value) || 1 })}
                    className="w-full px-2 py-1.5 text-sm border border-amber-300 rounded bg-white focus:ring-1 focus:ring-amber-400"
                    placeholder="e.g. 16200"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">Converted ({bankCurrency})</label>
                  <input
                    readOnly
                    value={invoiceInIDR.toLocaleString('id-ID', { minimumFractionDigits: 0 })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-green-50 text-green-800 font-medium"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">
                    Bank Transfer Charge ({bankCurrency}) — added to bank debit
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={formData.bank_charge || ''}
                    onChange={(e) => setFormData({ ...formData, bank_charge: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                    placeholder="e.g. 50000"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">Total Bank Debit ({bankCurrency})</label>
                  <input
                    readOnly
                    value={totalBankDebit.toLocaleString('id-ID', { minimumFractionDigits: 0 })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-blue-50 text-blue-800 font-bold"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PPh + Summary */}
          <div className="border-t border-gray-200 pt-2">
            <SapRow>
              <SapField label="PPh Type" span={6}>
                <select value={formData.pph_code_id}
                  onChange={(e) => setFormData({ ...formData, pph_code_id: e.target.value })}
                  className={SAP_INPUT}>
                  <option value="">No withholding</option>
                  {taxCodes.map(t => (
                    <option key={t.id} value={t.id}>{t.code} - {t.name} ({t.rate}%)</option>
                  ))}
                </select>
              </SapField>
              <SapField label={`PPh Amt${pendingInvoices.length > 0 ? ` (${invoiceCurrency})` : ''}`} span={6}>
                <input type="number" value={formData.pph_amount || ''}
                  onChange={(e) => setFormData({ ...formData, pph_amount: parseFloat(e.target.value) || 0 })}
                  className={SAP_INPUT + ' !text-right !font-mono text-orange-700'} />
              </SapField>
            </SapRow>
            <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5 text-[11px]">
              <div className="flex justify-between text-gray-600">
                <span>Gross ({invoiceCurrency}):</span>
                <span className="font-mono">{fmt(formData.amount, invoiceCurrency)}</span>
              </div>
              {formData.pph_amount > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Less PPh:</span>
                  <span className="font-mono">−{fmt(formData.pph_amount, invoiceCurrency)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1">
                <span>Net Payment ({invoiceCurrency}):</span>
                <span className="text-red-600 font-mono">{fmt(netInvoiceAmount, invoiceCurrency)}</span>
              </div>
              {isCrossCurrency && (
                <div className="flex justify-between font-semibold text-blue-700">
                  <span>Bank Debit ({bankCurrency}) incl. charges:</span>
                  <span className="font-mono">{fmt(netBankDebit, bankCurrency)}</span>
                </div>
              )}
            </div>
          </div>

          <SapRow>
            <SapField label="Description" span={12}>
              <input type="text" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={SAP_INPUT} placeholder="Payment description..." />
            </SapField>
          </SapRow>

          {/* ── Expense Bill Allocations ──────────────────────────────── */}
          {outstandingExpenseBills.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-purple-700 mb-2 uppercase tracking-wide flex items-center gap-1">
                Allocate to Expense Bills (A/P)
                <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-normal">
                  {outstandingExpenseBills.length} outstanding
                </span>
              </h4>
              <div className="max-h-40 overflow-y-auto border border-purple-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-purple-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-purple-700">Expense / Invoice #</th>
                      <th className="px-3 py-1.5 text-left font-medium text-purple-700">Category</th>
                      <th className="px-3 py-1.5 text-right font-medium text-purple-700">Balance</th>
                      <th className="px-3 py-1.5 text-right font-medium text-purple-700">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-100">
                    {outstandingExpenseBills.map(bill => {
                      const thisAlloc = expenseBillAllocations.find(a => a.expenseId === bill.id)?.amount || 0;
                      return (
                        <tr key={bill.id} className={bill.days_overdue > 0 ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-1.5">
                            <div className="font-mono">{bill.invoice_number || bill.id.slice(0, 8)}</div>
                            <div className="text-gray-400">{new Date(bill.invoice_date).toLocaleDateString('id-ID')}</div>
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {bill.expense_category.replace(/_/g, ' ')}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium text-red-600">
                            Rp {bill.balance_amount.toLocaleString('id-ID')}
                            {bill.days_overdue > 0 && (
                              <div className="text-[10px] text-red-500">{bill.days_overdue}d overdue</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              max={bill.balance_amount}
                              step="1"
                              value={thisAlloc || ''}
                              onChange={(e) => handleExpenseBillAllocationChange(bill, parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1 border border-purple-200 rounded text-right focus:border-purple-400 outline-none"
                              placeholder="0"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalExpenseBillAllocated > 0 && (
                <div className="mt-1.5 flex justify-between text-xs font-medium">
                  <span className="text-purple-600">Expense Bill Allocated (IDR):</span>
                  <span className="text-purple-700">
                    Rp {totalExpenseBillAllocated.toLocaleString('id-ID')}
                  </span>
                </div>
              )}
            </div>
          )}

          {pendingInvoices.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Allocate to Invoices</h4>
              <div className="max-h-40 overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-500">Invoice</th>
                      <th className="px-3 py-1.5 text-center font-medium text-gray-500">CCY</th>
                      <th className="px-3 py-1.5 text-right font-medium text-gray-500">Available</th>
                      <th className="px-3 py-1.5 text-right font-medium text-gray-500">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pendingInvoices
                      // In edit mode show invoices that have an existing allocation OR still have balance
                      .filter(inv => editingVoucher
                        ? (inv.balance_amount > 0 || allocations.some(a => a.invoiceId === inv.id))
                        : true)
                      .map(inv => {
                        const invCcy = inv.currency || 'IDR';
                        // Effective available = DB balance + this voucher's existing allocation
                        // (the existing allocation was already deducted from DB balance_amount)
                        const thisAlloc = allocations.find(a => a.invoiceId === inv.id)?.amount || 0;
                        const availableBalance = editingVoucher
                          ? inv.balance_amount + thisAlloc
                          : inv.balance_amount;
                        return (
                          <tr key={inv.id}>
                            <td className="px-3 py-1.5">
                              <div className="font-mono">{inv.invoice_number}</div>
                              <div className="text-gray-400">{new Date(inv.invoice_date).toLocaleDateString('id-ID')}</div>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${invCcy === 'USD' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {invCcy}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium text-red-600">
                              {fmt(availableBalance, invCcy)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                min={0}
                                max={availableBalance}
                                step="0.01"
                                value={thisAlloc || ''}
                                onChange={(e) => handleAllocationChange(inv, parseFloat(e.target.value) || 0)}
                                className="w-24 px-2 py-1 border rounded text-right"
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {totalAllocated > 0 && (
                <div className="mt-1.5 flex justify-between text-xs font-medium">
                  <span className="text-gray-500">Allocated ({invoiceCurrency}):</span>
                  <span className={totalAllocated > formData.amount ? 'text-red-600' : 'text-green-700'}>
                    {fmt(totalAllocated, invoiceCurrency)}
                    {totalAllocated > formData.amount && <span className="ml-1 text-red-400">Over!</span>}
                  </span>
                </div>
              )}
            </div>
          )}

        </form>
      </FinanceModal>

      {cancelPostingTarget && (
        <Modal
          isOpen={!!cancelPostingTarget}
          onClose={() => { setCancelPostingTarget(null); setCancelPostingReason(''); }}
          title={`Cancel GL Posting — ${cancelPostingTarget.voucher_number}`}
        >
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              This will delete the journal entry for this payment voucher and reset it to Draft. The voucher will need to be re-posted after any edits.
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Reason (optional)</label>
              <textarea
                value={cancelPostingReason}
                onChange={(e) => setCancelPostingReason(e.target.value)}
                rows={3}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                placeholder="Reason for cancelling the GL posting..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCancelPostingTarget(null); setCancelPostingReason(''); }}
                className="px-3 py-1.5 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleCancelPostingConfirm}
                disabled={cancelPostingLoading}
                className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {cancelPostingLoading ? 'Cancelling...' : 'Cancel Posting'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {viewingVoucher && (
        <Modal isOpen={!!viewingVoucher} onClose={() => setViewingVoucher(null)} title={`Payment Voucher ${viewingVoucher.voucher_number}`}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div>
                <div className="text-xs text-gray-500">Voucher No.</div>
                <div className="text-sm font-semibold text-gray-900">{viewingVoucher.voucher_number}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Date</div>
                <div className="font-medium text-gray-900">{new Date(viewingVoucher.voucher_date).toLocaleDateString('en-GB')}</div>
              </div>
              <div className="flex items-center gap-2">
                {viewingVoucher.is_posted ? (
                  <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                    <Lock className="w-3 h-3" /> Posted
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">Draft</span>
                )}
                {viewingVoucher.is_posted && isAdmin && (
                  <button
                    onClick={() => { setViewingVoucher(null); openCancelPostingModal(viewingVoucher); }}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
                  >
                    <RotateCcw className="w-3 h-3" /> Cancel Posting
                  </button>
                )}
                {!viewingVoucher.is_posted && canManage && (
                  <button
                    onClick={() => { setViewingVoucher(null); handlePostVoucher(viewingVoucher); }}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium border border-green-300 text-green-700 rounded hover:bg-green-50"
                  >
                    <CheckCircle className="w-3 h-3" /> Post to GL
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded hover:bg-gray-50 print:hidden"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Supplier</div>
                <div className="font-medium text-gray-900">{viewingVoucher.suppliers?.company_name || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Payment Method</div>
                <div className="font-medium text-gray-900 capitalize">{viewingVoucher.payment_method.replace(/_/g, ' ')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Bank Account</div>
                <div className="font-medium text-gray-900">
                  {viewingVoucher.bank_accounts
                    ? `${viewingVoucher.bank_accounts.alias || viewingVoucher.bank_accounts.bank_name || viewingVoucher.bank_accounts.account_name} (${viewingVoucher.bank_accounts.currency})`
                    : '—'}
                </div>
                {viewingVoucher.bank_account_id && (
                  <div className="mt-2">
                    <BankTransactionLinkField
                      bankAccountId={viewingVoucher.bank_account_id}
                      linkedTransaction={viewingVoucher.bank_statement_line || null}
                      selectedTransactionId={viewingVoucher.bank_statement_line_id || ''}
                      currentJournalEntryId={viewingVoucher.journal_entry_id}
                      disabled={!viewingVoucher.is_posted || !viewingVoucher.journal_entry_id}
                      disabledMessage="Post this voucher to create its journal entry before linking a bank transaction."
                      canUnlink={canManage}
                      onSelect={(transaction) => handleLinkBankTransaction(viewingVoucher, transaction)}
                      onUnlink={() => handleUnlinkBankTransaction(viewingVoucher)}
                    />
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Reference No.</div>
                <div className="font-medium text-gray-900">{viewingVoucher.reference_number || '—'}</div>
              </div>
            </div>

            {(() => {
              const invCcy = viewAllocations[0]?.allocated_currency || viewingVoucher.invoice_currency || 'IDR';
              const bankCcy = viewingVoucher.bank_accounts?.currency || 'IDR';
              const isCross = invCcy !== bankCcy;
              return (
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500">Invoice Amount ({invCcy})</div>
                      <div className="font-semibold text-gray-900">{fmt(viewingVoucher.amount || 0, invCcy)}</div>
                    </div>
                    {isCross && viewingVoucher.exchange_rate && viewingVoucher.exchange_rate !== 1 && (
                      <div>
                        <div className="text-xs text-gray-500">Exchange Rate (1 {invCcy} = {bankCcy})</div>
                        <div className="font-semibold text-gray-900">{viewingVoucher.exchange_rate.toLocaleString()}</div>
                      </div>
                    )}
                    {viewingVoucher.bank_charge ? (
                      <div>
                        <div className="text-xs text-gray-500">Bank Charge ({bankCcy})</div>
                        <div className="font-semibold text-gray-900">{fmt(viewingVoucher.bank_charge, bankCcy)}</div>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs text-gray-500">Bank Debit ({bankCcy})</div>
                      <div className="font-semibold text-blue-700">
                        {fmt(
                          viewingVoucher.bank_amount && viewingVoucher.bank_amount > 0
                            ? viewingVoucher.bank_amount
                            : (viewingVoucher.amount || 0) + (viewingVoucher.bank_charge || 0),
                          bankCcy,
                        )}
                      </div>
                    </div>
                    {viewingVoucher.pph_amount ? (
                      <div>
                        <div className="text-xs text-gray-500">PPh Withholding ({invCcy})</div>
                        <div className="font-semibold text-gray-900">{fmt(viewingVoucher.pph_amount, invCcy)}</div>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs text-gray-500">Net Paid ({invCcy})</div>
                      <div className="font-semibold text-red-600">{fmt(viewingVoucher.net_amount || 0, invCcy)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {viewAllocations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Allocated to Invoices</div>
                <div className="border border-gray-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Invoice No.</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Invoice Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Allocated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewAllocations.map((a, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            {onViewInvoice && a.invoice_id ? (
                              <button
                                onClick={() => { setViewingVoucher(null); onViewInvoice(a.invoice_id); }}
                                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                              >
                                {a.invoice_number}
                              </button>
                            ) : (
                              <span className="text-gray-900 font-medium">{a.invoice_number}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{a.invoice_date ? new Date(a.invoice_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">
                            {fmt(a.allocated_amount, a.allocated_currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {viewingVoucher.description && (
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Description</div>
                <div className="text-gray-700 whitespace-pre-wrap">{viewingVoucher.description}</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
