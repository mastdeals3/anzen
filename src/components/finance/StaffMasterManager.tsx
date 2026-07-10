import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react';
import { FinanceModal } from './FinanceModal';
import { SearchableSelect } from '../SearchableSelect';
import {
  SapRow, SapField, SAP_INPUT,
  SAP_BTN_PRIMARY, SAP_BTN_SECONDARY,
} from './SapLayout';
import { showToast } from '../ToastNotification';
import { showConfirm } from '../ConfirmDialog';

/**
 * StaffMasterManager — CRUD for finance_staff_master.
 *
 * Payroll / staff-expense targets. Used by the Expense form when the
 * category is one of salary / staff_overtime / staff_welfare /
 * travel_conveyance. Pure lookup admin — no accounting side-effects.
 */

interface Staff {
  id: string;
  full_name: string;
  employee_code: string | null;
  department: string | null;
  default_gl_code: string | null;
  default_gl_name: string | null;
  npwp: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
}

interface CoaAccount {
  id: string;
  code: string;
  name: string;
}

interface Props {
  canManage: boolean;
}

export function StaffMasterManager({ canManage }: Props) {
  const [rows, setRows] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);

  // Chart-of-accounts list for the GL Code selector.
  const [coa, setCoa] = useState<CoaAccount[]>([]);

  const [form, setForm] = useState({
    full_name: '',
    employee_code: '',
    department: '',
    default_gl_code: '',
    default_gl_name: '',
    npwp: '',
    status: 'active' as 'active' | 'inactive',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); loadCoa(); }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('finance_staff_master')
      .select('*')
      .order('full_name');
    if (error) showToast({ type: 'error', title: 'Load failed', message: error.message });
    else setRows(data || []);
    setLoading(false);
  };

  const loadCoa = async () => {
    // Expense-side accounts only — salary / welfare / travel are all "expense".
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, is_active')
      .in('account_type', ['expense', 'Expense'])
      .eq('is_active', true)
      .order('code');
    setCoa((data as CoaAccount[]) || []);
  };

  const reset = () => {
    setEditing(null);
    setErrors({});
    setForm({
      full_name: '', employee_code: '', department: '',
      default_gl_code: '', default_gl_name: '',
      npwp: '', status: 'active', notes: '',
    });
  };

  const openEdit = (r: Staff) => {
    setEditing(r);
    setErrors({});
    setForm({
      full_name: r.full_name,
      employee_code: r.employee_code || '',
      department: r.department || '',
      default_gl_code: r.default_gl_code || '',
      default_gl_name: r.default_gl_name || '',
      npwp: r.npwp || '',
      status: r.status,
      notes: r.notes || '',
    });
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.full_name.trim()) e.full_name = 'Full name is required';
    if (form.npwp && form.npwp.length < 15) e.npwp = 'NPWP looks incomplete (15+ chars)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const payload: Partial<Staff> = {
      full_name: form.full_name.trim(),
      employee_code: form.employee_code.trim() || null,
      department: form.department.trim() || null,
      default_gl_code: form.default_gl_code.trim() || null,
      default_gl_name: form.default_gl_name.trim() || null,
      npwp: form.npwp.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    const { error } = editing
      ? await supabase.from('finance_staff_master').update(payload).eq('id', editing.id)
      : await supabase.from('finance_staff_master').insert(payload);
    setSaving(false);
    if (error) {
      showToast({ type: 'error', title: 'Save failed', message: error.message });
      return;
    }
    showToast({ type: 'success', title: editing ? 'Updated' : 'Created', message: `${form.full_name} saved.` });
    setModalOpen(false);
    reset();
    load();
  };

  const remove = async (r: Staff) => {
    const ok = await showConfirm({
      title: 'Delete staff record?',
      message: `Delete ${r.full_name}? Expenses already booked against this staff are NOT affected — this only removes the master record.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('finance_staff_master').delete().eq('id', r.id);
    if (error) showToast({ type: 'error', title: 'Delete failed', message: error.message });
    else { showToast({ type: 'success', title: 'Deleted', message: `${r.full_name} removed.` }); load(); }
  };

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.full_name.toLowerCase().includes(q)
      || (r.employee_code || '').toLowerCase().includes(q)
      || (r.department || '').toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-1.5">
      {/* Shared title strip */}
      <div className="flex items-center justify-between h-8 px-2 bg-white border border-gray-200 rounded">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xs font-bold text-gray-900 truncate flex items-center gap-1.5">
            <Users className="w-3 h-3 text-blue-600" /> Staff Master
          </h1>
          <span className="text-[10px] text-gray-400 truncate">Payroll / staff-expense targets</span>
        </div>
        {canManage && (
          <button
            onClick={() => { reset(); setModalOpen(true); }}
            className="inline-flex items-center gap-1 h-7 px-2 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 min-h-8 px-2 py-1 bg-white border border-gray-200 rounded">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name / code / department..."
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded"
          />
        </div>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} staff</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="h-8">
              <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Name</th>
              <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Code</th>
              <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Department</th>
              <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Default GL</th>
              <th className="px-2 py-1 text-left font-semibold text-[11px] text-gray-600 uppercase tracking-wide">NPWP</th>
              <th className="px-2 py-1 text-center font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Status</th>
              {canManage && <th className="px-2 py-1 text-center font-semibold text-[11px] text-gray-600 uppercase tracking-wide">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canManage ? 7 : 6} className="py-8 text-center text-xs text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={canManage ? 7 : 6} className="py-8 text-center text-xs text-gray-400">No staff records.</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="h-8 border-b border-gray-100 hover:bg-blue-50/40">
                <td className="px-2 py-1 text-gray-900 font-medium">{r.full_name}</td>
                <td className="px-2 py-1 text-gray-700 font-mono">{r.employee_code || '—'}</td>
                <td className="px-2 py-1 text-gray-700">{r.department || '—'}</td>
                <td className="px-2 py-1 text-gray-700 font-mono">{r.default_gl_code ? `${r.default_gl_code}${r.default_gl_name ? ' — ' + r.default_gl_name : ''}` : '—'}</td>
                <td className="px-2 py-1 text-gray-700 font-mono">{r.npwp || '—'}</td>
                <td className="px-2 py-1 text-center">
                  <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {r.status}
                  </span>
                </td>
                {canManage && (
                  <td className="px-1 py-0.5">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => openEdit(r)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(r)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal — FinanceModal shell, SAP grid, single validation style */}
      <FinanceModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); reset(); }}
        title={editing ? 'Edit Staff' : 'New Staff'}
        subtitle={editing?.employee_code || undefined}
        size="md"
        footer={
          <>
            <button type="button" onClick={() => { setModalOpen(false); reset(); }}
              className={SAP_BTN_SECONDARY}>Cancel</button>
            <button type="submit" form="staff-master-form" disabled={saving}
              className={SAP_BTN_PRIMARY}>
              {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
            </button>
          </>
        }
      >
        <form id="staff-master-form" onSubmit={save} className="flex flex-col gap-2">
          {/* Row 1 — Full Name full width */}
          <SapRow>
            <SapField label="Full Name" required span={12} error={errors.full_name}>
              <input
                type="text" required
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className={SAP_INPUT + (errors.full_name ? ' !border-red-400 focus:!border-red-500 focus:!ring-red-200' : '')}
                placeholder="e.g. Budi Santoso"
                autoFocus
              />
            </SapField>
          </SapRow>

          {/* Row 2 — Employee Code | Department */}
          <SapRow>
            <SapField label="Employee Code" span={6} hint="Internal HR code (optional)">
              <input
                type="text"
                value={form.employee_code}
                onChange={e => setForm({ ...form, employee_code: e.target.value })}
                className={SAP_INPUT + ' !font-mono'}
                placeholder="e.g. EMP-001"
              />
            </SapField>
            <SapField label="Department" span={6} hint="Cost centre grouping">
              <input
                type="text"
                value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
                className={SAP_INPUT}
                placeholder="e.g. Warehouse"
              />
            </SapField>
          </SapRow>

          {/* Row 3 — Status | NPWP */}
          <SapRow>
            <SapField label="Status" span={6}>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                className={SAP_INPUT}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </SapField>
            <SapField label="NPWP" span={6} error={errors.npwp} hint={errors.npwp ? undefined : 'Indonesian tax ID (optional)'}>
              <input
                type="text"
                value={form.npwp}
                onChange={e => setForm({ ...form, npwp: e.target.value })}
                className={SAP_INPUT + ' !font-mono' + (errors.npwp ? ' !border-red-400 focus:!border-red-500 focus:!ring-red-200' : '')}
                placeholder="00.000.000.0-000.000"
              />
            </SapField>
          </SapRow>

          {/* Row 4 — Default GL Code (searchable) | GL Name (auto-populated, read-only) */}
          <SapRow>
            <SapField label="Default GL Code" span={6} hint="Optional — auto-fills GL Name">
              <SearchableSelect
                value={form.default_gl_code}
                onChange={(val) => {
                  const acct = coa.find(a => a.code === val);
                  setForm(f => ({
                    ...f,
                    default_gl_code: val || '',
                    default_gl_name: acct?.name || '',
                  }));
                }}
                options={[
                  { value: '', label: '— None —' },
                  ...coa.map(a => ({ value: a.code, label: `${a.code} — ${a.name}` })),
                ]}
                placeholder="Search account..."
              />
            </SapField>
            <SapField label="GL Name" span={6} hint="Populated from GL Code">
              <input
                type="text"
                value={form.default_gl_name}
                readOnly
                className={SAP_INPUT + ' !bg-gray-50 !text-gray-600'}
                placeholder="Auto-populated"
              />
            </SapField>
          </SapRow>

          {/* Row 5 — Notes full width */}
          <SapRow>
            <SapField label="Notes" span={12} hint="Free-text (optional)">
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className={SAP_INPUT}
                placeholder="Anything Accounts should know about this staff record"
              />
            </SapField>
          </SapRow>
        </form>
      </FinanceModal>
    </div>
  );
}
