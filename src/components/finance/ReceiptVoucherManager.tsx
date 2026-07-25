import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Eye, Search, ArrowDownCircle, CreditCard as Edit2, Trash2, Printer, Lock, RotateCcw, CheckCircle } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchableSelect } from '../SearchableSelect';
import { FinanceModal } from './FinanceModal';
import { F_BTN_PRIMARY, F_BTN_SECONDARY } from './FinanceForm';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { showToast } from '../ToastNotification';
import { showConfirm } from '../ConfirmDialog';
import { supabaseErrorMessage } from '../../utils/supabaseError';
import { type CompanySnapshot } from '../../types/company';
import { waitForImages } from '../../utils/companyLogoUrl';
import { formatCurrency } from '../../utils/currency';
import { saveReceiptVoucher } from '../../services/financeCommands';

interface Customer {
  id: string;
  company_name: string;
}

interface BankAccount {
  id: string;
  account_name: string;
  bank_name: string;
  account_number: string;
  alias?: string;
  currency: string;
}

interface SalesInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
}

interface SalesOrder {
  id: string;
  so_number: string;
  so_date: string;
  total_amount: number;
  advance_payment_amount: number;
  advance_payment_status: string;
  balance_due: number;
  status?: string;
}

type AllocationTarget = (SalesInvoice & { type: 'invoice' }) | (SalesOrder & { type: 'salesorder' });

interface ReceiptVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  customer_id: string;
  payment_method: string;
  bank_account_id: string | null;
  reference_number: string | null;
  amount: number;
  description: string | null;
  is_posted: boolean;
  journal_entry_id: string | null;
  transaction_currency?: 'IDR' | 'USD' | null;
  exchange_rate?: number | null;
  created_at: string;
  customers?: { company_name: string };
  bank_accounts?: { account_name: string; bank_name: string; alias?: string; currency: string };
  allocated_to?: string;
  company_snapshot?: CompanySnapshot | null;
}

interface ReceiptVoucherManagerProps {
  canManage: boolean;
}

export function ReceiptVoucherManager({ canManage }: ReceiptVoucherManagerProps) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const printRef = useRef<HTMLDivElement>(null);
  const [cancelPostingTarget, setCancelPostingTarget] = useState<ReceiptVoucher | null>(null);
  const [cancelPostingReason, setCancelPostingReason] = useState('');
  const [cancelPostingLoading, setCancelPostingLoading] = useState(false);
  const [postingLoading, setPostingLoading] = useState<string | null>(null);
  const [vouchers, setVouchers] = useState<ReceiptVoucher[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allocationTargets, setAllocationTargets] = useState<AllocationTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<ReceiptVoucher | null>(null);
  const [voucherAllocations, setVoucherAllocations] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [allocations, setAllocations] = useState<{ targetId: string; targetType: 'invoice' | 'salesorder'; amount: number }[]>([]);
  const [roundingTolerance, setRoundingTolerance] = useState(100);

  const [formData, setFormData] = useState({
    voucher_date: new Date().toISOString().split('T')[0],
    customer_id: '',
    payment_method: 'bank_transfer',
    bank_account_id: '',
    reference_number: '',
    amount: 0,
    exchange_rate: 1,
    description: '',
  });

  useEffect(() => {
    loadVouchers();
    loadCustomers();
    loadBankAccounts();
    loadCompanySettings();
  }, []);

  const loadCompanySettings = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('rounding_tolerance_amount')
      .limit(1)
      .maybeSingle();

    if (data) {
      setRoundingTolerance(Number(data.rounding_tolerance_amount ?? 100));
    }
  };

  useEffect(() => {
    if (formData.customer_id) {
      loadAllocationTargets(formData.customer_id);
    } else {
      setAllocationTargets([]);
      setAllocations([]);
    }
  }, [formData.customer_id]);

  const loadVouchers = async () => {
    try {
      const { data, error } = await supabase
        .from('receipt_vouchers')
        .select('*, customers(company_name), bank_accounts(account_name, bank_name, alias, currency), is_posted, journal_entry_id, company_snapshot')
        .order('voucher_date', { ascending: false });

      if (error) throw error;

      // Load allocations for each voucher
      const vouchersWithAllocations = await Promise.all(
        (data || []).map(async (voucher) => {
          const { data: allocations } = await supabase
            .from('voucher_allocations')
            .select(`
              allocated_amount,
              sales_invoice_id,
              sales_order_id,
              sales_invoices(invoice_number),
              sales_orders(so_number)
            `)
            .eq('receipt_voucher_id', voucher.id);

          // Build display text
          let allocated_to = '-';
          if (allocations && allocations.length > 0) {
            const displays = allocations.map(alloc => {
              if (alloc.sales_invoice_id && alloc.sales_invoices) {
                const invoice = Array.isArray(alloc.sales_invoices) ? alloc.sales_invoices[0] : alloc.sales_invoices;
                return `${invoice?.invoice_number} (Invoice)`;
              } else if (alloc.sales_order_id && alloc.sales_orders) {
                const order = Array.isArray(alloc.sales_orders) ? alloc.sales_orders[0] : alloc.sales_orders;
                return `${order?.so_number} (Advance)`;
              }
              return null;
            }).filter(Boolean);

            allocated_to = displays.length > 0 ? displays.join(', ') : '-';
          }

          return { ...voucher, allocated_to };
        })
      );

      setVouchers(vouchersWithAllocations);
    } catch (error) {
      console.error('Error loading vouchers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    const { data } = await supabase
      .from('customers')
      .select('id, company_name')
      .eq('is_active', true)
      .order('company_name');
    setCustomers(data || []);
  };

  const loadBankAccounts = async () => {
    const { data } = await supabase.from('bank_accounts').select('id, account_name, bank_name, account_number, alias, currency').eq('is_active', true);
    setBankAccounts(data || []);
  };

  const loadAllocationTargets = async (customerId: string, keepExistingAllocations = false, voucherId?: string) => {
    try {
      // Load invoices with calculated balance using RPC function
      // When editing (voucherId provided), exclude current voucher's allocations so balance shows correctly
      const { data: allInvoicesData } = await supabase
        .rpc('get_invoices_with_balance', {
          customer_uuid: customerId,
          exclude_voucher_uuid: voucherId || null
        });

      // Filter for unpaid/partially paid invoices
      const invoices = (allInvoicesData || []).filter((inv: SalesInvoice) => inv.balance_amount > 0);

      // Load sales orders (any active status - exclude cancelled/closed)
      const { data: salesOrders } = await supabase
        .from('sales_orders')
        .select('id, so_number, so_date, total_amount, advance_payment_amount, advance_payment_status, status')
        .eq('customer_id', customerId)
        .not('status', 'in', '(cancelled,closed)')
        .order('so_date');

      let additionalInvoices: any[] = [];
      let additionalSOs: any[] = [];

      // If editing, also load already-allocated invoices/SOs (even if fully paid)
      if (voucherId) {
        const { data: existingAllocs } = await supabase
          .from('voucher_allocations')
          .select('sales_invoice_id, sales_order_id')
          .eq('receipt_voucher_id', voucherId);

        if (existingAllocs) {
          const invoiceIds = existingAllocs.filter(a => a.sales_invoice_id).map(a => a.sales_invoice_id);
          const soIds = existingAllocs.filter(a => a.sales_order_id).map(a => a.sales_order_id);

          if (invoiceIds.length > 0) {
            // Get all invoices with balance calculation excluding current voucher, filter for linked ones
            const { data: allInvsData } = await supabase
              .rpc('get_invoices_with_balance', {
                customer_uuid: customerId,
                exclude_voucher_uuid: voucherId || null
              });

            additionalInvoices = (allInvsData || []).filter((inv: SalesInvoice) =>
              invoiceIds.includes(inv.id)
            );
          }

          if (soIds.length > 0) {
            const { data: linkedSOs } = await supabase
              .from('sales_orders')
              .select('id, so_number, so_date, total_amount, advance_payment_amount, advance_payment_status, status')
              .in('id', soIds);
            additionalSOs = linkedSOs || [];
          }
        }
      }

      // Merge and deduplicate
      const allInvoices = [...(invoices || []), ...additionalInvoices];
      const uniqueInvoices = Array.from(new Map(allInvoices.map(inv => [inv.id, inv])).values());

      const allSOs = [...(salesOrders || []), ...additionalSOs];
      const uniqueSOs = Array.from(new Map(allSOs.map(so => [so.id, so])).values())
        .filter(so => so.advance_payment_status !== 'full');

      // Combine both into allocation targets
      const targets: AllocationTarget[] = [
        ...uniqueSOs.map(so => ({
          ...so,
          balance_due: so.total_amount - (so.advance_payment_amount || 0),
          type: 'salesorder' as const
        })),
        ...uniqueInvoices.map(inv => ({
          ...inv,
          type: 'invoice' as const
        }))
      ];

      setAllocationTargets(targets);
      if (!keepExistingAllocations) {
        setAllocations([]);
      }
    } catch (error) {
      console.error('Error loading allocation targets:', error);
    }
  };

  const handleAllocationChange = (targetId: string, targetType: 'invoice' | 'salesorder', amount: number) => {
    setAllocations(prev => {
      const existing = prev.find(a => a.targetId === targetId);
      if (existing) {
        if (amount <= 0) {
          return prev.filter(a => a.targetId !== targetId);
        }
        return prev.map(a => a.targetId === targetId ? { ...a, amount } : a);
      }
      if (amount > 0) {
        return [...prev, { targetId, targetType, amount }];
      }
      return prev;
    });
  };

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const formCurrency = bankAccounts.find(bank => bank.id === formData.bank_account_id)?.currency || 'IDR';
  const voucherCurrency = (voucher: ReceiptVoucher) => voucher.bank_accounts?.currency || 'IDR';

  const getInvoiceAllocationPreview = (target: AllocationTarget) => {
    if (target.type !== 'invoice') {
      return { roundingAdjustment: 0, invoiceClosed: false };
    }

    const allocated = allocations.find(a => a.targetId === target.id)?.amount || 0;
    const residual = target.balance_amount - allocated;
    const withinTolerance = allocated > 0 && Math.abs(residual) > 0 && Math.abs(residual) <= roundingTolerance;

    return {
      roundingAdjustment: withinTolerance ? residual : 0,
      invoiceClosed: withinTolerance || Math.abs(residual) === 0,
    };
  };

  const handlePrint = async () => {
    if (!printRef.current || !selectedVoucher) return;
    if (!selectedVoucher.company_snapshot) {
      alert('Cannot print: this voucher has no company_snapshot. Ask an admin to run the snapshot backfill migration.');
      return;
    }
    await waitForImages(printRef.current);

    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Receipt-${selectedVoucher.voucher_number}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      showToast({ type: 'error', title: 'Error', message: 'Error generating PDF. Please try again.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (allocations.length > 0 && totalAllocated > formData.amount) {
      showToast({ type: 'error', title: 'Error', message: 'Total allocated amount cannot exceed payment amount' });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (editMode && selectedVoucher?.is_posted) {
        showToast({ type: 'error', title: 'Posted', message: 'Cannot edit a posted receipt voucher. Cancel posting first.' });
        return;
      }

      const currency = (bankAccounts.find(bank => bank.id === formData.bank_account_id)?.currency || 'IDR') as 'IDR' | 'USD';
      if (currency === 'USD' && formData.exchange_rate <= 1) throw new Error('Enter a valid USD-to-IDR exchange rate');
      await saveReceiptVoucher(
        editMode && selectedVoucher ? selectedVoucher.id : null,
        {
          voucher_date: formData.voucher_date,
          customer_id: formData.customer_id,
          payment_method: formData.payment_method,
          bank_account_id: formData.bank_account_id || null,
          reference_number: formData.reference_number || null,
          amount: formData.amount,
          description: formData.description || null,
          transaction_currency: currency,
          exchange_rate: currency === 'IDR' ? 1 : formData.exchange_rate,
          created_by: user.id,
        },
        allocations.map(alloc => ({
          sales_invoice_id: alloc.targetType === 'invoice' ? alloc.targetId : null,
          sales_order_id: alloc.targetType === 'salesorder' ? alloc.targetId : null,
          amount: alloc.amount,
        })),
      );

      setModalOpen(false);
      resetForm();
      loadVouchers();
    } catch (error: any) {
      console.error('Error saving voucher:', error);
      showToast({ type: 'error', title: 'Error', message: 'Failed to save: ' + error.message });
    }
  };

  const resetForm = () => {
    setFormData({
      voucher_date: new Date().toISOString().split('T')[0],
      customer_id: '',
      payment_method: 'bank_transfer',
      bank_account_id: '',
      reference_number: '',
      amount: 0,
      exchange_rate: 1,
      description: '',
    });
    setAllocations([]);
    setAllocationTargets([]);
    setEditMode(false);
    setSelectedVoucher(null);
  };

  const handlePostVoucher = async (v: ReceiptVoucher) => {
    if (!profile?.id) return;
    setPostingLoading(v.id);
    try {
      const { error } = await supabase.rpc('post_receipt_voucher', {
        p_rv_id: v.id,
        p_posted_by: profile.id,
      });
      if (error) throw error;
      loadVouchers();
    } catch (err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to post: ' + supabaseErrorMessage(err) });
    } finally {
      setPostingLoading(null);
    }
  };

  const openCancelPostingModal = (v: ReceiptVoucher) => {
    setCancelPostingTarget(v);
    setCancelPostingReason('');
  };

  const handleCancelPostingConfirm = async () => {
    if (!cancelPostingTarget || !profile?.id) return;
    setCancelPostingLoading(true);
    try {
      const { error } = await supabase.rpc('cancel_receipt_voucher_posting', {
        p_rv_id: cancelPostingTarget.id,
        p_cancelled_by: profile.id,
        p_reason: cancelPostingReason || null,
      });
      if (error) {
        if (error.message?.includes('period') && error.message?.includes('closed')) {
          showToast({ type: 'error', title: 'Period Closed', message: 'Cannot cancel posting: the accounting period for this voucher is closed.' });
          return;
        }
        throw error;
      }
      setCancelPostingTarget(null);
      setCancelPostingReason('');
      loadVouchers();
    } catch (err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to cancel posting: ' + supabaseErrorMessage(err) });
    } finally {
      setCancelPostingLoading(false);
    }
  };

  const handleView = async (voucher: ReceiptVoucher) => {
    setSelectedVoucher(voucher);

    // Load allocations for this voucher
    const { data: allocs } = await supabase
      .from('voucher_allocations')
      .select(`
        *,
        sales_invoices(invoice_number, total_amount),
        sales_orders(so_number, total_amount)
      `)
      .eq('receipt_voucher_id', voucher.id);

    setVoucherAllocations(allocs || []);
    setViewModalOpen(true);
  };

  const handleEdit = async (voucher: ReceiptVoucher) => {
    if (voucher.is_posted) {
      showToast({ type: 'error', title: 'Posted', message: 'This receipt voucher has been posted to the GL. Cancel posting first to edit it.' });
      return;
    }
    setSelectedVoucher(voucher);
    setEditMode(true);

    // Populate form with existing data
    setFormData({
      voucher_date: voucher.voucher_date,
      customer_id: voucher.customer_id,
      payment_method: voucher.payment_method,
      bank_account_id: voucher.bank_account_id || '',
      reference_number: voucher.reference_number || '',
      amount: voucher.amount,
      exchange_rate: voucher.exchange_rate || 1,
      description: voucher.description || '',
    });

    // Load allocation targets for this customer (pass voucher ID to include already-allocated docs)
    await loadAllocationTargets(voucher.customer_id, false, voucher.id);

    // THEN load existing allocations (after targets are loaded)
    const { data: allocs } = await supabase
      .from('voucher_allocations')
      // perf: projected columns (was select('*'))
      .select('id, sales_invoice_id, sales_order_id, allocated_amount')
      .eq('receipt_voucher_id', voucher.id);

    if (allocs) {
      const existingAllocs = allocs.map(a => ({
        targetId: a.sales_invoice_id || a.sales_order_id,
        targetType: (a.sales_invoice_id ? 'invoice' : 'salesorder') as 'invoice' | 'salesorder',
        amount: Number(a.allocated_amount)
      }));
      setAllocations(existingAllocs);
    }

    setModalOpen(true);
  };

  const handleDelete = async (voucher: ReceiptVoucher) => {
    if (voucher.is_posted) {
      showToast({ type: 'error', title: 'Posted', message: 'This receipt voucher has been posted to the GL. Cancel posting first to delete it.' });
      return;
    }
    if (!await showConfirm({ title: 'Confirm', message: `Delete receipt voucher ${voucher.voucher_number}? This will remove all allocations and cannot be undone.`, variant: 'danger', confirmLabel: 'Delete' })) {
      return;
    }

    try {
      await supabase
        .from('voucher_allocations')
        .delete()
        .eq('receipt_voucher_id', voucher.id);

      const { data: linkedBankLines } = await supabase
        .from('bank_statement_lines')
        .select('id')
        .eq('matched_receipt_id', voucher.id);

      if (linkedBankLines && linkedBankLines.length > 0) {
        await supabase
          .from('bank_statement_lines')
          .update({
            matched_receipt_id: null,
            reconciliation_status: 'unmatched',
            matched_at: null,
            matched_by: null,
          })
          .eq('matched_receipt_id', voucher.id);
      }

      const { error } = await supabase
        .from('receipt_vouchers')
        .delete()
        .eq('id', voucher.id);

      if (error) throw error;

      alert('Receipt voucher deleted successfully');
      loadVouchers();
    } catch (error: any) {
      console.error('Error deleting voucher:', error);
      alert('Failed to delete: ' + error.message);
    }
  };

  // HARDENING FIX #6: Add null-safety to prevent crashes
  const filteredVouchers = vouchers.filter(v =>
    v.voucher_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.customers?.company_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Shared title strip — matches every other Finance page */}
      <div className="flex items-center justify-between h-8 px-2 bg-white border border-gray-200 rounded">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xs font-bold text-gray-900 truncate">Receipt Vouchers</h1>
          <span className="text-[10px] text-gray-400 truncate">Customer receipts and invoice allocation</span>
        </div>
        {canManage && (
          <button
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="inline-flex items-center gap-1 h-7 px-2 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700"
          >
            <ArrowDownCircle className="w-3 h-3" /> New Receipt
          </button>
        )}
      </div>

      {/* Toolbar — search */}
      <div className="flex items-center gap-2 min-h-8 px-2 py-1 bg-white border border-gray-200 rounded flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 w-3 h-3" />
          <input
            type="text"
            placeholder="Search receipts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded"
          />
        </div>
      </div>

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Voucher No</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Bank</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Allocated To</th>
              <th className="px-2 py-1.5 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredVouchers.map(voucher => (
              <tr key={voucher.id} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 font-mono text-sm">{voucher.voucher_number}</td>
                <td className="px-2 py-1.5">{new Date(voucher.voucher_date).toLocaleDateString('id-ID')}</td>
                <td className="px-2 py-1.5">{voucher.customers?.company_name}</td>
                <td className="px-2 py-1.5">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs capitalize">
                    {voucher.payment_method.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-sm">
                  {voucher.bank_accounts?.alias || voucher.bank_accounts?.account_name || '-'}
                </td>
                <td className="px-2 py-1.5 text-sm text-gray-600">{voucher.allocated_to}</td>
                <td className="px-2 py-1.5 text-right font-medium text-green-600">
                  {formatCurrency(voucher.amount, voucherCurrency(voucher))}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => handleView(voucher)}
                      className="p-1.5 text-gray-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {canManage && !voucher.is_posted && (
                      <>
                        <button
                          onClick={() => handlePostVoucher(voucher)}
                          disabled={postingLoading === voucher.id}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                          title="Post to GL"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleEdit(voucher)}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(voucher)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {voucher.is_posted && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                        <Lock className="w-3 h-3" /> Posted
                      </span>
                    )}
                    {voucher.is_posted && isAdmin && (
                      <button
                        onClick={() => openCancelPostingModal(voucher)}
                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                        title="Cancel Posting"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredVouchers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No receipt vouchers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <FinanceModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); resetForm(); }}
        title={editMode ? "Edit Receipt Voucher" : "New Receipt Voucher"}
        size="lg"
        footer={
          <>
            <button type="button" onClick={() => { setModalOpen(false); resetForm(); }} className={F_BTN_SECONDARY}>
              Cancel
            </button>
            <button type="submit" form="receipt-voucher-form" className={`${F_BTN_PRIMARY} bg-green-600 hover:bg-green-700`}>
              {editMode ? 'Update Receipt' : 'Save Receipt'}
            </button>
          </>
        }
      >
        <form id="receipt-voucher-form" onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          <SapRow>
            <SapField label="Date" required span={4}>
              <input type="date" required value={formData.voucher_date}
                onChange={(e) => setFormData({ ...formData, voucher_date: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Customer" required span={4}>
              {editMode ? (
                <div className={SAP_INPUT + ' !bg-gray-50 flex items-center'}>
                  {customers.find(c => c.id === formData.customer_id)?.company_name || 'Unknown'}
                </div>
              ) : (
                <SearchableSelect
                  value={formData.customer_id}
                  onChange={(val) => setFormData({ ...formData, customer_id: val })}
                  options={customers.map(c => ({ value: c.id, label: c.company_name }))}
                  placeholder="Select customer"
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
              </select>
            </SapField>
          </SapRow>

          {formCurrency === 'USD' && (
            <SapRow>
              <SapField label="USD to IDR Exchange Rate" required span={4}>
                <input type="number" required min="1.000001" step="0.000001" value={formData.exchange_rate}
                  onChange={(e) => setFormData({ ...formData, exchange_rate: parseFloat(e.target.value) || 0 })}
                  className={SAP_INPUT + ' !text-right !font-mono'} />
              </SapField>
              <SapField label="Functional Amount (IDR)" span={4}>
                <input readOnly value={(formData.amount * formData.exchange_rate).toLocaleString('id-ID')}
                  className={SAP_INPUT + ' !text-right !font-mono !bg-gray-50'} />
              </SapField>
            </SapRow>
          )}

          <SapRow>
            <SapField label={`Amount (${formCurrency})`} required span={formData.payment_method === 'cash' ? 12 : 4}>
              <input type="number" required min="0" step="0.01" value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                className={SAP_INPUT + ' !text-right !font-mono !font-semibold'} />
            </SapField>
            {formData.payment_method !== 'cash' && (
              <>
                <SapField label="Bank Account" span={4}>
                  <select value={formData.bank_account_id}
                    onChange={(e) => setFormData({ ...formData, bank_account_id: e.target.value })}
                    className={SAP_INPUT}>
                    <option value="">Select account</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.alias || `${b.bank_name} - ${b.account_name}`} ({b.currency || 'IDR'})
                      </option>
                    ))}
                  </select>
                </SapField>
                <SapField label="Reference" span={4}>
                  <input type="text" value={formData.reference_number}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    className={SAP_INPUT} placeholder="Check/Transfer reference" />
                </SapField>
              </>
            )}
          </SapRow>

          <SapRow>
            <SapField label="Description" span={12}>
              <input type="text" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={SAP_INPUT} placeholder="Receipt description..." />
            </SapField>
          </SapRow>

          {(allocationTargets.length > 0 || allocations.length > 0 || editMode) && (
            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-700 mb-2">Allocate Payment</h4>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-blue-900 font-medium mb-1">How to allocate:</p>
                <ul className="text-xs text-blue-800 space-y-1 ml-4 list-disc">
                  <li><strong className="text-purple-700">SO (Advance)</strong> = Record advance payment against Sales Order</li>
                  <li><strong className="text-blue-700">Invoice</strong> = Record payment against Sales Invoice</li>
                  <li>Enter amount in "Allocate (Rp)" column to link payment to document</li>
                  <li>You can allocate partial amounts to multiple documents</li>
                </ul>
              </div>
              {allocationTargets.length > 0 ? (
                <div className="max-h-64 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Document</th>
                        <th className="px-3 py-2 text-center">Type</th>
                        <th className="px-3 py-2 text-right">Balance Due</th>
                        <th className="px-3 py-2 text-right">Receipt Amount</th>
                        <th className="px-3 py-2 text-right">Rounding Adjustment</th>
                        <th className="px-3 py-2 text-center">Invoice Closed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allocationTargets.map(target => {
                      const balance = target.type === 'invoice'
                        ? (target as SalesInvoice & { type: 'invoice' }).balance_amount
                        : (target as SalesOrder & { type: 'salesorder' }).balance_due;
                      const docNumber = target.type === 'invoice'
                        ? (target as SalesInvoice & { type: 'invoice' }).invoice_number
                        : (target as SalesOrder & { type: 'salesorder' }).so_number;
                      const docDate = target.type === 'invoice'
                        ? (target as SalesInvoice & { type: 'invoice' }).invoice_date
                        : (target as SalesOrder & { type: 'salesorder' }).so_date;
                      const preview = getInvoiceAllocationPreview(target);
                      const roundingAdjustment = preview.roundingAdjustment;

                      return (
                        <tr key={`${target.type}-${target.id}`}>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs">{docNumber}</div>
                            <div className="text-gray-500 text-xs">{new Date(docDate).toLocaleDateString('id-ID')}</div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              target.type === 'salesorder'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {target.type === 'salesorder' ? 'SO (Advance)' : 'Invoice'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-red-600 font-medium">
                            {formatCurrency(balance, formCurrency)}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={allocations.find(a => a.targetId === target.id)?.amount || ''}
                              onChange={(e) => handleAllocationChange(target.id, target.type, parseFloat(e.target.value) || 0)}
                              className="w-28 px-2 py-1 border rounded text-right text-xs"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-medium">
                            {target.type === 'invoice' ? (
                              <span className={roundingAdjustment === 0 ? 'text-gray-400' : 'text-amber-700'}>
                                {formatCurrency(roundingAdjustment, formCurrency)}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-xs font-medium">
                            {target.type === 'invoice' ? (
                              <span className={`px-2 py-0.5 rounded ${preview.invoiceClosed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {preview.invoiceClosed ? 'Yes' : 'No'}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              ) : (
                <div className="border rounded-lg p-4 text-center text-gray-500 text-sm">
                  <p>No unpaid invoices or sales orders found for this customer.</p>
                  {editMode && allocations.length > 0 && (
                    <p className="mt-2 text-xs">This voucher had allocations that are now fully paid or no longer available.</p>
                  )}
                </div>
              )}
              <div className="mt-3 flex justify-between items-center text-sm">
                <div className="text-gray-600">
                  <span className="font-medium">{allocations.length}</span> allocation(s)
                </div>
                <div className="text-right">
                  <span className="text-gray-500">Total Allocated:</span>
                  <span className={`ml-2 font-bold text-lg ${totalAllocated > formData.amount ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(totalAllocated, formCurrency)}
                  </span>
                  <span className="text-gray-400 ml-1">/ {formatCurrency(formData.amount, formCurrency)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Rounding tolerance: Rp {roundingTolerance.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

        </form>
      </FinanceModal>

      {/* View Details Modal */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => { setViewModalOpen(false); setSelectedVoucher(null); setVoucherAllocations([]); }}
        title="Receipt Voucher Details"
      >
        {selectedVoucher && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Voucher Number</label>
                <p className="font-mono font-medium">{selectedVoucher.voucher_number}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Date</label>
                <p>{new Date(selectedVoucher.voucher_date).toLocaleDateString('id-ID')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Customer</label>
                <p>{selectedVoucher.customers?.company_name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Payment Method</label>
                <p className="capitalize">{selectedVoucher.payment_method.replace('_', ' ')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Bank Account</label>
                <p>{selectedVoucher.bank_accounts?.alias || (selectedVoucher.bank_accounts ? `${selectedVoucher.bank_accounts.bank_name} - ${selectedVoucher.bank_accounts.account_name}` : '-')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Reference</label>
                <p>{selectedVoucher.reference_number || '-'}</p>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-500">Amount</label>
                <p className="text-sm font-bold text-green-600">{formatCurrency(selectedVoucher.amount, voucherCurrency(selectedVoucher))}</p>
              </div>
              {selectedVoucher.description && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-500">Description</label>
                  <p className="text-gray-700">{selectedVoucher.description}</p>
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-700 mb-3">Allocations</h4>
              {voucherAllocations.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Document</th>
                        <th className="px-3 py-2 text-center">Type</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {voucherAllocations.map((alloc, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-mono text-xs">
                            {alloc.sales_invoices ? alloc.sales_invoices.invoice_number : alloc.sales_orders?.so_number}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              alloc.sales_order_id
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {alloc.sales_order_id ? 'SO (Advance)' : 'Invoice'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatCurrency(alloc.allocated_amount, voucherCurrency(selectedVoucher))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No allocations</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                {selectedVoucher.is_posted ? (
                  <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                    <Lock className="w-3 h-3" /> Posted
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">Draft</span>
                )}
                {selectedVoucher.is_posted && isAdmin && (
                  <button
                    onClick={() => { setViewModalOpen(false); openCancelPostingModal(selectedVoucher); }}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
                  >
                    <RotateCcw className="w-3 h-3" /> Cancel Posting
                  </button>
                )}
                {!selectedVoucher.is_posted && canManage && (
                  <button
                    onClick={() => { setViewModalOpen(false); handlePostVoucher(selectedVoucher); }}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium border border-green-300 text-green-700 rounded hover:bg-green-50"
                  >
                    <CheckCircle className="w-3 h-3" /> Post to GL
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print PDF
                </button>
                <button
                  onClick={() => { setViewModalOpen(false); setSelectedVoucher(null); setVoucherAllocations([]); }}
                  className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {cancelPostingTarget && (
        <Modal
          isOpen={!!cancelPostingTarget}
          onClose={() => { setCancelPostingTarget(null); setCancelPostingReason(''); }}
          title={`Cancel GL Posting — ${cancelPostingTarget.voucher_number}`}
        >
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              This will delete the journal entry for this receipt voucher and reset it to Draft. The voucher will need to be re-posted after any edits.
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

      {/* Hidden Print Format */}
      {selectedVoucher && (
        <div ref={printRef} style={{ position: 'absolute', left: '-9999px', width: '210mm', padding: '15mm', backgroundColor: '#fff' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '20px', borderBottom: '2px solid #333', paddingBottom: '15px' }}>
            {/* selectedVoucher.company_snapshot is guaranteed non-null here — handlePrint refuses to run without it. */}
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#1a1a1a' }}>
              {selectedVoucher.company_snapshot?.company_name ?? '—'}
            </h1>
            {selectedVoucher.company_snapshot?.company_address && (
              <p style={{ fontSize: '11px', margin: '0', color: '#666' }}>{selectedVoucher.company_snapshot.company_address}</p>
            )}
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '15px 0 0 0', color: '#2563eb' }}>
              RECEIPT VOUCHER
            </h2>
          </div>

          {/* Voucher Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
            <div>
              <p style={{ fontSize: '11px', fontWeight: '600', color: '#666', margin: '0 0 3px 0' }}>Voucher No:</p>
              <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0', fontFamily: 'monospace' }}>
                {selectedVoucher.voucher_number}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '11px', fontWeight: '600', color: '#666', margin: '0 0 3px 0' }}>Date:</p>
              <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0' }}>
                {new Date(selectedVoucher.voucher_date).toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
            </div>
          </div>

          {/* Received From */}
          <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
            <p style={{ fontSize: '11px', fontWeight: '600', color: '#666', margin: '0 0 5px 0' }}>Received From:</p>
            <p style={{ fontSize: '15px', fontWeight: 'bold', margin: '0', color: '#1a1a1a' }}>
              {selectedVoucher.customers?.company_name}
            </p>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#dbeafe', borderRadius: '8px', border: '2px solid #2563eb' }}>
            <p style={{ fontSize: '11px', fontWeight: '600', color: '#1e40af', margin: '0 0 5px 0' }}>Amount Received:</p>
            <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#1e40af' }}>
              {formatCurrency(selectedVoucher.amount, voucherCurrency(selectedVoucher))}
            </p>
          </div>

          {/* Payment Details */}
          <div style={{ marginBottom: '20px' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '8px 0', fontWeight: '600', color: '#666', width: '35%' }}>Payment Method:</td>
                  <td style={{ padding: '8px 0', textTransform: 'capitalize' }}>
                    {selectedVoucher.payment_method.replace('_', ' ')}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', fontWeight: '600', color: '#666' }}>Bank Account:</td>
                  <td style={{ padding: '8px 0' }}>
                    {selectedVoucher.bank_accounts?.alias ||
                     (selectedVoucher.bank_accounts ?
                      `${selectedVoucher.bank_accounts.bank_name} - ${selectedVoucher.bank_accounts.account_name}` :
                      '-')}
                  </td>
                </tr>
                {selectedVoucher.reference_number && (
                  <tr>
                    <td style={{ padding: '8px 0', fontWeight: '600', color: '#666' }}>Reference:</td>
                    <td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{selectedVoucher.reference_number}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Allocations */}
          {voucherAllocations.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 10px 0', color: '#1a1a1a' }}>
                Allocation Details:
              </p>
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #d1d5db' }}>Document</th>
                    <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #d1d5db' }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #d1d5db' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {voucherAllocations.map((alloc, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '8px', borderBottom: idx < voucherAllocations.length - 1 ? '1px solid #e5e7eb' : 'none', fontFamily: 'monospace' }}>
                        {alloc.sales_invoices ? alloc.sales_invoices.invoice_number : alloc.sales_orders?.so_number}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', borderBottom: idx < voucherAllocations.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                        {alloc.sales_order_id ? 'SO (Advance)' : 'Invoice'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: idx < voucherAllocations.length - 1 ? '1px solid #e5e7eb' : 'none', fontWeight: '600' }}>
                        {formatCurrency(alloc.allocated_amount, voucherCurrency(selectedVoucher))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Description */}
          {selectedVoucher.description && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '11px', fontWeight: '600', color: '#666', margin: '0 0 5px 0' }}>Description:</p>
              <p style={{ fontSize: '12px', margin: '0', color: '#1a1a1a' }}>{selectedVoucher.description}</p>
            </div>
          )}

          {/* Signature Section */}
          <div style={{ marginTop: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ height: '60px' }}></div>
              <div style={{ borderTop: '1px solid #333', paddingTop: '5px' }}>
                <p style={{ fontSize: '11px', fontWeight: '600', margin: '0' }}>Received By</p>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ height: '60px' }}></div>
              <div style={{ borderTop: '1px solid #333', paddingTop: '5px' }}>
                <p style={{ fontSize: '11px', fontWeight: '600', margin: '0' }}>Approved By</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: '30px', textAlign: 'center', paddingTop: '15px', borderTop: '1px solid #e5e7eb' }}>
            <p style={{ fontSize: '10px', color: '#999', margin: '0' }}>
              This is a computer-generated document. No signature required.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
