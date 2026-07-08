import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useFinance } from '../../contexts/FinanceContext';
import { Search, FileText, Edit, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { showToast } from '../ToastNotification';
import { showConfirm } from '../ConfirmDialog';

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  source_module: string | null;
  reference_number: string | null;
  description: string | null;
  total_debit: number;
  total_credit: number;
  is_posted: boolean;
  posted_at: string;
}

interface JournalEntryLine {
  id: string;
  line_number: number;
  account_id: string;
  description: string | null;
  debit: number;
  credit: number;
  chart_of_accounts?: {
    code: string;
    name: string;
  };
  customers?: { company_name: string } | null;
  suppliers?: { company_name: string } | null;
}

interface VoucherJournalEntry {
  journal_entry_id: string;
  date: string;
  voucher_no: string;
  voucher_type: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  narration: string;
  reference_number: string | null;
  source_module: string | null;
  line_count: number;
  is_multi_line: boolean;
}

interface JournalEntryViewerEnhancedProps {
  canManage: boolean;
  onEditEntry?: (entryId: string) => void;
}

const sourceModuleLabels: Record<string, string> = {
  sales_invoice: 'Sales Invoice',
  sales_invoice_cogs: 'COGS Entry',
  purchase_invoice: 'Purchase Invoice',
  receipt: 'Receipt Voucher',
  payment: 'Payment Voucher',
  petty_cash: 'Petty Cash',
  fund_transfer: 'Fund Transfer',
  manual: 'Manual Entry',
};

export function JournalEntryViewerEnhanced({ canManage, onEditEntry }: JournalEntryViewerEnhancedProps) {
  const { dateRange } = useFinance();
  const [voucherEntries, setVoucherEntries] = useState<VoucherJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [entryLines, setEntryLines] = useState<JournalEntryLine[]>([]);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [filterModule, setFilterModule] = useState('all');

  useEffect(() => {
    loadVoucherJournal();
  }, [dateRange, filterModule]);

  const loadVoucherJournal = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('journal_voucher_view')
        .select('*')
        .gte('date', dateRange.startDate)
        .lte('date', dateRange.endDate);

      if (filterModule !== 'all') {
        query = query.eq('source_module', filterModule);
      }

      const { data, error } = await query;

      if (error) throw error;
      setVoucherEntries(data || []);
    } catch (error) {
      console.error('Error loading voucher journal:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEntryLines = async (entryId: string) => {
    try {
      const { data, error } = await supabase
        .from('journal_entry_lines')
        .select('*, chart_of_accounts(code, name), customers(company_name), suppliers(company_name)')
        .eq('journal_entry_id', entryId)
        .order('line_number');

      if (error) throw error;
      setEntryLines(data || []);
    } catch (error) {
      console.error('Error loading lines:', error);
    }
  };

  const handleViewVoucher = async (voucherEntry: VoucherJournalEntry) => {
    try {
      const { data: entry, error: entryError } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('id', voucherEntry.journal_entry_id)
        .single();

      if (entryError) throw entryError;

      setSelectedEntry(entry);
      await loadEntryLines(voucherEntry.journal_entry_id);
      setViewModalOpen(true);
    } catch (error) {
      console.error('Error loading voucher details:', error);
    }
  };

  const handleDeleteJournal = async (journalId: string) => {
    const confirmed = await showConfirm({
      title: 'Delete Journal Entry',
      message: 'Are you sure you want to delete this manual journal entry? This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      const { data: bankLinks, error: checkError } = await supabase
        .from('bank_statement_lines')
        .select('id')
        .eq('matched_entry_id', journalId)
        .limit(1);

      if (checkError) throw checkError;

      if (bankLinks && bankLinks.length > 0) {
        showToast('Cannot delete: this entry is linked to a bank statement. Unlink it first from Bank Reconciliation.', 'error');
        return;
      }

      const { error: linesError } = await supabase
        .from('journal_entry_lines')
        .delete()
        .eq('journal_entry_id', journalId);

      if (linesError) throw linesError;

      const { error: entryError } = await supabase
        .from('journal_entries')
        .delete()
        .eq('id', journalId)
        .eq('source_module', 'manual');

      if (entryError) throw entryError;

      showToast('Journal entry deleted successfully', 'success');
      loadVoucherJournal();
    } catch (error: unknown) {
      console.error('Error deleting journal:', error);
      showToast('Error deleting journal entry: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
    }
  };

  const filteredVouchers = voucherEntries.filter(v =>
    v.voucher_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.debit_account && v.debit_account.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (v.credit_account && v.credit_account.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (v.narration && v.narration.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (v.reference_number && v.reference_number.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totals = {
    debit: filteredVouchers.reduce((sum, v) => sum + v.amount, 0),
    credit: filteredVouchers.reduce((sum, v) => sum + v.amount, 0),
  };

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-2">
      {/* Filters */}
      <div className="flex items-center gap-1.5 min-h-8 px-2 py-1 bg-white border border-gray-200 rounded flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search voucher, accounts, narration..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="h-7 px-2 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All Sources</option>
          <option value="sales_invoice">Sales Invoices</option>
          <option value="sales_invoice_cogs">COGS</option>
          <option value="purchase_invoice">Purchase Invoices</option>
          <option value="receipt">Receipts</option>
          <option value="payment">Payments</option>
          <option value="expenses">Expenses</option>
          <option value="petty_cash">Petty Cash</option>
          <option value="fund_transfers">Fund Transfers</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Journal Voucher View (Tally Style) - One row per voucher */}
      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr className="h-8">
                <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Date</th>
                <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Type</th>
                <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Debit Account</th>
                <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Credit Account</th>
                <th className="px-2 py-1 text-right font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Amount</th>
                <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Narration</th>
                <th className="px-2 py-1 text-center font-semibold text-[11px] text-gray-600 uppercase tracking-wide whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVouchers.map((voucher) => (
                <tr key={voucher.journal_entry_id} className="h-8 border-b border-gray-100 hover:bg-blue-50/40 transition-colors">
                  <td className="px-2 py-1 whitespace-nowrap text-gray-800">
                    {new Date(voucher.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-gray-100 text-gray-600">
                      {voucher.voucher_type}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <div className="text-gray-800 max-w-xs truncate">
                      {voucher.debit_account || '—'}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <div className="text-gray-800 max-w-xs truncate">
                      {voucher.credit_account || '—'}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-gray-900 whitespace-nowrap">
                    Rp {Number(voucher.amount || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1 text-gray-600">
                    <div className="max-w-md truncate">
                      {voucher.narration || '—'}
                    </div>
                  </td>
                  <td className="px-1 py-0.5 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={() => handleViewVoucher(voucher)}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="View detailed breakdown"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      {canManage && voucher.source_module === 'manual' && (
                        <>
                          <button
                            onClick={() => onEditEntry?.(voucher.journal_entry_id)}
                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit manual entry"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteJournal(voucher.journal_entry_id)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete manual entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredVouchers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-gray-400">
                    No journal entries found
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr className="h-8">
                <td colSpan={4} className="px-2 py-1 text-right font-semibold text-gray-700">Total:</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-gray-900 font-semibold">
                  Rp {Number(totals.debit || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Voucher Detail Modal */}
      <Modal isOpen={viewModalOpen} onClose={() => setViewModalOpen(false)} title={`Journal Entry: ${selectedEntry?.entry_number}`}>
        {selectedEntry && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Date:</span>
                <span className="ml-2 font-medium">{new Date(selectedEntry.entry_date).toLocaleDateString('id-ID')}</span>
              </div>
              <div>
                <span className="text-gray-500">Source:</span>
                <span className="ml-2">{selectedEntry.source_module ? sourceModuleLabels[selectedEntry.source_module] || selectedEntry.source_module : 'Manual'}</span>
              </div>
              <div>
                <span className="text-gray-500">Reference:</span>
                <span className="ml-2 font-mono">{selectedEntry.reference_number || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Posted:</span>
                <span className="ml-2">{selectedEntry.posted_at ? new Date(selectedEntry.posted_at).toLocaleString('id-ID') : '-'}</span>
              </div>
            </div>

            {selectedEntry.description && (
              <div className="p-3 bg-gray-50 rounded-lg text-sm">
                {selectedEntry.description}
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-1.5 py-1 text-left">Account</th>
                    <th className="px-1.5 py-1 text-left">Description</th>
                    <th className="px-1.5 py-1 text-right">Debit</th>
                    <th className="px-1.5 py-1 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entryLines.map(line => (
                    <tr key={line.id}>
                      <td className="px-1.5 py-1">
                        <div className="font-mono text-xs text-gray-500">{line.chart_of_accounts?.code}</div>
                        <div>{line.chart_of_accounts?.name}</div>
                        {line.customers && <div className="text-xs text-blue-600">{line.customers.company_name}</div>}
                        {line.suppliers && <div className="text-xs text-orange-600">{line.suppliers.company_name}</div>}
                      </td>
                      <td className="px-1.5 py-1 text-gray-600">{line.description || '-'}</td>
                      <td className="px-1.5 py-1 text-right text-blue-600">
                        {Number(line.debit) > 0 ? `Rp ${Number(line.debit).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                      <td className="px-1.5 py-1 text-right text-green-600">
                        {Number(line.credit) > 0 ? `Rp ${Number(line.credit).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-medium">
                  <tr>
                    <td colSpan={2} className="px-1.5 py-1 text-right">Total:</td>
                    <td className="px-1.5 py-1 text-right text-blue-700">
                      Rp {Number(selectedEntry.total_debit || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-1.5 py-1 text-right text-green-700">
                      Rp {Number(selectedEntry.total_credit || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {selectedEntry.total_debit !== selectedEntry.total_credit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                Warning: Debit and Credit totals do not match!
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
