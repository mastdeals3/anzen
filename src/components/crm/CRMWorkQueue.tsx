import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Clock3, MessageSquareWarning, CheckCircle2, Plus } from 'lucide-react';

type Inquiry = { id: string; inquiry_number: string; company_name: string; product_name: string; pipeline_status?: string | null; status?: string | null; priority?: string | null; created_at: string; quote_sent_at?: string | null; last_reminder_sent_at?: string | null; converted_to_order?: string | null; price_quoted?: boolean | null; coa_required?: boolean | null; sample_required?: boolean | null; assigned_to?: string | null; };
type Reminder = { id: string; title: string; due_date: string; is_completed: boolean; crm_inquiries?: { inquiry_number: string; company_name: string; product_name: string } | null };
type InactiveCustomer = { id: string; company_name: string; days: number };

export function CRMWorkQueue({ inquiries }: { inquiries: Inquiry[] }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [inactive, setInactive] = useState<InactiveCustomer[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('crm_reminders').select('id,title,due_date,is_completed,crm_inquiries(inquiry_number,company_name,product_name)').eq('is_completed', false).order('due_date', { ascending: true }).then(({ data }) => setReminders((data || []) as unknown as Reminder[]));
    Promise.all([
      supabase.from('customers').select('id,company_name').eq('is_active', true),
      supabase.from('sales_invoices').select('customer_id,invoice_date').order('invoice_date', { ascending: false }),
    ]).then(([customersRes, invoicesRes]) => {
      const latest = new Map<string, string>();
      (invoicesRes.data || []).forEach((i: any) => { if (i.customer_id && !latest.has(i.customer_id)) latest.set(i.customer_id, i.invoice_date); });
      const now = Date.now();
      setInactive((customersRes.data || []).map((c: any) => ({ id: c.id, company_name: c.company_name, days: latest.has(c.id) ? Math.floor((now - new Date(latest.get(c.id)!).getTime()) / 86400000) : 9999 })).filter(c => c.days >= 30).sort((a, b) => b.days - a.days));
    });
  }, []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const queue = useMemo(() => {
    const overdue = reminders.filter(r => new Date(r.due_date) < today);
    const dueToday = reminders.filter(r => { const d = new Date(r.due_date); return d >= today && d < new Date(today.getTime() + 86400000); });
    const newItems = inquiries.filter(i => (i.pipeline_status || i.status) === 'new');
    const waiting = inquiries.filter(i => ['quoted', 'price_quoted', 'follow_up', 'waiting', 'in_progress'].includes((i.pipeline_status || i.status || '').toLowerCase()));
    const noConversion = inquiries.filter(i => ['high', 'urgent'].includes((i.priority || '').toLowerCase()) && !i.converted_to_order && (i.price_quoted || ['in_progress', 'follow_up'].includes((i.pipeline_status || '').toLowerCase())));
    return { overdue, dueToday, newItems, waiting, noConversion };
  }, [inquiries, reminders]);
  const createFollowUp = async (inquiry: Inquiry) => {
    setCreating(inquiry.id);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const actionType = inquiry.coa_required ? 'send_coa' : inquiry.sample_required ? 'send_sample' : inquiry.price_quoted ? 'send_price' : 'follow_up';
      const { error } = await supabase.rpc('auto_create_followup', { p_inquiry_id: inquiry.id, p_action_type: actionType, p_user_id: auth.user.id });
      if (error) throw error;
      setReminders(current => [...current, { id: `pending-${inquiry.id}`, title: `Follow up: ${inquiry.company_name} — ${inquiry.product_name}`, due_date: new Date().toISOString(), is_completed: false }]);
    } catch (error) { console.error('CRM follow-up creation failed:', error); }
    finally { setCreating(null); }
  };
  const Card = ({ icon: Icon, title, rows, tone }: { icon: any; title: string; rows: any[]; tone: string }) => <div className={`border rounded-lg p-3 ${tone}`}><div className="flex items-center gap-2 font-medium text-sm"><Icon className="w-4 h-4" />{title}<span className="ml-auto">{rows.length}</span></div><div className="mt-2 space-y-1 max-h-44 overflow-auto">{rows.slice(0, 12).map((r: any) => <div key={r.id || r.inquiry_number} className="text-xs bg-white/70 rounded px-2 py-1 flex gap-1 items-center"><span className="min-w-0 flex-1">{r.title || `${r.inquiry_number} · ${r.company_name} · ${r.product_name}`} {r.due_date ? `· ${new Date(r.due_date).toLocaleDateString()}` : ''}</span>{r.inquiry_number && <button onClick={() => createFollowUp(r)} disabled={creating === r.id} title="Create follow-up" className="p-1 text-blue-700"><Plus className="w-3 h-3" /></button>}</div>)}{rows.length === 0 && <div className="text-xs opacity-70">Nothing needs action.</div>}</div></div>;
  return <div className="space-y-3"><div><h2 className="text-lg font-semibold">Today’s CRM Work</h2><p className="text-sm text-gray-600">Action queue from real inquiries, reminders, and invoice history — no fake activities.</p></div><div className="grid md:grid-cols-2 xl:grid-cols-6 gap-3"><Card icon={AlertTriangle} title="Overdue follow-ups" rows={queue.overdue} tone="bg-red-50 border-red-200 text-red-900" /><Card icon={Clock3} title="Due today" rows={queue.dueToday} tone="bg-amber-50 border-amber-200 text-amber-900" /><Card icon={MessageSquareWarning} title="New inquiries" rows={queue.newItems} tone="bg-blue-50 border-blue-200 text-blue-900" /><Card icon={CheckCircle2} title="Quoted / waiting" rows={queue.waiting} tone="bg-violet-50 border-violet-200 text-violet-900" /><Card icon={AlertTriangle} title="High-priority no conversion" rows={queue.noConversion} tone="bg-orange-50 border-orange-200 text-orange-900" /><Card icon={Clock3} title="Inactive customers" rows={inactive.map(c => ({ id: c.id, title: `${c.company_name} · ${c.days >= 9999 ? 'no invoice history' : `${c.days} days inactive`}` }))} tone="bg-slate-50 border-slate-200 text-slate-900" /></div></div>;
}
