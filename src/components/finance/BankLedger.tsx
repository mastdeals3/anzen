import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useFinance } from '../../contexts/FinanceContext';
import { formatCurrency } from '../../utils/currency';

interface BankAccount {
  id: string;
  coa_id: string | null;
  bank_name: string;
  account_number: string;
  currency: string;
}

interface LedgerEntry {
  id: string;
  journal_entry_id: string;
  entry_date: string;
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
  running_balance: number;
}

interface BankLedgerProps {
  selectedBank?: string;
  onOpenJournal?: (journalEntryId: string) => void;
}

export default function BankLedger({ selectedBank: propSelectedBank, onOpenJournal }: BankLedgerProps) {
  const { dateRange } = useFinance();
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState('');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void supabase
      .from('bank_accounts')
      .select('id, coa_id, bank_name, account_number, currency')
      .eq('is_active', true)
      .order('bank_name')
      .then(({ data }) => setBanks((data || []) as BankAccount[]));
  }, []);

  useEffect(() => {
    if (propSelectedBank) setSelectedBank(propSelectedBank);
  }, [propSelectedBank]);

  const loadLedgerEntries = async () => {
    const bank = banks.find(item => item.id === selectedBank);
    if (!bank?.coa_id) {
      setEntries([]);
      setOpeningBalance(0);
      return;
    }

    setLoading(true);
    try {
      const { data: lines, error } = await supabase
        .from('journal_entry_lines')
        .select(`
          id, journal_entry_id, debit, credit, description,
          journal_entries!inner(
            entry_date, entry_number, reference_number, description,
            is_posted, is_reversed
          )
        `)
        .eq('account_id', bank.coa_id)
        .eq('journal_entries.is_posted', true)
        .eq('journal_entries.is_reversed', false)
        .lte('journal_entries.entry_date', dateRange.endDate);
      if (error) throw error;

      const normalized = (lines || []).map((line: any) => {
        const journal = Array.isArray(line.journal_entries)
          ? line.journal_entries[0]
          : line.journal_entries;
        return {
          id: line.id,
          journal_entry_id: line.journal_entry_id,
          entry_date: journal.entry_date,
          particulars: line.description || journal.description || 'Bank posting',
          reference: journal.reference_number || journal.entry_number,
          debit: Number(line.debit || 0),
          credit: Number(line.credit || 0),
          running_balance: 0,
        } as LedgerEntry;
      }).sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id.localeCompare(b.id));

      const opening = normalized
        .filter(line => line.entry_date < dateRange.startDate)
        .reduce((sum, line) => sum + line.debit - line.credit, 0);
      let running = opening;
      const period = normalized
        .filter(line => line.entry_date >= dateRange.startDate)
        .map(line => {
          running += line.debit - line.credit;
          return { ...line, running_balance: running };
        });

      setOpeningBalance(opening);
      setEntries(period);
    } catch (error) {
      console.error('Error loading journal-native bank ledger:', error);
      setEntries([]);
      setOpeningBalance(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBank && banks.length) void loadLedgerEntries();
  }, [selectedBank, banks, dateRange.startDate, dateRange.endDate]);

  const bank = banks.find(item => item.id === selectedBank);
  const totalDebit = useMemo(() => entries.reduce((sum, entry) => sum + entry.debit, 0), [entries]);
  const totalCredit = useMemo(() => entries.reduce((sum, entry) => sum + entry.credit, 0), [entries]);
  const closingBalance = openingBalance + totalDebit - totalCredit;
  const formatAmount = (amount: number) => formatCurrency(amount, 'IDR', { zeroAsDash: true });

  const exportToExcel = () => {
    if (!bank) return;
    const rows = entries.map(entry => [
      entry.entry_date,
      entry.particulars,
      entry.reference,
      entry.debit || '',
      entry.credit || '',
      entry.running_balance,
    ]);
    const csv = [
      `Bank GL Ledger - ${bank.bank_name} (${bank.account_number})`,
      'Reporting Currency: IDR (functional currency)',
      `Period: ${dateRange.startDate} to ${dateRange.endDate}`,
      `Opening Balance: ${openingBalance}`,
      '',
      'Date,Particulars,Reference,Debit (Dr),Credit (Cr),Balance',
      ...rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `bank_gl_ledger_${bank.bank_name}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between h-8 px-2 bg-white border border-gray-200 rounded">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xs font-bold text-gray-900 truncate flex items-center gap-1.5">
            <BookOpen className="w-3 h-3 text-blue-600" /> Bank Ledger
          </h1>
          <span className="text-[10px] text-gray-400 truncate">Posted journal lines · functional IDR</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={loadLedgerEntries} disabled={!selectedBank || loading} className="inline-flex items-center gap-1 h-7 px-2 bg-blue-600 text-white rounded text-xs font-semibold disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={exportToExcel} disabled={!selectedBank || entries.length === 0} className="inline-flex items-center gap-1 h-7 px-2 bg-green-600 text-white rounded text-xs font-semibold disabled:opacity-50">
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
        <select value={selectedBank} onChange={event => setSelectedBank(event.target.value)} className="w-full px-3 py-2 border rounded-lg max-w-md">
          <option value="">Select Bank Account</option>
          {banks.map(item => <option key={item.id} value={item.id}>{item.bank_name} - {item.account_number} ({item.currency})</option>)}
        </select>
        {bank && !bank.coa_id && <p className="mt-2 text-xs text-red-700">This bank has no active Chart of Accounts mapping, so an accounting ledger cannot be produced.</p>}
        {bank?.coa_id && <p className="mt-2 text-xs text-gray-500">Accounting amounts come only from active posted journal lines. Statement activity remains in Bank Reconciliation.</p>}
      </div>

      {selectedBank && bank?.coa_id && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr>
                {['Date', 'Particulars', 'Journal / Reference', 'Debit (Dr)', 'Credit (Cr)', 'Balance'].map((label, index) =>
                  <th key={label} className={`px-1.5 py-1 text-xs font-medium text-gray-700 uppercase ${index > 2 ? 'text-right' : 'text-left'}`}>{label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-200">
                <tr className="bg-blue-50 font-semibold"><td className="px-2 py-1 text-xs" colSpan={5}>Opening balance from posted journals before {dateRange.startDate}</td><td className="px-2 py-1 text-xs text-right">{formatAmount(openingBalance)}</td></tr>
                {loading ? <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading entries…</td></tr>
                  : entries.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No posted journal lines for this period</td></tr>
                  : entries.map(entry => <tr key={entry.id} className="hover:bg-blue-50">
                    <td className="px-2 py-1 text-xs">{new Date(entry.entry_date).toLocaleDateString('id-ID')}</td>
                    <td className="px-2 py-1 text-xs">{entry.particulars}</td>
                    <td className="px-2 py-1 text-xs font-mono"><button className="text-blue-700 hover:underline" onClick={() => onOpenJournal?.(entry.journal_entry_id)}>{entry.reference}</button></td>
                    <td className="px-2 py-1 text-xs text-right text-red-600">{entry.debit ? formatAmount(entry.debit) : '-'}</td>
                    <td className="px-2 py-1 text-xs text-right text-green-600">{entry.credit ? formatAmount(entry.credit) : '-'}</td>
                    <td className="px-2 py-1 text-xs text-right font-semibold">{formatAmount(entry.running_balance)}</td>
                  </tr>)}
                {entries.length > 0 && <tr className="bg-gray-100 font-semibold"><td className="px-2 py-1 text-xs" colSpan={3}>Closing Balance</td><td className="px-2 py-1 text-xs text-right">{formatAmount(totalDebit)}</td><td className="px-2 py-1 text-xs text-right">{formatAmount(totalCredit)}</td><td className="px-2 py-1 text-xs text-right">{formatAmount(closingBalance)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
