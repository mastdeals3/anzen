import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Hash, ExternalLink, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { sanitizeExportRows } from '../../../utils/csvSafe';
import { TaxAttachments } from './TaxAttachments';

interface SalesInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  tax_amount: number | null;
  total_amount: number;
  faktur_pajak_number: string | null;
  customer_id: string | null;
}
interface Customer {
  id: string;
  customer_name: string;
  company_name: string;
  npwp: string | null;
}
interface FakturRow {
  id: string;
  sales_invoice_id: string;
  faktur_number: string;
  issue_date: string;
  dpp_amount: number;
  ppn_amount: number;
  status: string;
  reported_at: string | null;
}

const FAKTUR_KINDS = [
  { value: 'pdf', label: 'PDF Faktur' },
  { value: 'xml', label: 'XML' },
  { value: 'csv', label: 'CSV' },
  { value: 'other', label: 'Other' },
] as const;

function customerDisplay(c: Customer | undefined): string {
  if (!c) return '—';
  if (c.company_name && c.customer_name && c.company_name !== c.customer_name) {
    return `${c.company_name} (${c.customer_name})`;
  }
  return c.company_name || c.customer_name || '—';
}

export function FakturPajakPanel() {
  const { dateRange } = useFinance();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [fakturs, setFakturs] = useState<Record<string, FakturRow>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'generated' | 'uploaded' | 'reported'>('all');

  async function refresh() {
    setLoading(true);
    let q = supabase
      .from('sales_invoices')
      .select('id, invoice_number, invoice_date, tax_amount, total_amount, faktur_pajak_number, customer_id')
      .gt('tax_amount', 0);
    if (dateRange?.startDate) q = q.gte('invoice_date', dateRange.startDate);
    if (dateRange?.endDate) q = q.lte('invoice_date', dateRange.endDate);
    const { data: inv } = await q.order('invoice_date', { ascending: false }).limit(500);
    const invoices = (inv as SalesInvoice[] | null) ?? [];
    setInvoices(invoices);

    const custIds = Array.from(new Set(invoices.map(i => i.customer_id).filter(Boolean))) as string[];
    if (custIds.length) {
      const { data: cs } = await supabase
        .from('customers')
        .select('id, customer_name, company_name, npwp')
        .in('id', custIds);
      setCustomers(Object.fromEntries(((cs as Customer[] | null) ?? []).map(c => [c.id, c])));
    } else {
      setCustomers({});
    }

    const invIds = invoices.map(i => i.id);
    if (invIds.length) {
      const { data: fs } = await supabase
        .from('faktur_pajak')
        .select('id, sales_invoice_id, faktur_number, issue_date, dpp_amount, ppn_amount, status, reported_at')
        .in('sales_invoice_id', invIds);
      setFakturs(Object.fromEntries(((fs as FakturRow[] | null) ?? []).map(f => [f.sales_invoice_id, f])));
    } else {
      setFakturs({});
    }
    setLoading(false);
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dateRange?.startDate, dateRange?.endDate]);

  const missingCount = useMemo(
    () => invoices.filter(i => !i.faktur_pajak_number || i.faktur_pajak_number === '').length,
    [invoices]
  );

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'all') return invoices;
    if (statusFilter === 'missing') return invoices.filter(i => !i.faktur_pajak_number);
    return invoices.filter(i => {
      const f = fakturs[i.id];
      return f && f.status === statusFilter;
    });
  }, [invoices, fakturs, statusFilter]);

  async function generateFor(invoiceId: string) {
    setBusyId(invoiceId);
    try {
      const { error } = await supabase.rpc('assign_faktur_pajak_number', { p_sales_invoice_id: invoiceId });
      if (error) throw error;
      await refresh();
    } catch (err) {
      alert('Failed to generate Faktur Pajak: ' + (err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function markStatus(fakturRowId: string, status: 'uploaded' | 'reported') {
    const { error } = await supabase
      .from('faktur_pajak')
      .update({ status, reported_at: status === 'reported' ? new Date().toISOString() : null })
      .eq('id', fakturRowId);
    if (error) alert(error.message);
    await refresh();
  }

  function drillIntoInvoice(inv: SalesInvoice) {
    // Navigate to the sales page; the invoice number is copied to the clipboard
    // so the user can paste-search the list.
    void navigator.clipboard?.writeText(inv.invoice_number);
    navigate(`/sales?invoice=${encodeURIComponent(inv.invoice_number)}`);
  }

  function exportExcel() {
    const rows = filteredInvoices.map(inv => {
      const fak = fakturs[inv.id];
      const cust = inv.customer_id ? customers[inv.customer_id] : undefined;
      const dpp = fak?.dpp_amount ?? Math.max((inv.total_amount ?? 0) - (inv.tax_amount ?? 0), 0);
      const ppn = fak?.ppn_amount ?? (inv.tax_amount ?? 0);
      return {
        'Invoice #': inv.invoice_number,
        'Invoice Date': inv.invoice_date,
        'Customer': customerDisplay(cust),
        'Customer NPWP': cust?.npwp ?? '',
        'DPP (Rp)': Number(dpp),
        'PPN (Rp)': Number(ppn),
        'Faktur Number': inv.faktur_pajak_number ?? '',
        'Status': fak?.status ?? (inv.faktur_pajak_number ? 'generated' : 'missing'),
        'Reported At': fak?.reported_at ?? '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(sanitizeExportRows(rows));
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Faktur Pajak');
    XLSX.writeFile(wb, `Faktur_Pajak_${dateRange.startDate}_${dateRange.endDate}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" /> Faktur Pajak
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 hidden md:inline">
            {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
          </span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm border rounded px-2 py-1.5 bg-white"
          >
            <option value="all">All ({invoices.length})</option>
            <option value="missing">Missing ({missingCount})</option>
            <option value="generated">Generated</option>
            <option value="uploaded">Uploaded</option>
            <option value="reported">Reported</option>
          </select>
          <button
            onClick={exportExcel}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filteredInvoices.length === 0 ? (
        <p className="text-sm text-gray-500 p-4 border rounded bg-yellow-50">
          No sales invoices with PPN in the selected date range.
        </p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Invoice #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-right px-3 py-2">DPP</th>
                <th className="text-right px-3 py-2">PPN</th>
                <th className="text-left px-3 py-2">Faktur #</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(inv => {
                const fak = fakturs[inv.id];
                const cust = inv.customer_id ? customers[inv.customer_id] : undefined;
                return (
                  <tr key={inv.id} className={`border-t ${selected === inv.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2 font-medium">
                      <button
                        onClick={() => drillIntoInvoice(inv)}
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        title="Open in Sales"
                      >
                        {inv.invoice_number}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                    <td className="px-3 py-2">{inv.invoice_date}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{customerDisplay(cust)}</div>
                      {cust?.npwp && <div className="text-[10px] text-gray-500">NPWP: {cust.npwp}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{Number((inv.total_amount ?? 0) - (inv.tax_amount ?? 0)).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-right">{Number(inv.tax_amount ?? 0).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{inv.faktur_pajak_number ?? '—'}</td>
                    <td className="px-3 py-2">
                      {fak ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          fak.status === 'reported' ? 'bg-green-100 text-green-800' :
                          fak.status === 'uploaded' ? 'bg-blue-100 text-blue-800' :
                          fak.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                                     'bg-gray-100 text-gray-700'
                        }`}>{fak.status}</span>
                      ) : inv.faktur_pajak_number ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">generated</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800">missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                      {!inv.faktur_pajak_number && (
                        <button
                          onClick={() => void generateFor(inv.id)}
                          disabled={busyId === inv.id}
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1"
                        >
                          <Hash className="w-3 h-3" />
                          {busyId === inv.id ? '…' : 'Generate'}
                        </button>
                      )}
                      {fak && (
                        <>
                          <button
                            onClick={() => setSelected(inv.id === selected ? null : inv.id)}
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                          >
                            Files
                          </button>
                          {fak.status === 'generated' && (
                            <button
                              onClick={() => void markStatus(fak.id, 'uploaded')}
                              className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                            >
                              → Uploaded
                            </button>
                          )}
                          {fak.status === 'uploaded' && (
                            <button
                              onClick={() => void markStatus(fak.id, 'reported')}
                              className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                            >
                              → Reported
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && fakturs[selected] && (
        <div className="border rounded p-4 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Attachments · Faktur {fakturs[selected].faktur_number}</h4>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-500">Close</button>
          </div>
          <TaxAttachments
            table="faktur_pajak_files"
            parentId={fakturs[selected].id}
            storagePrefix="faktur_pajak"
            allowedKinds={FAKTUR_KINDS}
          />
        </div>
      )}
    </div>
  );
}
