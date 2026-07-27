import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Search } from 'lucide-react';
import { FinanceModal } from './FinanceModal';
import { FinancePage } from './FinancePage';
import { FinanceTable } from './FinanceTable';
import { FinanceActionButton, FinanceBadge, FinanceButton } from './FinanceUI';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
import { showToast } from '../ToastNotification';
import { showConfirm } from '../ConfirmDialog';

/**
 * StaffMasterManager — CRUD for finance_staff_master.
 *
 * Payroll / staff-expense targets. Used by the Expense form when the
 * category is one of salary / staff_overtime / staff_welfare /
 * travel_conveyance. This screen is a pure lookup admin — no
 * calculations, no journal side-effects.
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

interface Props {
  canManage: boolean;
}

export function StaffMasterManager({ canManage }: Props) {
  const [rows, setRows] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
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

  useEffect(() => { load(); }, []);

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

  const reset = () => {
    setEditing(null);
    setForm({
      full_name: '', employee_code: '', department: '',
      default_gl_code: '', default_gl_name: '',
      npwp: '', status: 'active', notes: '',
    });
  };

  const openEdit = (r: Staff) => {
    setEditing(r);
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) {
      showToast({ type: 'error', title: 'Name required', message: 'Enter the staff name.' });
      return;
    }
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
      confirmText: 'Delete',
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
    <FinancePage
      title="Staff Master"
      subtitle="Payroll / staff-expense targets"
      actions={canManage ? (
        <FinanceButton variant="primary" onClick={() => { reset(); setModalOpen(true); }}>
          <Plus className="w-3.5 h-3.5" /> New Staff
        </FinanceButton>
      ) : undefined}
      toolbar={(
        <>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name / code / dept..."
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-300 rounded"
          />
        </div>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} staff</span>
        </>
      )}
    >
      <FinanceTable
        rows={filtered}
        rowKey={(row) => row.id}
        loading={loading}
        empty="No staff records."
        columns={[
          { header: 'Name', cell: (row) => <span className="font-medium text-gray-900">{row.full_name}</span> },
          { header: 'Code', cell: (row) => <span className="font-mono">{row.employee_code || '—'}</span> },
          { header: 'Department', cell: (row) => row.department || '—' },
          { header: 'Default GL', cell: (row) => <span className="font-mono">{row.default_gl_code ? `${row.default_gl_code}${row.default_gl_name ? ` — ${row.default_gl_name}` : ''}` : '—'}</span> },
          { header: 'NPWP', cell: (row) => <span className="font-mono">{row.npwp || '—'}</span> },
          { header: 'Status', align: 'center', cell: (row) => <FinanceBadge status={row.status === 'active' ? 'approved' : 'draft'}>{row.status}</FinanceBadge> },
          ...(canManage ? [{
            header: 'Actions', align: 'center' as const, cell: (row: Staff) => (
              <div className="flex items-center justify-center gap-0.5">
                <FinanceActionButton action="edit" onClick={() => openEdit(row)} />
                <FinanceActionButton action="delete" onClick={() => remove(row)} />
              </div>
            ),
          }] : []),
        ]}
      />

      {/* Modal */}
      {modalOpen && (
        <FinanceModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); reset(); }}
          title={editing ? `Edit Staff: ${editing.full_name}` : 'New Staff'}
          size="md"
          footer={(
            <>
              <FinanceButton type="button" onClick={() => { setModalOpen(false); reset(); }}>
                Cancel
              </FinanceButton>
              <FinanceButton type="submit" form="staff-master-form" variant="primary">
                {editing ? 'Update' : 'Create'}
              </FinanceButton>
            </>
          )}
        >
          <form id="staff-master-form" onSubmit={save} className="flex flex-col gap-2">
            <SapRow>
              <SapField label="Full Name" required span={8}>
                <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                  className={SAP_INPUT} />
              </SapField>
              <SapField label="Emp Code" span={4}>
                <input value={form.employee_code} onChange={e => setForm({ ...form, employee_code: e.target.value })}
                  className={SAP_INPUT} />
              </SapField>
            </SapRow>
            <SapRow>
              <SapField label="Department" span={6}>
                <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                  className={SAP_INPUT} />
              </SapField>
              <SapField label="Status" span={6}>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                  className={SAP_INPUT}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </SapField>
            </SapRow>
            <SapRow>
              <SapField label="GL Code" span={4}>
                <input value={form.default_gl_code} onChange={e => setForm({ ...form, default_gl_code: e.target.value })}
                  placeholder="e.g. 6100"
                  className={SAP_INPUT + ' !font-mono'} />
              </SapField>
              <SapField label="GL Name" span={4}>
                <input value={form.default_gl_name} onChange={e => setForm({ ...form, default_gl_name: e.target.value })}
                  placeholder="Salary Expense"
                  className={SAP_INPUT} />
              </SapField>
              <SapField label="NPWP" span={4}>
                <input value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })}
                  className={SAP_INPUT + ' !font-mono'} />
              </SapField>
            </SapRow>
            <SapRow>
              <SapField label="Notes" span={12}>
                <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className={SAP_INPUT} />
              </SapField>
            </SapRow>
          </form>
        </FinanceModal>
      )}
    </FinancePage>
  );
}
