import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash2, ChevronRight, ChevronDown, Search } from 'lucide-react';
import { Modal } from '../Modal';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
import { showConfirm } from '../ConfirmDialog';

interface Account {
  id: string;
  code: string;
  name: string;
  name_id: string | null;
  account_type: string;
  account_group: string | null;
  parent_id: string | null;
  is_header: boolean;
  is_active: boolean;
  normal_balance: string;
  description: string | null;
}

interface ChartOfAccountsManagerProps {
  canManage: boolean;
}

const accountTypes = [
  { value: 'asset', label: 'Asset', color: 'bg-blue-100 text-blue-800' },
  { value: 'liability', label: 'Liability', color: 'bg-red-100 text-red-800' },
  { value: 'equity', label: 'Equity', color: 'bg-purple-100 text-purple-800' },
  { value: 'revenue', label: 'Revenue', color: 'bg-green-100 text-green-800' },
  { value: 'expense', label: 'Expense', color: 'bg-orange-100 text-orange-800' },
  { value: 'contra', label: 'Contra', color: 'bg-gray-100 text-gray-800' },
];

export function ChartOfAccountsManager({ canManage }: ChartOfAccountsManagerProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['asset', 'liability', 'equity', 'revenue', 'expense']));
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_id: '',
    account_type: 'expense',
    account_group: '',
    parent_id: '',
    is_header: false,
    normal_balance: 'debit',
    description: '',
  });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        // perf: projected columns (was select('*'))
        .select('id, code, name, name_id, description, account_type, account_group, normal_balance, is_header, is_active, parent_id')
        .order('code');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error loading accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const payload = {
        ...formData,
        parent_id: formData.parent_id || null,
        name_id: formData.name_id || null,
        description: formData.description || null,
      };

      if (editingAccount) {
        const { error } = await supabase
          .from('chart_of_accounts')
          .update(payload)
          .eq('id', editingAccount.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chart_of_accounts')
          .insert([payload]);
        if (error) throw error;
      }

      setModalOpen(false);
      resetForm();
      loadAccounts();
    } catch (error: any) {
      console.error('Error saving account:', error);
      alert('Failed to save account: ' + error.message);
    }
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      name_id: account.name_id || '',
      account_type: account.account_type,
      account_group: account.account_group || '',
      parent_id: account.parent_id || '',
      is_header: account.is_header,
      normal_balance: account.normal_balance,
      description: account.description || '',
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    const ok = await showConfirm({
      title: 'Delete account?',
      message: 'This will remove the ledger account. Continue only if no transactions are booked against it.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('chart_of_accounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
      loadAccounts();
    } catch (error: any) {
      console.error('Error deleting account:', error);
      alert('Failed to delete account: ' + error.message);
    }
  };

  const resetForm = () => {
    setEditingAccount(null);
    setFormData({
      code: '',
      name: '',
      name_id: '',
      account_type: 'expense',
      account_group: '',
      parent_id: '',
      is_header: false,
      normal_balance: 'debit',
      description: '',
    });
  };

  const toggleGroup = (type: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(type)) {
      newExpanded.delete(type);
    } else {
      newExpanded.add(type);
    }
    setExpandedGroups(newExpanded);
  };

  const getTypeColor = (type: string) => {
    return accountTypes.find(t => t.value === type)?.color || 'bg-gray-100 text-gray-800';
  };

  const filteredAccounts = accounts.filter(account =>
    account.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (account.name_id && account.name_id.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const groupedAccounts = accountTypes.reduce((acc, type) => {
    acc[type.value] = filteredAccounts.filter(a => a.account_type === type.value);
    return acc;
  }, {} as Record<string, Account[]>);

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 min-h-8 px-2 py-1 bg-white border border-gray-200 rounded flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {canManage && (
          <button
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="inline-flex items-center gap-1 h-7 px-2 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
          >
            <Plus className="w-3 h-3" />
            Add Account
          </button>
        )}
      </div>

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        {accountTypes.map(type => (
          <div key={type.value} className="border-b last:border-b-0">
            <button
              onClick={() => toggleGroup(type.value)}
              className="w-full flex items-center justify-between px-2 h-8 bg-gray-50 hover:bg-gray-100"
            >
              <div className="flex items-center gap-1.5">
                {expandedGroups.has(type.value) ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded ${type.color}`}>{type.label}</span>
                <span className="text-[10px] text-gray-500">({groupedAccounts[type.value]?.length || 0} accounts)</span>
              </div>
            </button>

            {expandedGroups.has(type.value) && groupedAccounts[type.value]?.length > 0 && (
              <table className="w-full text-xs border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="h-8">
                    <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Code</th>
                    <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Account Name</th>
                    <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Indonesian Name</th>
                    <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Group</th>
                    <th className="px-2 py-1 text-center font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Normal</th>
                    {canManage && <th className="px-2 py-1 text-center font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {groupedAccounts[type.value].map(account => (
                    <tr key={account.id} className={`h-8 border-b border-gray-100 hover:bg-blue-50/40 transition-colors ${account.is_header ? 'font-semibold bg-gray-50' : ''}`}>
                      <td className="px-2 py-1 font-mono text-gray-900">{account.code}</td>
                      <td className="px-2 py-1 text-gray-900">{account.name}</td>
                      <td className="px-2 py-1 text-gray-500">{account.name_id || '—'}</td>
                      <td className="px-2 py-1 text-gray-500">{account.account_group || '—'}</td>
                      <td className="px-2 py-1 text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded ${account.normal_balance === 'debit' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                          {account.normal_balance}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-1 py-0.5">
                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={() => handleEdit(account)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(account.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingAccount ? 'Edit Account' : 'Add Account'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          <SapRow>
            <SapField label="Code" required span={4}>
              <input type="text" required value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className={SAP_INPUT + ' !font-mono'} placeholder="e.g., 1101" />
            </SapField>
            <SapField label="Type" required span={4}>
              <select required value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                className={SAP_INPUT}>
                {accountTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </SapField>
            <SapField label="Normal" required span={4}>
              <select required value={formData.normal_balance}
                onChange={(e) => setFormData({ ...formData, normal_balance: e.target.value })}
                className={SAP_INPUT}>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </SapField>
          </SapRow>
          <SapRow>
            <SapField label="Name (EN)" required span={6}>
              <input type="text" required value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Name (ID)" span={6}>
              <input type="text" value={formData.name_id}
                onChange={(e) => setFormData({ ...formData, name_id: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>
          <SapRow>
            <SapField label="Group" span={4}>
              <input type="text" value={formData.account_group}
                onChange={(e) => setFormData({ ...formData, account_group: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Parent" span={8}>
              <select value={formData.parent_id}
                onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                className={SAP_INPUT}>
                <option value="">None (Top Level)</option>
                {accounts.filter(a => a.is_header).map(a => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </SapField>
          </SapRow>
          <SapRow>
            <SapField label="Header" span={4}>
              <label className="flex items-center gap-1.5 h-7 px-1 text-[11px]">
                <input type="checkbox" checked={formData.is_header}
                  onChange={(e) => setFormData({ ...formData, is_header: e.target.checked })}
                  className="rounded" />
                <span>Group only (no posting)</span>
              </label>
            </SapField>
            <SapField label="Description" span={8}>
              <input type="text" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 mt-1">
            <button type="button" onClick={() => setModalOpen(false)}
              className="h-7 px-3 text-xs text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded">Cancel</button>
            <button type="submit"
              className="h-7 px-3 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded font-semibold">
              {editingAccount ? 'Update' : 'Create'} Account
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
