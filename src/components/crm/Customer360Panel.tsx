import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Phone, Mail, ShoppingCart, Clock3, Plus } from 'lucide-react';
import { showToast } from '../ToastNotification';

type CustomerRow = { id: string; company_name: string; contact_person?: string | null; email?: string | null; phone?: string | null; erp_customer_id?: string | null };
type CustomerIntel = CustomerRow & { erp?: any; inquiries: any[]; orders: any[]; invoices: any[]; lastPurchase: string | null; outstanding: number };

const daysSince = (date: string | null) => date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) : null;

export function Customer360Panel() {
  const [rows, setRows] = useState<CustomerIntel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: contacts, error: contactsError }, { data: customers, error: customersError }] = await Promise.all([
        supabase.from('crm_contacts').select('id,company_name,contact_person,email,phone,erp_customer_id').eq('is_active', true).order('company_name'),
        supabase.from('customers').select('id,company_name,contact_person,email,phone').eq('is_active', true).order('company_name'),
      ]);
      if (contactsError) throw contactsError;
      if (customersError) throw customersError;
      const contactByCustomerId = new Map((contacts || []).filter((c: any) => c.erp_customer_id).map((c: any) => [c.erp_customer_id, c]));
      const contactRows = (customers || []).map((erp: any) => {
        const linked = contactByCustomerId.get(erp.id) || (contacts || []).find((c: any) => c.company_name.trim().toLowerCase() === erp.company_name.trim().toLowerCase());
        return { ...(linked || {}), id: linked?.id || `erp-${erp.id}`, company_name: erp.company_name, contact_person: linked?.contact_person || erp.contact_person, email: linked?.email || erp.email, phone: linked?.phone || erp.phone, erp };
      });
      const erpIds = contactRows.map((c: any) => c.erp?.id).filter(Boolean);
      const [{ data: inquiries }, { data: orders }, { data: invoices }] = await Promise.all([
        supabase.from('crm_inquiries').select('id,crm_contact_id,customer_id,product_name,quantity,offered_price,created_at,pipeline_status,status').in('customer_id', erpIds),
        erpIds.length ? supabase.from('sales_orders').select('id,customer_id,so_number,status,so_date,created_at,total_amount').in('customer_id', erpIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
        erpIds.length ? supabase.from('sales_invoices').select('id,customer_id,invoice_number,invoice_date,total_amount,paid_amount,payment_status').in('customer_id', erpIds).order('invoice_date', { ascending: false }) : Promise.resolve({ data: [] }),
      ]);
      setRows(contactRows.map((c: any) => {
        const ci = (inquiries || []).filter((i: any) => i.customer_id === c.erp?.id || i.crm_contact_id === c.id);
        const co = (orders || []).filter((o: any) => o.customer_id === c.erp?.id);
        const inv = (invoices || []).filter((i: any) => i.customer_id === c.erp?.id);
        const lastPurchase = inv[0]?.invoice_date || null;
        const outstanding = inv.reduce((sum: number, i: any) => sum + Math.max(0, Number(i.total_amount || 0) - Number(i.paid_amount || 0)), 0);
        return { ...c, inquiries: ci, orders: co, invoices: inv, lastPurchase, outstanding };
      }));
    } catch (e: any) {
      showToast({ type: 'error', title: 'Customer 360', message: e.message || 'Unable to load customer intelligence.' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const visible = useMemo(() => rows.filter(r => r.company_name.toLowerCase().includes(filter.toLowerCase())), [rows, filter]);
  const selected = visible.find(r => r.id === selectedId) || visible[0];
  const inactivity = selected ? daysSince(selected.lastPurchase) : null;
  return <div className="grid lg:grid-cols-3 gap-3">
    <div className="bg-white border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Customer 360</h3><button onClick={load} className="text-xs text-blue-600">Refresh</button></div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search customer" className="w-full border rounded px-2 py-1 text-sm mb-2" />
      <div className="space-y-1 max-h-[65vh] overflow-auto">{visible.map(r => { const d = daysSince(r.lastPurchase); return <button key={r.id} onClick={() => setSelectedId(r.id)} className={`w-full text-left border rounded p-2 ${selected?.id === r.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}><div className="font-medium text-sm">{r.company_name}</div><div className="text-xs text-gray-500">{r.erp ? 'ERP linked' : 'CRM prospect'} {d !== null && d >= 90 ? `· inactive ${d}d` : ''}</div></button>; })}</div>
    </div>
    <div className="lg:col-span-2 bg-white border rounded-lg p-4">{loading ? <div className="text-sm text-gray-500">Loading customer intelligence…</div> : !selected ? <div className="text-sm text-gray-500">No customers found.</div> : <>
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">{selected.company_name}</h2><p className="text-sm text-gray-600">{selected.contact_person || 'No contact'} · {selected.email || 'No email'}</p></div><div className="flex gap-1">{selected.phone && <a href={`tel:${selected.phone}`} className="p-2 border rounded" title="Call"><Phone className="w-4 h-4" /></a>}{selected.email && <a href={`mailto:${selected.email}`} className="p-2 border rounded" title="Email"><Mail className="w-4 h-4" /></a>}</div></div>
      <div className="grid sm:grid-cols-4 gap-2 mt-4"><div className="border rounded p-2"><div className="text-xs text-gray-500">Inquiries</div><div className="text-lg font-semibold">{selected.inquiries.length}</div></div><div className="border rounded p-2"><div className="text-xs text-gray-500">Orders</div><div className="text-lg font-semibold">{selected.orders.length}</div></div><div className="border rounded p-2"><div className="text-xs text-gray-500">Invoices</div><div className="text-lg font-semibold">{selected.invoices.length}</div></div><div className="border rounded p-2"><div className="text-xs text-gray-500">Outstanding</div><div className="text-lg font-semibold">Rp {selected.outstanding.toLocaleString('id-ID')}</div></div></div>
      {!selected.erp && <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-sm text-amber-800">This CRM contact is not linked to an ERP customer. Use Inquiry 360 → Promote / Link Customer after confirming identity.</div>}
      {inactivity !== null && inactivity >= 30 && <div className={`mt-3 rounded p-2 text-sm ${inactivity >= 90 ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}><Clock3 className="inline w-4 h-4 mr-1" />Customer has not ordered for {inactivity} days. Consider a call or follow-up.</div>}
      <div className="grid md:grid-cols-2 gap-3 mt-4"><div><h3 className="font-medium text-sm mb-1">Recent inquiries</h3>{selected.inquiries.slice(0, 8).map(i => <div key={i.id} className="text-xs border-b py-1">{i.product_name} · {i.quantity} · {i.pipeline_status || i.status}</div>)}</div><div><h3 className="font-medium text-sm mb-1">Buying history</h3>{selected.invoices.slice(0, 8).map(i => <div key={i.id} className="text-xs border-b py-1">{i.invoice_number} · {i.invoice_date} · {i.payment_status}</div>)}</div></div>
    </>}</div>
  </div>;
}
