import { useMemo, useState } from 'react';
import { Landmark, Link2, Search, Unlink } from 'lucide-react';
import { FinanceModal as Modal } from './FinanceModal';
import {
  type BankTransactionLine,
  loadUnmatchedDebitBankTransactions,
} from './bankTransactionLinking';
import { formatCurrency } from '../../utils/currency';

interface BankTransactionLinkFieldProps {
  bankAccountId: string;
  selectedTransactionId?: string;
  linkedTransaction?: BankTransactionLine | null;
  currentExpenseId?: string | null;
  currentJournalEntryId?: string | null;
  currentPettyCashId?: string | null;
  disabled?: boolean;
  disabledMessage?: string;
  canUnlink?: boolean;
  onSelect: (transaction: BankTransactionLine) => void | Promise<void>;
  onUnlink?: () => void | Promise<void>;
  direction?: 'debit' | 'credit' | 'both';
  candidateFilter?: (line: BankTransactionLine) => boolean;
  autoSelectSingle?: boolean;
}

function formatAmount(line: BankTransactionLine) {
  const currency = line.bank_accounts?.currency || 'IDR';
  const amount = Number(line.debit_amount || line.credit_amount || 0);
  return formatCurrency(amount, currency);
}

function bankLabel(line: BankTransactionLine) {
  const bank = line.bank_accounts;
  return bank?.alias || bank?.bank_name || bank?.account_name || 'Bank';
}

export function BankTransactionLinkField({
  bankAccountId,
  selectedTransactionId = '',
  linkedTransaction,
  currentExpenseId,
  currentJournalEntryId,
  currentPettyCashId,
  disabled = false,
  disabledMessage,
  canUnlink = false,
  onSelect,
  onUnlink,
  direction = 'debit',
  candidateFilter,
  autoSelectSingle = false,
}: BankTransactionLinkFieldProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [transactions, setTransactions] = useState<BankTransactionLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const filteredTransactions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const candidates = candidateFilter ? transactions.filter(candidateFilter) : transactions;
    if (!query) return candidates;

    return candidates.filter((line) => [
      line.transaction_date,
      line.description,
      line.reference,
      bankLabel(line),
      String(line.debit_amount),
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [searchTerm, transactions]);

  const openDialog = async () => {
    if (!bankAccountId || disabled) return;
    setDialogOpen(true);
    setLoading(true);
    try {
        const rows = await loadUnmatchedDebitBankTransactions({
          bankAccountId,
          direction,
        currentExpenseId,
        currentJournalEntryId,
        currentPettyCashId,
      });
      const candidates = candidateFilter ? rows.filter(candidateFilter) : rows;
      setTransactions(rows);
      if (autoSelectSingle && candidates.length === 1) await handleSelect(candidates[0]);
    } catch (error) {
      console.error('Error loading unmatched bank transactions:', error);
      alert('Failed to load unmatched bank transactions.');
      setDialogOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (transaction: BankTransactionLine) => {
    setSubmittingId(transaction.id);
    try {
      await onSelect(transaction);
      setDialogOpen(false);
      setSearchTerm('');
    } finally {
      setSubmittingId(null);
    }
  };

  if (linkedTransaction) {
    return (
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
          Link Bank Transaction
        </label>
        <div className="p-2 bg-green-50 border border-green-300 rounded">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs font-semibold text-green-900">
                <Landmark className="w-3 h-3" />
                Linked Bank Transaction
              </div>
              <div className="text-[10px] text-gray-600 truncate mt-0.5">
                {new Date(linkedTransaction.transaction_date).toLocaleDateString('id-ID')}
                {' · '}{formatAmount(linkedTransaction)}
                {' · '}{linkedTransaction.description || 'No narration'}
                {linkedTransaction.reference ? ` · ${linkedTransaction.reference}` : ''}
                {' · '}{bankLabel(linkedTransaction)}
              </div>
            </div>
            {canUnlink && onUnlink && (
              <button
                type="button"
                onClick={() => void onUnlink()}
                className="inline-flex items-center gap-1 text-[10px] text-red-600 hover:text-red-700 shrink-0"
              >
                <Unlink className="w-3 h-3" />
                Unlink
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
        Link Bank Transaction
      </label>
      <button
        type="button"
        onClick={() => void openDialog()}
        disabled={!bankAccountId || disabled}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs text-left bg-white hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Link2 className="w-3 h-3 shrink-0" />
          {selectedTransactionId ? 'Bank transaction selected' : 'Choose unmatched bank transaction'}
        </span>
        <Search className="w-3 h-3 shrink-0" />
      </button>
      {disabled && disabledMessage && (
        <p className="mt-0.5 text-[10px] text-amber-700">{disabledMessage}</p>
      )}

      <Modal
        isOpen={dialogOpen}
        onClose={() => { setDialogOpen(false); setSearchTerm(''); }}
        title="Link Bank Transaction"
        size="xl"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              autoFocus
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search date, amount, narration, reference, or bank..."
              className="w-full h-8 pl-8 pr-3 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            />
          </div>

          <div className="border border-gray-200 rounded overflow-hidden">
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Date</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Currency</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Direction</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Narration</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Reference</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Bank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Loading transactions...</td></tr>
                  ) : filteredTransactions.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No matching bank transactions found</td></tr>
                  ) : filteredTransactions.map((line) => (
                    <tr
                      key={line.id}
                      onClick={() => void handleSelect(line)}
                      className={`cursor-pointer hover:bg-blue-50 ${selectedTransactionId === line.id ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(line.transaction_date).toLocaleDateString('id-ID')}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-red-700 whitespace-nowrap">{formatAmount(line)}</td>
                      <td className="px-3 py-2">{line.bank_accounts?.currency || '—'}</td>
                      <td className="px-3 py-2">{line.debit_amount > 0 ? 'Money out' : 'Money in'}</td>
                      <td className="px-3 py-2 text-gray-700 min-w-[220px]">{line.description || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono">{line.reference || '—'}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {bankLabel(line)}
                        {submittingId === line.id && <span className="ml-1 text-blue-600">Linking...</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
