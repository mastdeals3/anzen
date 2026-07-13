import { useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { sanitizeExportRows } from '../../../utils/csvSafe';

type ReportId =
  | 'input_ppn'
  | 'output_ppn'
  | 'ppn_payable'
  | 'pph_register'
  | 'tax_payments'
  | 'outstanding'
  | 'monthly_summary'
  | 'faktur_register'
  | 'audit_trail';

interface Report {
  id: ReportId;
  label: string;
  description: string;
}

const REPORTS: Report[] = [
  { id: 'input_ppn',       label: 'Input PPN Register',   description: 'PPN Masukan from purchase invoices & expenses' },
  { id: 'output_ppn',      label: 'Output PPN Register',  description: 'PPN Keluaran from sales invoices with Faktur Pajak' },
  { id: 'ppn_payable',     label: 'PPN Payable Report',   description: 'Input vs Output vs Carry Forward per period' },
  { id: 'pph_register',    label: 'PPh Register',         description: 'PPh 21/22/23/4(2)/Unifikasi withholdings' },
  { id: 'tax_payments',    label: 'Tax Payment Register', description: 'All remittances with NTPN / Billing Code / Bank' },
  { id: 'outstanding',     label: 'Outstanding Tax',      description: 'Unpaid balances by period + due date' },
  { id: 'monthly_summary', label: 'Monthly Tax Summary',  description: 'Consolidated PPN + PPh per month' },
  { id: 'faktur_register', label: 'Faktur Pajak Register', description: 'All Faktur Pajak issued with status' },
  { id: 'audit_trail',     label: 'Tax Audit Trail',      description: 'audit_logs entries for tax mutations' },
];

interface Row { [k: string]: string | number | null; }

async function fetchReport(id: ReportId, startDate: string, endDate: string): Promise<Row[]> {
  switch (id) {
    case 'input_ppn': {
      const { data } = await supabase
        .from('vw_input_ppn_report')
        .select('*')
        .gte('expense_date', startDate)
        .lte('expense_date', endDate)
        .order('expense_date');
      return (data ?? []) as Row[];
    }
    case 'output_ppn': {
      const { data } = await supabase
        .from('vw_output_ppn_report')
        .select('*')
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate)
        .order('invoice_date');
      return (data ?? []) as Row[];
    }
    case 'ppn_payable': {
      const { data } = await supabase
        .from('vw_ppn_net_by_period')
        .select('*')
        .gte('period_end', startDate)
        .lte('period_start', endDate)
        .order('fiscal_year', { ascending: false })
        .order('period_month', { ascending: false });
      return (data ?? []) as Row[];
    }
    case 'pph_register': {
      const { data } = await supabase
        .from('vw_pph_by_period_type')
        .select('*')
        .order('fiscal_year', { ascending: false })
        .order('period_month', { ascending: false });
      return (data ?? []) as Row[];
    }
    case 'tax_payments': {
      const { data } = await supabase
        .from('tax_payments')
        .select('payment_date, tax_type, amount, billing_code, ntpn, payment_reference, government_reference, status, journal_entry_id, notes, bank_accounts:bank_account_id(alias, bank_name, account_name)')
        .gte('payment_date', startDate)
        .lte('payment_date', endDate)
        .order('payment_date', { ascending: false });
      return ((data ?? []) as Array<Record<string, unknown>>).map(r => {
        const bank = r.bank_accounts as { alias?: string; bank_name?: string; account_name?: string } | null;
        const bankLabel = bank ? (bank.alias || `${bank.bank_name ?? ''} - ${bank.account_name ?? ''}`) : '';
        return {
          'Payment Date':   r.payment_date as string,
          'Tax Type':       r.tax_type as string,
          'Amount (Rp)':    Number(r.amount ?? 0),
          'Bank':           bankLabel,
          'NTPN':           (r.ntpn as string) ?? '',
          'Billing Code':   (r.billing_code as string) ?? '',
          'Payment Ref':    (r.payment_reference as string) ?? '',
          'Gov Ref':        (r.government_reference as string) ?? '',
          'Status':         r.status as string,
          'JE #':           (r.journal_entry_id as string) ?? '',
          'Notes':          (r.notes as string) ?? '',
        };
      });
    }
    case 'outstanding': {
      const { data } = await supabase.from('vw_outstanding_tax').select('*');
      return (data ?? []) as Row[];
    }
    case 'monthly_summary': {
      const { data } = await supabase
        .from('vw_monthly_tax_summary')
        .select('*')
        .gte('month', startDate.slice(0, 7))
        .lte('month', endDate.slice(0, 7))
        .order('month', { ascending: false });
      return (data ?? []) as Row[];
    }
    case 'faktur_register': {
      const { data } = await supabase
        .from('faktur_pajak')
        .select('faktur_number, issue_date, status, dpp_amount, ppn_amount, reported_at, sales_invoice:sales_invoice_id(invoice_number, customer:customer_id(customer_name, company_name, npwp))')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate)
        .order('issue_date', { ascending: false });
      return ((data ?? []) as Array<Record<string, unknown>>).map(r => {
        const inv = r.sales_invoice as { invoice_number?: string; customer?: { customer_name?: string; company_name?: string; npwp?: string } } | null;
        const cust = inv?.customer;
        const custDisplay = cust
          ? (cust.company_name || cust.customer_name || '')
          : '';
        return {
          'Faktur Number':  r.faktur_number as string,
          'Issue Date':     r.issue_date as string,
          'Invoice #':      inv?.invoice_number ?? '',
          'Customer':       custDisplay,
          'NPWP':           cust?.npwp ?? '',
          'DPP (Rp)':       Number(r.dpp_amount ?? 0),
          'PPN (Rp)':       Number(r.ppn_amount ?? 0),
          'Status':         r.status as string,
          'Reported At':    (r.reported_at as string) ?? '',
        };
      });
    }
    case 'audit_trail': {
      const { data } = await supabase
        .from('audit_logs')
        .select('created_at, user_id, table_name, action_type, record_id, new_values')
        .in('table_name', ['tax_payments','tax_periods','faktur_pajak'])
        .gte('created_at', startDate)
        .lte('created_at', endDate + 'T23:59:59')
        .order('created_at', { ascending: false })
        .limit(1000);
      return ((data ?? []) as Row[]).map(r => ({
        'Timestamp':  r.created_at as string,
        'Table':      r.table_name as string,
        'Action':     r.action_type as string,
        'Record ID':  r.record_id as string,
        'User ID':    r.user_id as string,
        'Details':    JSON.stringify(r.new_values ?? {}),
      }));
    }
    default:
      return [];
  }
}

export function TaxReportsPanel() {
  const { dateRange } = useFinance();
  const [reportId, setReportId] = useState<ReportId>('ppn_payable');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const activeReport = useMemo(() => REPORTS.find(r => r.id === reportId)!, [reportId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchReport(reportId, dateRange.startDate, dateRange.endDate)
      .then(data => {
        if (!cancelled) setRows(data);
      })
      .catch(err => {
        if (!cancelled) {
          console.error(err);
          setRows([]);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reportId, dateRange.startDate, dateRange.endDate]);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  function exportExcel() {
    const meta: Row[] = [
      { 'Report': activeReport.label },
      { 'Report': `Period: ${dateRange.startDate} to ${dateRange.endDate}` },
      { 'Report': `Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}` },
      { 'Report': `Rows: ${rows.length}` },
      { 'Report': '' },
    ];
    const ws = XLSX.utils.json_to_sheet(sanitizeExportRows([...meta, ...rows]), { skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeReport.label.slice(0, 30));
    XLSX.writeFile(wb, `${activeReport.label.replace(/\s+/g, '_')}_${dateRange.startDate}_${dateRange.endDate}.xlsx`);
  }

  function exportPdf() {
    // Print-friendly HTML rendered in a new window. Users choose "Save as PDF"
    // from the browser print dialog. Reusing the browser's PDF engine keeps us
    // aligned with the existing "print to PDF" pattern used across Finance
    // reports without adding a new dependency.
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = rows.map(r =>
      `<tr>${columns.map(c => {
        const v = r[c];
        const isNum = typeof v === 'number';
        const cell = v === null || v === undefined ? '' : String(v);
        return `<td style="border-bottom:1px solid #ddd;padding:4px 8px;${isNum ? 'text-align:right;' : ''}">${cell.replace(/</g,'&lt;')}</td>`;
      }).join('')}</tr>`
    ).join('');
    const html = `<!doctype html>
<html><head><title>${activeReport.label}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  h2{font-size:12px;margin:0 0 16px;color:#555;font-weight:normal}
  table{border-collapse:collapse;width:100%}
  th{background:#f3f4f6;text-align:left;padding:6px 8px;border-bottom:2px solid #999;font-size:11px}
  .meta{color:#555;font-size:11px;margin-bottom:8px}
  .footer{margin-top:24px;font-size:9px;color:#999}
  @media print { @page { size: A4 landscape; margin: 10mm; } }
</style></head>
<body>
  <h1>${activeReport.label}</h1>
  <h2>${activeReport.description}</h2>
  <div class="meta">Period: <b>${dateRange.startDate}</b> to <b>${dateRange.endDate}</b> · Generated ${new Date().toISOString().slice(0,19).replace('T',' ')} · Rows ${rows.length}</div>
  <table>
    <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">Anzen ERP · Tax Compliance · CA-Quality Report</div>
  <script>window.onload=()=>window.print();</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" /> Tax Reports
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 hidden md:inline">
            {dateRange.startDate} → {dateRange.endDate}
          </span>
          <button
            onClick={exportExcel}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={exportPdf}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        <aside className="border rounded overflow-hidden">
          {REPORTS.map(r => (
            <button
              key={r.id}
              onClick={() => setReportId(r.id)}
              className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-gray-50 ${
                reportId === r.id ? 'bg-blue-50 border-l-2 border-blue-500' : 'border-l-2 border-transparent'
              }`}
            >
              <div className="text-sm font-medium">{r.label}</div>
              <div className="text-xs text-gray-500">{r.description}</div>
            </button>
          ))}
        </aside>

        <div>
          <div className="mb-2 text-sm">
            <b>{activeReport.label}</b> — {activeReport.description}
          </div>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500 p-4 border rounded bg-yellow-50">
              No rows in the selected date range.
            </p>
          ) : (
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {columns.map(c => (
                      <th key={c} className="text-left px-2 py-1.5 border-b whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className="border-t">
                      {columns.map(c => {
                        const v = r[c];
                        const isNum = typeof v === 'number';
                        return (
                          <td
                            key={c}
                            className={`px-2 py-1 whitespace-nowrap ${isNum ? 'text-right tabular-nums' : ''}`}
                          >
                            {v === null || v === undefined ? '' : isNum ? Number(v).toLocaleString('id-ID') : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && (
                <p className="text-[10px] text-gray-500 p-2">
                  Showing first 500 rows. Export to Excel for the full dataset ({rows.length} rows).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
