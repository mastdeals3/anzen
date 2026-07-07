import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash2, Search, Building2 } from 'lucide-react';
import { Modal } from '../Modal';
import { SUPPLIER_TYPES } from '../../utils/taxCalculations';

interface Supplier {
  id: string;
  supplier_code: string | null;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  npwp: string | null;
  pkp_status: boolean;
  payment_terms_days: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  is_active: boolean;
  // Expense defaults (added by migration 20260702100000)
  default_expense_category: string | null;
  default_pph_code_id: string | null;
  tax_preference: 'none' | 'ppn_only' | 'ppn_pph' | 'pph_only' | null;
  // Supplier type metadata (migration 20260702120000)
  supplier_type: string | null;
}

interface TaxCode {
  id: string;
  code: string;
  name: string;
  rate: number;
}

interface SuppliersManagerProps {
  canManage: boolean;
}

// Expense categories available for supplier defaults (mirrors DOCUMENT_TYPE_GROUPS in taxCalculations.ts)
const DEFAULT_CATEGORY_OPTIONS = [
  { value: '', label: 'No default' },
  { value: 'warehouse_rent',             label: 'Warehouse Rent' },
  { value: 'bank_charges',               label: 'Bank Charges' },
  { value: 'office_admin',               label: 'Office & Admin' },
  { value: 'office_shifting_renovation', label: 'Office Shifting/Renovation' },
  { value: 'other',                      label: 'Other' },
  { value: 'utilities',                  label: 'Utilities' },
  { value: 'salary',                     label: 'Salary' },
  { value: 'staff_overtime',             label: 'Staff Overtime' },
  { value: 'staff_welfare',              label: 'Staff Welfare' },
  { value: 'travel_conveyance',          label: 'Travel & Conveyance' },
  { value: 'delivery_sales',             label: 'Delivery (Sales)' },
  { value: 'loading_sales',              label: 'Loading (Sales)' },
  { value: 'other_sales',               label: 'Other (Sales)' },
  { value: 'professional_services',      label: 'Professional Services' },
  { value: 'import_broker',             label: 'Customs Broker Invoice' },
  { value: 'fixed_asset',               label: 'Fixed Asset' },
];

export function SuppliersManager({ canManage }: SuppliersManagerProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    supplier_code: '',
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: 'Indonesia',
    npwp: '',
    pkp_status: false,
    payment_terms_days: 30,
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    // Expense defaults
    default_expense_category: '',
    default_pph_code_id: '',
    tax_preference: 'none' as 'none' | 'ppn_only' | 'ppn_pph' | 'pph_only',
    supplier_type: 'General',
  });

  useEffect(() => {
    loadSuppliers();
    loadTaxCodes();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('company_name');

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error) {
      console.error('Error loading suppliers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTaxCodes = async () => {
    const { data } = await supabase
      .from('tax_codes')
      .select('id, code, name, rate')
      .eq('is_withholding', true)
      .order('code');
    setTaxCodes(data || []);
  };

  const handleSupplierTypeChange = (value: string) => {
    const cfg = SUPPLIER_TYPES.find(t => t.value === value);
    if (!cfg) { setFormData(f => ({ ...f, supplier_type: value })); return; }
    setFormData(f => ({
      ...f,
      supplier_type: value,
      tax_preference: cfg.taxPreference,
      default_expense_category: cfg.defaultCategory,
      payment_terms_days: cfg.paymentTerms,
    }));
  };

  const generateSupplierCode = async () => {
    const year = new Date().getFullYear().toString().slice(-2);
    const { count } = await supabase
      .from('suppliers')
      .select('*', { count: 'exact', head: true });
    
    return `SUP${year}-${String((count || 0) + 1).padStart(4, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const payload = {
        ...formData,
        supplier_code: formData.supplier_code || await generateSupplierCode(),
        contact_person: formData.contact_person || null,
        email: formData.email || null,
        phone: formData.phone || null,
        address: formData.address || null,
        city: formData.city || null,
        npwp: formData.npwp || null,
        bank_name: formData.bank_name || null,
        bank_account_number: formData.bank_account_number || null,
        bank_account_name: formData.bank_account_name || null,
        // Expense defaults — null means "no default"
        default_expense_category: formData.default_expense_category || null,
        default_pph_code_id: formData.default_pph_code_id || null,
        tax_preference: formData.tax_preference || 'none',
        supplier_type: formData.supplier_type || null,
      };

      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', editingSupplier.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('suppliers')
          .insert([{ ...payload, created_by: user.id }]);
        if (error) throw error;
      }

      setModalOpen(false);
      resetForm();
      loadSuppliers();
    } catch (error: any) {
      console.error('Error saving supplier:', error);
      alert('Failed to save supplier: ' + error.message);
    }
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      supplier_code: supplier.supplier_code || '',
      company_name: supplier.company_name,
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      city: supplier.city || '',
      country: supplier.country,
      npwp: supplier.npwp || '',
      pkp_status: supplier.pkp_status,
      payment_terms_days: supplier.payment_terms_days,
      bank_name: supplier.bank_name || '',
      bank_account_number: supplier.bank_account_number || '',
      bank_account_name: supplier.bank_account_name || '',
      default_expense_category: supplier.default_expense_category || '',
      default_pph_code_id: supplier.default_pph_code_id || '',
      tax_preference: supplier.tax_preference || 'none',
      supplier_type: supplier.supplier_type || 'General',
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;

    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
      loadSuppliers();
    } catch (error: any) {
      console.error('Error deleting supplier:', error);
      alert('Failed to delete supplier: ' + error.message);
    }
  };

  const resetForm = () => {
    setEditingSupplier(null);
    setFormData({
      supplier_code: '',
      company_name: '',
      contact_person: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      country: 'Indonesia',
      npwp: '',
      pkp_status: false,
      payment_terms_days: 30,
      bank_name: '',
      bank_account_number: '',
      bank_account_name: '',
      default_expense_category: '',
      default_pph_code_id: '',
      tax_preference: 'none',
      supplier_type: 'General',
    });
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.supplier_code && s.supplier_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (s.npwp && s.npwp.includes(searchTerm))
  );

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search suppliers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        {canManage && (
          <button
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="flex items-center gap-2 bg-blue-600 text-white h-7 px-2 rounded hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Add Supplier
          </button>
        )}
      </div>

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Company Name</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">NPWP</th>
              <th className="px-2 py-1.5 text-center text-xs font-medium text-gray-500 uppercase">PKP</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Terms</th>
              {canManage && <th className="px-2 py-1.5 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredSuppliers.map(supplier => (
              <tr key={supplier.id} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 font-mono text-sm">{supplier.supplier_code || '-'}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <div>
                      <div className="font-medium">{supplier.company_name}</div>
                      {supplier.city && <div className="text-sm text-gray-500">{supplier.city}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {supplier.supplier_type ? (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{supplier.supplier_type}</span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="text-sm">{supplier.contact_person || '-'}</div>
                  {supplier.phone && <div className="text-sm text-gray-500">{supplier.phone}</div>}
                </td>
                <td className="px-2 py-1.5 font-mono text-sm">{supplier.npwp || '-'}</td>
                <td className="px-2 py-1.5 text-center">
                  {supplier.pkp_status ? (
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">PKP</span>
                  ) : (
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">Non-PKP</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-sm">{supplier.payment_terms_days} days</td>
                {canManage && (
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => handleEdit(supplier)} className="text-blue-600 hover:text-blue-800 mr-2">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(supplier.id)} className="text-red-600 hover:text-red-800">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filteredSuppliers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No suppliers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'}>
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Supplier Code</label>
              <input
                type="text"
                value={formData.supplier_code}
                onChange={(e) => setFormData({ ...formData, supplier_code: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                placeholder="Auto-generated if empty"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Company Name *</label>
              <input
                type="text"
                required
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Contact Person</label>
              <input
                type="text"
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Address</label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Country</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-700 mb-3">Tax Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">NPWP</label>
                <input
                  type="text"
                  value={formData.npwp}
                  onChange={(e) => setFormData({ ...formData, npwp: e.target.value })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                  placeholder="00.000.000.0-000.000"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="pkp_status"
                  checked={formData.pkp_status}
                  onChange={(e) => setFormData({ ...formData, pkp_status: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="pkp_status" className="text-sm text-gray-700">PKP (Pengusaha Kena Pajak)</label>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-700 mb-3">Bank Details</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Bank Name</label>
                <input
                  type="text"
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Account Number</label>
                <input
                  type="text"
                  value={formData.bank_account_number}
                  onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Account Name</label>
                <input
                  type="text"
                  value={formData.bank_account_name}
                  onChange={(e) => setFormData({ ...formData, bank_account_name: e.target.value })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Payment Terms (Days)</label>
            <input
              type="number"
              value={formData.payment_terms_days}
              onChange={(e) => setFormData({ ...formData, payment_terms_days: parseInt(e.target.value) || 30 })}
              className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
            />
          </div>

          {/* ── Supplier Type + Expense Defaults ─────────────────────────────── */}
          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-700 mb-1">Expense Defaults</h4>
            <p className="text-xs text-gray-500 mb-3">
              These defaults auto-fill when this supplier is selected in the Expense / Bill entry form.
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Supplier Type</label>
                <select
                  value={formData.supplier_type || 'General'}
                  onChange={(e) => handleSupplierTypeChange(e.target.value)}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                >
                  {SUPPLIER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-0.5">Selecting a type auto-fills tax preference, category, and payment terms</p>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Default Expense Category</label>
                <select
                  value={formData.default_expense_category}
                  onChange={(e) => setFormData({ ...formData, default_expense_category: e.target.value })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                >
                  {DEFAULT_CATEGORY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-0.5">Auto-selects this category when supplier is chosen</p>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Tax Preference</label>
                <select
                  value={formData.tax_preference}
                  onChange={(e) => setFormData({ ...formData, tax_preference: e.target.value as 'none' | 'ppn_only' | 'ppn_pph' | 'pph_only' })}
                  className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                >
                  <option value="none">None (no auto-tax)</option>
                  <option value="ppn_only">PPN Only (11% VAT)</option>
                  <option value="ppn_pph">PPN + PPh (VAT + Withholding)</option>
                  <option value="pph_only">PPh Only (Withholding, no VAT)</option>
                </select>
                <p className="text-xs text-gray-500 mt-0.5">
                  Controls which tax fields are auto-filled in Expense entry
                  {formData.pkp_status && formData.tax_preference !== 'none' && (
                    <span className="text-green-600 font-medium"> · PKP supplier — PPN will auto-calculate</span>
                  )}
                </p>
              </div>

              {(formData.tax_preference === 'ppn_pph' || formData.tax_preference === 'pph_only') && (
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Default PPh Type</label>
                  <select
                    value={formData.default_pph_code_id}
                    onChange={(e) => setFormData({ ...formData, default_pph_code_id: e.target.value })}
                    className="w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white"
                  >
                    <option value="">None</option>
                    {taxCodes.map(tc => (
                      <option key={tc.id} value={tc.id}>
                        {tc.code} — {tc.name} ({tc.rate}%)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-0.5">Auto-selects PPh type in Expense entry</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" className="h-7 px-2 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
              {editingSupplier ? 'Update' : 'Create'} Supplier
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
