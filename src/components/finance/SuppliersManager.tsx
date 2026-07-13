import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash2, Search, Building2 } from 'lucide-react';
import { Modal } from '../Modal';
import { SapRow, SapField, SAP_INPUT } from './SapLayout';
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'} maxWidth="max-w-3xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          {/* Identification */}
          <SapRow>
            <SapField label="Code" span={4}>
              <input type="text" value={formData.supplier_code}
                onChange={(e) => setFormData({ ...formData, supplier_code: e.target.value })}
                className={SAP_INPUT} placeholder="Auto-generated" />
            </SapField>
            <SapField label="Company" required span={8}>
              <input type="text" required value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>

          {/* Contact */}
          <SapRow>
            <SapField label="Contact" span={4}>
              <input type="text" value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Phone" span={4}>
              <input type="text" value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Email" span={4}>
              <input type="email" value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>

          {/* Address */}
          <SapRow>
            <SapField label="Address" span={8}>
              <input type="text" value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="City" span={2}>
              <input type="text" value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Country" span={2}>
              <input type="text" value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>

          {/* Tax */}
          <div className="border-t border-gray-200 pt-1.5" />
          <SapRow>
            <SapField label="NPWP" span={6}>
              <input type="text" value={formData.npwp}
                onChange={(e) => setFormData({ ...formData, npwp: e.target.value })}
                className={SAP_INPUT + ' !font-mono'} placeholder="00.000.000.0-000.000" />
            </SapField>
            <SapField label="PKP" span={6}>
              <label className="flex items-center gap-1.5 h-7 px-1 text-[11px]">
                <input type="checkbox" checked={formData.pkp_status}
                  onChange={(e) => setFormData({ ...formData, pkp_status: e.target.checked })}
                  className="rounded" />
                <span>Pengusaha Kena Pajak</span>
              </label>
            </SapField>
          </SapRow>

          {/* Bank */}
          <div className="border-t border-gray-200 pt-1.5" />
          <SapRow>
            <SapField label="Bank" span={4}>
              <input type="text" value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
            <SapField label="Acct #" span={4}>
              <input type="text" value={formData.bank_account_number}
                onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                className={SAP_INPUT + ' !font-mono'} />
            </SapField>
            <SapField label="Acct Name" span={4}>
              <input type="text" value={formData.bank_account_name}
                onChange={(e) => setFormData({ ...formData, bank_account_name: e.target.value })}
                className={SAP_INPUT} />
            </SapField>
          </SapRow>

          {/* Payment terms + defaults */}
          <div className="border-t border-gray-200 pt-1.5" />
          <SapRow>
            <SapField label="Terms (d)" span={4}>
              <input type="number" value={formData.payment_terms_days}
                onChange={(e) => setFormData({ ...formData, payment_terms_days: parseInt(e.target.value) || 30 })}
                className={SAP_INPUT + ' !text-right !font-mono'} />
            </SapField>
            <SapField label="Sup Type" span={4}>
              <select value={formData.supplier_type || 'General'}
                onChange={(e) => handleSupplierTypeChange(e.target.value)}
                className={SAP_INPUT}>
                {SUPPLIER_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </SapField>
            <SapField label="Default Cat" span={4}>
              <select value={formData.default_expense_category}
                onChange={(e) => setFormData({ ...formData, default_expense_category: e.target.value })}
                className={SAP_INPUT}>
                {DEFAULT_CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SapField>
          </SapRow>
          <SapRow>
            <SapField label="Tax Pref" span={6}>
              <select value={formData.tax_preference}
                onChange={(e) => setFormData({ ...formData, tax_preference: e.target.value as 'none' | 'ppn_only' | 'ppn_pph' | 'pph_only' })}
                className={SAP_INPUT}>
                <option value="none">None</option>
                <option value="ppn_only">PPN Only (11%)</option>
                <option value="ppn_pph">PPN + PPh</option>
                <option value="pph_only">PPh Only</option>
              </select>
            </SapField>
            {(formData.tax_preference === 'ppn_pph' || formData.tax_preference === 'pph_only') && (
              <SapField label="PPh Code" span={6}>
                <select value={formData.default_pph_code_id}
                  onChange={(e) => setFormData({ ...formData, default_pph_code_id: e.target.value })}
                  className={SAP_INPUT}>
                  <option value="">None</option>
                  {taxCodes.map(tc => (
                    <option key={tc.id} value={tc.id}>{tc.code} — {tc.name} ({tc.rate}%)</option>
                  ))}
                </select>
              </SapField>
            )}
          </SapRow>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 mt-1">
            <button type="button" onClick={() => setModalOpen(false)}
              className="h-7 px-3 text-xs text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded">Cancel</button>
            <button type="submit"
              className="h-7 px-3 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded font-semibold">
              {editingSupplier ? 'Update' : 'Create'} Supplier
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
