import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Plus, Mail, Calendar as CalendarIcon, LayoutGrid, Users, Table, Inbox, Activity, Clock, Archive } from 'lucide-react';
import { EmailInbox } from '../components/crm/EmailInbox';
import { InquiryTableExcel } from '../components/crm/InquiryTableExcel';
import { ReminderCalendar } from '../components/crm/ReminderCalendar';
import { PipelineBoard } from '../components/crm/PipelineBoard';
import { EmailComposer } from '../components/crm/EmailComposer';
import { CustomerDatabase } from '../components/crm/CustomerDatabase';
import { ActivityLogger } from '../components/crm/ActivityLogger';
import { AppointmentScheduler } from '../components/crm/AppointmentScheduler';
import { ArchiveView } from '../components/crm/ArchiveView';

interface Inquiry {
  id: string;
  inquiry_number: string;
  inquiry_date: string;
  product_name: string;
  specification?: string | null;
  quantity: string;
  supplier_name: string | null;
  supplier_country: string | null;
  company_name: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  email_subject: string | null;
  mail_subject?: string | null;
  status: string;
  pipeline_status?: string;
  priority: string;
  coa_sent: boolean;
  coa_sent_date: string | null;
  msds_sent: boolean;
  msds_sent_date: string | null;
  sample_sent: boolean;
  sample_sent_date: string | null;
  price_quoted: boolean;
  price_quoted_date: string | null;
  price_required?: boolean;
  coa_required?: boolean;
  sample_required?: boolean;
  agency_letter_required?: boolean;
  price_sent_at?: string | null;
  coa_sent_at?: string | null;
  sample_sent_at?: string | null;
  agency_letter_sent_at?: string | null;
  aceerp_no?: string | null;
  purchase_price?: number | null;
  purchase_price_currency?: string;
  offered_price?: number | null;
  offered_price_currency?: string;
  delivery_date?: string | null;
  delivery_terms?: string | null;
  lost_reason?: string | null;
  lost_at?: string | null;
  competitor_name?: string | null;
  competitor_price?: number | null;
  remarks: string | null;
  internal_notes: string | null;
  created_at: string;
  user_profiles?: {
    full_name: string;
  };
}

export function CRM() {
  const { profile } = useAuth();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'table' | 'pipeline' | 'calendar' | 'email' | 'customers' | 'activities' | 'appointments' | 'archive'>('table');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState<Inquiry | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [selectedInquiryForEmail, setSelectedInquiryForEmail] = useState<any>(null);

  const [formData, setFormData] = useState({
    product_name: '',
    quantity: '',
    supplier_name: '',
    supplier_country: '',
    company_name: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    mail_subject: '',
    status: 'new',
    pipeline_status: 'new',
    priority: 'medium',
    inquiry_source: 'other',
    aceerp_no: '',
    purchase_price: '',
    purchase_price_currency: 'USD',
    offered_price: '',
    offered_price_currency: 'USD',
    delivery_date: '',
    delivery_terms: '',
    price_required: false,
    coa_required: false,
    sample_required: false,
    agency_letter_required: false,
    remarks: '',
    internal_notes: '',
  });

  useEffect(() => {
    loadInquiries();
  }, []);

  const loadInquiries = async () => {
    try {
      // Exclude 'lost' status inquiries from default view (they appear in Archive)
      const { data, error } = await supabase
        .from('crm_inquiries')
        .select('*, user_profiles!crm_inquiries_assigned_to_fkey(full_name)')
        .neq('pipeline_status', 'lost')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInquiries(data || []);
    } catch (error) {
      console.error('Error loading inquiries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (editingInquiry) {
        const updateData: any = {
          ...formData,
          purchase_price: formData.purchase_price ? parseFloat(formData.purchase_price) : null,
          offered_price: formData.offered_price ? parseFloat(formData.offered_price) : null,
        };

        const { error } = await supabase
          .from('crm_inquiries')
          .update(updateData)
          .eq('id', editingInquiry.id);

        if (error) throw error;
      } else {
        const insertData: any = {
          ...formData,
          inquiry_date: new Date().toISOString().split('T')[0],
          assigned_to: user.id,
          created_by: user.id,
          // Parse numeric fields
          purchase_price: formData.purchase_price ? parseFloat(formData.purchase_price) : null,
          offered_price: formData.offered_price ? parseFloat(formData.offered_price) : null,
          // inquiry_number is auto-generated by database trigger
        };

        const { error } = await supabase
          .from('crm_inquiries')
          .insert([insertData]);

        if (error) throw error;
      }

      setModalOpen(false);
      resetForm();
      loadInquiries();
    } catch (error) {
      console.error('Error saving inquiry:', error);
      alert('Failed to save inquiry. Please try again.');
    }
  };

  const handleEdit = (inquiry: Inquiry) => {
    setEditingInquiry(inquiry);
    setFormData({
      product_name: inquiry.product_name,
      quantity: inquiry.quantity,
      supplier_name: inquiry.supplier_name || '',
      supplier_country: inquiry.supplier_country || '',
      company_name: inquiry.company_name,
      contact_person: inquiry.contact_person || '',
      contact_email: inquiry.contact_email || '',
      contact_phone: inquiry.contact_phone || '',
      mail_subject: inquiry.mail_subject || '',
      status: inquiry.status,
      pipeline_status: inquiry.pipeline_status || 'new',
      priority: inquiry.priority,
      inquiry_source: (inquiry as any).inquiry_source || 'other',
      aceerp_no: inquiry.aceerp_no || '',
      purchase_price: inquiry.purchase_price ? inquiry.purchase_price.toString() : '',
      purchase_price_currency: inquiry.purchase_price_currency || 'USD',
      offered_price: inquiry.offered_price ? inquiry.offered_price.toString() : '',
      offered_price_currency: inquiry.offered_price_currency || 'USD',
      delivery_date: inquiry.delivery_date || '',
      delivery_terms: inquiry.delivery_terms || '',
      price_required: inquiry.price_required || false,
      coa_required: inquiry.coa_required || false,
      sample_required: inquiry.sample_required || false,
      agency_letter_required: inquiry.agency_letter_required || false,
      remarks: inquiry.remarks || '',
      internal_notes: inquiry.internal_notes || '',
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this inquiry?')) return;

    try {
      const { error } = await supabase
        .from('crm_inquiries')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadInquiries();
    } catch (error) {
      console.error('Error deleting inquiry:', error);
      alert('Failed to delete inquiry. Please try again.');
    }
  };

  const handleSendEmail = (inquiry: Inquiry) => {
    setSelectedInquiryForEmail({
      id: inquiry.id,
      inquiry_number: inquiry.inquiry_number,
      company_name: inquiry.company_name,
      contact_person: inquiry.contact_person,
      contact_email: inquiry.contact_email,
      product_name: inquiry.product_name,
      quantity: inquiry.quantity,
    });
    setEmailModalOpen(true);
  };

  const resetForm = () => {
    setEditingInquiry(null);
    setFormData({
      product_name: '',
      quantity: '',
      supplier_name: '',
      supplier_country: '',
      company_name: '',
      contact_person: '',
      contact_email: '',
      contact_phone: '',
      mail_subject: '',
      status: 'new',
      pipeline_status: 'new',
      priority: 'medium',
      inquiry_source: 'other',
      aceerp_no: '',
      purchase_price: '',
      purchase_price_currency: 'USD',
      offered_price: '',
      offered_price_currency: 'USD',
      delivery_date: '',
      delivery_terms: '',
      price_required: false,
      coa_required: false,
      sample_required: false,
      agency_letter_required: false,
      remarks: '',
      internal_notes: '',
    });
  };

  const canManage = profile?.role === 'admin' || profile?.role === 'sales';

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">CRM - Inquiry Management</h1>
            <p className="text-gray-600 mt-1">Manage pharmaceutical inquiries with AI-powered email processing</p>
          </div>
          {canManage && (
            <button
              onClick={() => {
                resetForm();
                setModalOpen(true);
              }}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Add Inquiry
            </button>
          )}
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <div className="flex overflow-x-auto">
              <button
                onClick={() => setActiveTab('email')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'email'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Inbox className="w-5 h-5" />
                Email Inbox
              </button>
              <button
                onClick={() => setActiveTab('table')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'table'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Table className="w-5 h-5" />
                Table View
              </button>
              <button
                onClick={() => setActiveTab('pipeline')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'pipeline'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <LayoutGrid className="w-5 h-5" />
                Pipeline
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'calendar'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <CalendarIcon className="w-5 h-5" />
                Calendar
              </button>
              <button
                onClick={() => setActiveTab('customers')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'customers'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Users className="w-5 h-5" />
                Customers
              </button>
              <button
                onClick={() => setActiveTab('activities')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'activities'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Activity className="w-5 h-5" />
                Activities
              </button>
              <button
                onClick={() => setActiveTab('appointments')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'appointments'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Clock className="w-5 h-5" />
                Appointments
              </button>
              <button
                onClick={() => setActiveTab('archive')}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition whitespace-nowrap ${
                  activeTab === 'archive'
                    ? 'border-blue-500 text-blue-600 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Archive className="w-5 h-5" />
                Archive
              </button>
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'email' && (
              <EmailInbox onInquiryCreated={loadInquiries} />
            )}

            {activeTab === 'table' && (
              <InquiryTableExcel
                inquiries={inquiries}
                onRefresh={loadInquiries}
                canManage={canManage}
              />
            )}

            {activeTab === 'pipeline' && (
              <PipelineBoard
                canManage={canManage}
                onInquiryClick={(inquiry) => handleEdit(inquiry as Inquiry)}
              />
            )}

            {activeTab === 'calendar' && (
              <ReminderCalendar onReminderCreated={loadInquiries} />
            )}

            {activeTab === 'customers' && (
              <CustomerDatabase canManage={canManage} />
            )}

            {activeTab === 'activities' && (
              <ActivityLogger onActivityLogged={loadInquiries} />
            )}

            {activeTab === 'appointments' && (
              <AppointmentScheduler onAppointmentCreated={loadInquiries} />
            )}

            {activeTab === 'archive' && (
              <ArchiveView canManage={canManage} onRefresh={loadInquiries} />
            )}
          </div>
        </div>

        <Modal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            resetForm();
          }}
          title={editingInquiry ? 'Edit Inquiry' : 'Add New Inquiry'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={formData.product_name}
                  onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity *
                </label>
                <input
                  type="text"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                  placeholder="e.g., 150 KG"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority *
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Inquiry Source *
                </label>
                <select
                  value={formData.inquiry_source}
                  onChange={(e) => setFormData({ ...formData, inquiry_source: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="phone_call">Phone Call</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supplier Name
                </label>
                <input
                  type="text"
                  value={formData.supplier_name}
                  onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Omochi Seiyaku"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Country of Origin
                </label>
                <input
                  type="text"
                  value={formData.supplier_country}
                  onChange={(e) => setFormData({ ...formData, supplier_country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Japan"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.contact_email}
                  onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="text"
                  value={formData.contact_phone}
                  onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mail Subject
                </label>
                <input
                  type="text"
                  value={formData.mail_subject}
                  onChange={(e) => setFormData({ ...formData, mail_subject: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Email subject (from Command Center or manual)"
                />
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Customer Requested
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.price_required}
                      onChange={(e) => setFormData({ ...formData, price_required: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Price Quote</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.coa_required}
                      onChange={(e) => setFormData({ ...formData, coa_required: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">COA</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.sample_required}
                      onChange={(e) => setFormData({ ...formData, sample_required: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Sample</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.agency_letter_required}
                      onChange={(e) => setFormData({ ...formData, agency_letter_required: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Agency Letter</span>
                  </label>
                </div>
              </div>

              {profile?.role === 'admin' && (
                <div className="col-span-2 border-t pt-4 mt-2">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Pricing (Admin Only)
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Purchase Price
                      </label>
                      <input
                        type="number"
                        value={formData.purchase_price}
                        onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Currency
                      </label>
                      <select
                        value={formData.purchase_price_currency}
                        onChange={(e) => setFormData({ ...formData, purchase_price_currency: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="INR">INR</option>
                        <option value="GBP">GBP</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="col-span-2 border-t pt-4 mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Offered Price
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Price
                    </label>
                    <input
                      type="number"
                      value={formData.offered_price}
                      onChange={(e) => setFormData({ ...formData, offered_price: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Currency
                    </label>
                    <select
                      value={formData.offered_price_currency}
                      onChange={(e) => setFormData({ ...formData, offered_price_currency: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="INR">INR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Delivery
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Delivery Date
                    </label>
                    <input
                      type="date"
                      value={formData.delivery_date}
                      onChange={(e) => setFormData({ ...formData, delivery_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Delivery Terms
                    </label>
                    <select
                      value={formData.delivery_terms}
                      onChange={(e) => setFormData({ ...formData, delivery_terms: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select...</option>
                      <option value="FOB Shanghai">FOB Shanghai</option>
                      <option value="CIF Dubai">CIF Dubai</option>
                      <option value="EXW">EXW</option>
                      <option value="DDP">DDP</option>
                      <option value="DAP">DAP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ACE ERP No
                </label>
                <input
                  type="text"
                  value={formData.aceerp_no}
                  onChange={(e) => setFormData({ ...formData, aceerp_no: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Internal reference number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status *
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="new">New</option>
                  <option value="price_quoted">Price Quoted</option>
                  <option value="coa_pending">COA Pending</option>
                  <option value="sample_sent">Sample Sent</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="po_received">PO Received</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Remarks
                </label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Customer-facing remarks"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Internal Notes
                </label>
                <textarea
                  value={formData.internal_notes}
                  onChange={(e) => setFormData({ ...formData, internal_notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Internal notes (not visible to customer)"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {editingInquiry ? 'Update Inquiry' : 'Add Inquiry'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={emailModalOpen}
          onClose={() => {
            setEmailModalOpen(false);
            setSelectedInquiryForEmail(null);
          }}
          title="Send Email"
        >
          <EmailComposer
            inquiry={selectedInquiryForEmail}
            onClose={() => {
              setEmailModalOpen(false);
              setSelectedInquiryForEmail(null);
            }}
            onSent={() => {
              loadInquiries();
            }}
          />
        </Modal>
      </div>
    </Layout>
  );
}
