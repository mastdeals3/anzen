import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Download, Calendar, TrendingUp, TrendingDown, ShieldCheck, FileText, Building2 } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import { formatDate } from '../../utils/dateFormat';

interface InputPPNRecord {
  month: string;
  expense_date: string;
  container_ref: string | null;
  supplier: string | null;
  import_invoice_value: number | null;
  ppn_amount: number | null;
  description: string | null;
  document_type?: string | null;
  reference?: string | null;
  parent_supplier?: string | null;
  dpp_amount?: number | null;
}

interface PPh22Record {
  month: string;
  expense_date: string;
  voucher_number: string | null;
  container_ref: string | null;
  supplier: string | null;
  pph22_amount: number | null;
  description: string | null;
}

interface OutputPPNRecord {
  month: string;
  invoice_date: string;
  invoice_number: string;
  customer: string;
  customer_npwp: string;
  subtotal: number | null;
  ppn_amount: number | null;
  total_amount: number | null;
  payment_status: string;
}

interface MonthlySummary {
  month: string;
  input_ppn_paid: number | null;
  output_ppn_collected: number | null;
  net_ppn_payable: number | null;
}

// Expense VAT / PPh records (from finance_expenses)
interface ExpenseVATRecord {
  id: string;
  expense_date: string;
  voucher_number: string | null;
  invoice_number: string | null;
  supplier_name: string | null;
  expense_category: string;
  description: string | null;
  amount: number | null;
  ppn_amount: number | null;
}

interface ExpensePPhRecord {
  id: string;
  expense_date: string;
  voucher_number: string | null;
  invoice_number: string | null;
  supplier_name: string | null;
  expense_category: string;
  description: string | null;
  amount: number | null;
  pph_amount: number | null;
  pph_code: string | null;
  pph_name: string | null;
}

// Asset register (from get_asset_register() RPC)
interface AssetRegisterRecord {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  purchase_date: string;
  asset_account: string | null;
  asset_account_code: string | null;
  cost: number | null;
  description: string | null;
}

export function TaxReports() {
  const { t } = useLanguage();
  const [inputPPN, setInputPPN] = useState<InputPPNRecord[]>([]);
  const [outputPPN, setOutputPPN] = useState<OutputPPNRecord[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary[]>([]);
  const [pph22Records, setPph22Records] = useState<PPh22Record[]>([]);
  const [expenseVAT, setExpenseVAT] = useState<ExpenseVATRecord[]>([]);
  const [expensePPh, setExpensePPh] = useState<ExpensePPhRecord[]>([]);
  const [assetRegister, setAssetRegister] = useState<AssetRegisterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'input' | 'output' | 'pph22' | 'expense_vat' | 'expense_pph' | 'assets'>('summary');
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);

      const [summaryRes, inputRes, outputRes, pph22Res] = await Promise.all([
        supabase.from('vw_monthly_tax_summary').select('*').order('month', { ascending: false }),
        supabase.from('vw_input_ppn_report').select('*'),
        supabase.from('vw_output_ppn_report').select('*'),
        supabase.from('vw_pph22_advance_tax_report').select('*'),
      ]);

      if (summaryRes.error) throw summaryRes.error;
      if (inputRes.error) throw inputRes.error;
      if (outputRes.error) throw outputRes.error;
      // pph22 view is non-critical; warn but don't abort
      if (pph22Res.error) console.warn('PPh22 report error:', pph22Res.error.message);

      setMonthlySummary(summaryRes.data || []);
      setInputPPN(inputRes.data || []);
      setOutputPPN(outputRes.data || []);
      setPph22Records(pph22Res.data || []);

      // Load expense VAT register (expenses with ppn_amount > 0, excluding PIB/import)
      const { data: expVatData } = await supabase
        .from('finance_expenses')
        .select(`
          id, expense_date, voucher_number, invoice_number,
          expense_category, description, amount, ppn_amount,
          suppliers(company_name)
        `)
        .gt('ppn_amount', 0)
        .not('expense_category', 'in', '(pib_import,ppn_import,pph_import)')
        .order('expense_date', { ascending: false });

      setExpenseVAT((expVatData || []).map((r: any) => ({
        id: r.id,
        expense_date: r.expense_date,
        voucher_number: r.voucher_number,
        invoice_number: r.invoice_number,
        supplier_name: r.suppliers?.company_name || null,
        expense_category: r.expense_category,
        description: r.description,
        amount: r.amount,
        ppn_amount: r.ppn_amount,
      })));

      // Load expense PPh register (expenses with pph_amount > 0)
      const { data: expPphData } = await supabase
        .from('finance_expenses')
        .select(`
          id, expense_date, voucher_number, invoice_number,
          expense_category, description, amount, pph_amount,
          suppliers(company_name),
          tax_codes(code, name)
        `)
        .gt('pph_amount', 0)
        .order('expense_date', { ascending: false });

      setExpensePPh((expPphData || []).map((r: any) => ({
        id: r.id,
        expense_date: r.expense_date,
        voucher_number: r.voucher_number,
        invoice_number: r.invoice_number,
        supplier_name: r.suppliers?.company_name || null,
        expense_category: r.expense_category,
        description: r.description,
        amount: r.amount,
        pph_amount: r.pph_amount,
        pph_code: r.tax_codes?.code || null,
        pph_name: r.tax_codes?.name || null,
      })));

      // Load asset register
      const { data: assetData } = await supabase.rpc('get_asset_register');
      setAssetRegister(assetData || []);
    } catch (error: any) {
      console.error('Error loading tax reports:', error.message);
      alert('Failed to load tax reports');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    // Views/RPCs occasionally return NULL for empty months or missing joins.
    // Coerce to 0 so the report never renders "Rp undefined".
    const v = Number(amount ?? 0);
    return `Rp ${(Number.isFinite(v) ? v : 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatMonth = (monthStr: string) => {
    if (!monthStr) return '-';
    const date = new Date(monthStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  const filteredInput = selectedMonth
    ? inputPPN.filter((record) => record.month === selectedMonth)
    : inputPPN;

  const filteredOutput = selectedMonth
    ? outputPPN.filter((record) => record.month === selectedMonth)
    : outputPPN;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between bg-white p-2 rounded-lg shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{t('finance.taxReports') || 'Tax Reports (PPN)'}</h2>
          <p className="text-[10px] text-gray-600">{t('finance.taxReportsDesc') || 'Monthly Input PPN, Output PPN, Net PPN'}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-xs"
        >
          <Download className="w-3.5 h-3.5" />
          {t('common.print') || 'Print'}
        </button>
      </div>

      <div className="flex gap-1.5 border-b border-gray-200 bg-white">
        {[
          { value: 'summary',     label: t('finance.monthlySummary') || 'Monthly Summary', icon: Calendar },
          { value: 'input',       label: t('finance.inputPPN')       || 'Input PPN',       icon: TrendingDown },
          { value: 'output',      label: t('finance.outputPPN')      || 'Output PPN',      icon: TrendingUp },
          { value: 'pph22',       label: 'PPh 22 Advance Tax',                             icon: ShieldCheck },
          { value: 'expense_vat', label: 'Expense VAT Register',                           icon: FileText },
          { value: 'expense_pph', label: 'Expense PPh Register',                           icon: ShieldCheck },
          { value: 'assets',      label: 'Asset Register',                                 icon: Building2 },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value as any)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.value
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500 text-xs">{t('common.loading') || 'Loading tax reports...'}</div>
      ) : (
        <>
          {activeTab === 'summary' && (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <div className="px-1.5 py-1 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-medium text-gray-900">{t('finance.monthlySummary') || 'Monthly Tax Summary'}</h3>
                <p className="text-[10px] text-gray-600">{t('finance.netPPNFormula') || 'Net PPN = Output PPN - Input PPN'}</p>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                      {t('common.month') || 'Month'}
                    </th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                      {t('finance.inputPPNPaid') || 'Input PPN'}
                    </th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                      {t('finance.outputPPNCollected') || 'Output PPN'}
                    </th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                      {t('finance.netPPNPayable') || 'Net PPN Payable'}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {monthlySummary.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-gray-500 text-xs">
                        {t('common.noData') || 'No tax data available'}
                      </td>
                    </tr>
                  ) : (
                    monthlySummary.map((summary, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-1.5 py-1 whitespace-nowrap">
                          <div className="text-xs font-medium text-gray-900">
                            {formatMonth(summary.month)}
                          </div>
                        </td>
                        <td className="px-1.5 py-1 whitespace-nowrap text-right">
                          <div className="text-xs text-blue-600 font-medium">
                            {formatCurrency(summary.input_ppn_paid)}
                          </div>
                        </td>
                        <td className="px-1.5 py-1 whitespace-nowrap text-right">
                          <div className="text-xs text-green-600 font-medium">
                            {formatCurrency(summary.output_ppn_collected)}
                          </div>
                        </td>
                        <td className="px-1.5 py-1 whitespace-nowrap text-right">
                          <div
                            className={`text-xs font-bold ${
                              (summary.net_ppn_payable || 0) > 0
                                ? 'text-red-600'
                                : (summary.net_ppn_payable || 0) < 0
                                ? 'text-blue-600'
                                : 'text-gray-600'
                            }`}
                          >
                            {formatCurrency(summary.net_ppn_payable)}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {(summary.net_ppn_payable || 0) > 0
                              ? t('finance.payToTax') || 'Pay to tax office'
                              : (summary.net_ppn_payable || 0) < 0
                              ? t('finance.carryForward') || 'Carry forward'
                              : t('finance.balanced') || 'Balanced'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'input' && (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <div className="px-1.5 py-1 bg-blue-50 border-b border-blue-200">
                <h3 className="text-sm font-medium text-blue-900">{t('finance.inputPPNReport') || 'Input PPN Report'}</h3>
                <p className="text-[10px] text-blue-700">
                  {t('finance.inputPPNDesc') || 'PPN paid on imports - can be claimed as tax credit'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.date') || 'Date'}
                      </th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.container') || 'Container'}
                      </th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.supplier') || 'Supplier'}
                      </th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                        {t('finance.invoiceValue') || 'Invoice Value'}
                      </th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                        {t('finance.ppnAmount') || 'PPN Amount (11%)'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredInput.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-gray-500 text-xs">
                          {t('common.noRecords') || 'No input PPN records'}
                        </td>
                      </tr>
                    ) : (
                      filteredInput.map((record, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-gray-900">
                            {formatDate(record.expense_date)}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs font-medium text-gray-900">
                            {record.container_ref}
                          </td>
                          <td className="px-1.5 py-1 text-xs text-gray-700">{record.supplier}</td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-right text-gray-900">
                            {formatCurrency(record.import_invoice_value)}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-right font-medium text-blue-600">
                            {formatCurrency(record.ppn_amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'output' && (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <div className="px-1.5 py-1 bg-green-50 border-b border-green-200">
                <h3 className="text-sm font-medium text-green-900">{t('finance.outputPPNReport') || 'Output PPN Report'}</h3>
                <p className="text-[10px] text-green-700">
                  {t('finance.outputPPNDesc') || 'PPN collected from customers - must be paid to tax office'}
                </p>
                <p className="text-[10px] font-semibold text-red-700 mt-1">
                  {t('finance.taxPayableWarning') || '⚠️ Tax is payable based on INVOICE DATE, not payment status!'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.date') || 'Date'}
                      </th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.invoiceNo') || 'Invoice #'}
                      </th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.customer') || 'Customer'}
                      </th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">
                        NPWP
                      </th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                        {t('finance.subtotal') || 'Subtotal'}
                      </th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">
                        {t('finance.ppnAmount') || 'PPN Amount (11%)'}
                      </th>
                      <th className="px-3 py-1.5 text-center text-[10px] font-medium text-gray-500 uppercase">
                        {t('common.paymentStatus') || 'Payment Status'}
                        <div className="text-[10px] font-normal text-gray-500 normal-case">
                          {t('finance.forInfoOnly') || '(For info only - tax due regardless)'}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOutput.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-gray-500 text-xs">
                          {t('common.noRecords') || 'No output PPN records'}
                        </td>
                      </tr>
                    ) : (
                      filteredOutput.map((record, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-gray-900">
                            {formatDate(record.invoice_date)}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs font-medium text-gray-900">
                            {record.invoice_number}
                          </td>
                          <td className="px-1.5 py-1 text-xs text-gray-700">{record.customer}</td>
                          <td className="px-1.5 py-1 text-xs text-gray-600">
                            {record.customer_npwp || '-'}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-right text-gray-900">
                            {formatCurrency(record.subtotal)}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-xs text-right font-medium text-green-600">
                            {formatCurrency(record.ppn_amount)}
                          </td>
                          <td className="px-1.5 py-1 whitespace-nowrap text-center">
                            <span
                              className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                record.payment_status === 'paid'
                                  ? 'bg-green-100 text-green-800'
                                  : record.payment_status === 'partial'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {record.payment_status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'pph22' && (
            <div className="bg-white rounded border border-gray-200 overflow-hidden">
              <div className="px-1.5 py-1 bg-purple-50 border-b border-purple-200">
                <h3 className="text-sm font-medium text-purple-900">PPh 22 Advance Income Tax Report</h3>
                <p className="text-[10px] text-purple-700">
                  PPh 22 paid on imports — recorded as a prepaid asset (account 1155).
                  Use this report when preparing the annual corporate tax return (SPT Tahunan).
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">Voucher</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">Container</th>
                      <th className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase">Supplier</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-medium text-gray-500 uppercase">PPh 22 Amount</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pph22Records.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-gray-500 text-xs">
                          No PPh 22 records found
                        </td>
                      </tr>
                    ) : (
                      <>
                        {pph22Records.map((record, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-1.5 py-1 whitespace-nowrap text-xs text-gray-900">
                              {formatDate(record.expense_date)}
                            </td>
                            <td className="px-1.5 py-1 whitespace-nowrap text-xs font-mono text-gray-600">
                              {record.voucher_number || '—'}
                            </td>
                            <td className="px-1.5 py-1 whitespace-nowrap text-xs font-medium text-gray-900">
                              {record.container_ref}
                            </td>
                            <td className="px-1.5 py-1 text-xs text-gray-700">{record.supplier}</td>
                            <td className="px-1.5 py-1 whitespace-nowrap text-xs text-right font-medium text-purple-600">
                              {formatCurrency(record.pph22_amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-purple-50 font-bold">
                          <td colSpan={4} className="px-1.5 py-1 text-xs text-right text-gray-900">Total PPh 22 Dibayar Dimuka:</td>
                          <td className="px-1.5 py-1 text-xs text-right text-purple-700">
                            {formatCurrency(pph22Records.reduce((s, r) => s + (r.pph22_amount || 0), 0))}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-1.5 py-1 bg-purple-50 border-t border-purple-200">
                <p className="text-[10px] text-purple-800">
                  <strong>Account 1155 — PPh 22 Dibayar Dimuka</strong>: This balance reduces your annual income tax liability.
                  During annual tax filing, this asset is applied against the corporate tax payable (SPT Tahunan Badan).
                </p>
              </div>
            </div>
          )}
          {/* ── Expense VAT 