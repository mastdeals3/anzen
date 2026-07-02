import { useState } from 'react';
import { ChevronDown, ChevronRight, Package, ExternalLink } from 'lucide-react';
import { formatDate } from '../utils/dateFormat';
import { type ImportRequirement, STATUS_OPTIONS } from './ImportRequirementsTable';
import { type ImportContainer } from '../pages/ImportRequirements';
import { useNavigation } from '../contexts/NavigationContext';
import { supabase } from '../lib/supabase';
import { SearchableSelect } from './SearchableSelect';
import { showToast } from './ToastNotification';

interface ProductSummaryRow {
  product_id: string;
  product_name: string;
  product_code: string;
  so_count: number;
  total_required_qty: number;
  total_ordered_qty: number;
  total_allocated_qty: number;
  total_received_qty: number;
  total_remaining_qty: number;
  procurement_summary_status: 'pending' | 'partial' | 'fully_ordered' | 'fully_received';
  earliest_delivery_date: string;
  highest_priority: 'high' | 'medium' | 'low';
}

interface Props {
  summaryRows: ProductSummaryRow[];
  detailRows: ImportRequirement[];
  containers: ImportContainer[];
  loading: boolean;
  onRefresh: () => void;
}

const PRIORITY_CONFIG: Record<string, { dot: string; label: string }> = {
  high:   { dot: 'bg-red-500',    label: 'High'   },
  medium: { dot: 'bg-orange-400', label: 'Medium' },
  low:    { dot: 'bg-green-500',  label: 'Low'    },
};

// Returns a simple text badge config for the summary status
const SUMMARY_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  pending:        { label: 'Pending',       color: 'text-gray-600',   bgColor: 'bg-gray-100'   },
  partial:        { label: 'Partial',        color: 'text-orange-700', bgColor: 'bg-orange-100' },
  fully_ordered:  { label: 'Fully Ordered',  color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  fully_received: { label: 'Fully Received', color: 'text-green-700',  bgColor: 'bg-green-100'  },
};

export function ImportRequirementsProductSummary({
  summaryRows,
  detailRows,
  containers,
  loading,
  onRefresh,
}: Props) {
  const { setCurrentPage } = useNavigation();
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const toggleExpand = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const getChildRows = (productId: string) =>
    detailRows.filter(r => r.product_id === productId);

  const getStatusStyle = (status: string) =>
    STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0];

  const getContainerRef = (containerId: string | null | undefined) =>
    containerId ? containers.find(c => c.id === containerId)?.container_ref ?? null : null;

  const containerOptions = [
    { value: '', label: '— No container —' },
    ...containers.map(c => ({ value: c.id, label: c.container_ref })),
  ];

  const saveContainerForRow = async (reqId: string, containerId: string) => {
    setSavingCell(reqId);
    try {
      const { error } = await supabase
        .from('import_requirements')
        .update({ import_container_id: containerId || null })
        .eq('id', reqId);
      if (error) throw error;
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ type: 'error', title: 'Error', message: 'Failed to update container: ' + msg });
    } finally {
      setSavingCell(null);
    }
  };

  const saveOrderedQtyForRow = async (reqId: string, value: string) => {
    const qty = Number(value);
    if (isNaN(qty) || qty < 0) return;
    setSavingCell(reqId + '_qty');
    try {
      const { error } = await supabase
        .from('import_requirements')
        .update({ ordered_qty: qty })
        .eq('id', reqId);
      if (error) throw error;
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast({ type: 'error', title: 'Error', message: 'Failed to update ordered qty: ' + msg });
    } finally {
      setSavingCell(null);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>;
  }

  if (summaryRows.length === 0) {
    return (
      <div className="p-10 text-center text-gray-400 text-sm">
        No active import requirements
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="w-8"></th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Required</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ordered</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Pending</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SOs</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Due</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {summaryRows.map((row) => {
            const isExpanded = expandedProducts.has(row.product_id);
            const children = getChildRows(row.product_id);
            const summaryStatus = SUMMARY_STATUS_CONFIG[row.procurement_summary_status] ?? SUMMARY_STATUS_CONFIG.pending;
            const priorityCfg = PRIORITY_CONFIG[row.highest_priority] ?? PRIORITY_CONFIG.medium;

            return (
              <>
                {/* Summary row */}
                <tr
                  key={row.product_id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(row.product_id)}
                >
                  <td className="pl-3 pr-1 py-3 text-center">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-gray-400 mx-auto" />
                      : <ChevronRight className="w-4 h-4 text-gray-300 mx-auto" />}
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">{row.product_name}</div>
                        <div className="text-xs text-gray-400 font-mono">{row.product_code}</div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="text-sm font-semibold text-gray-800">{row.total_required_qty.toLocaleString()}</span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="text-sm font-semibold text-indigo-700">{row.total_ordered_qty.toLocaleString()}</span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-semibold ${row.total_remaining_qty > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {row.total_remaining_qty.toLocaleString()}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${summaryStatus.color} ${summaryStatus.bgColor}`}>
                      {summaryStatus.label}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">
                      {row.so_count}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityCfg.dot}`}></span>
                      <span className="text-xs text-gray-500">{priorityCfg.label}</span>
                    </div>
                  </td>

                  <td className="px-3 py-3 text-xs text-gray-500">
                    {row.earliest_delivery_date ? formatDate(row.earliest_delivery_date) : '—'}
                  </td>
                </tr>

                {/* Expanded child rows */}
                {isExpanded && children.map((child) => {
                  const childStatus = getStatusStyle(child.status);
                  const childOrdered = child.ordered_qty ?? 0;
                  const childPending = Math.max(child.required_quantity - childOrdered, 0);
                  const containerRef = getContainerRef(child.import_container_id);

                  return (
                    <tr
                      key={child.id}
                      className="bg-blue-50/30 border-l-2 border-l-blue-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* indent */}
                      <td className="pl-3 pr-1 py-2"></td>

                      {/* SO + Customer */}
                      <td className="px-3 py-2 pl-7">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded w-fit">
                            {child.sales_orders?.so_number}
                          </span>
                          <span className="text-xs text-gray-400">{child.customers?.company_name}</span>
                        </div>
                      </td>

                      {/* Required */}
                      <td className="px-3 py-2 text-right text-xs text-gray-600">
                        {child.required_quantity.toLocaleString()}
                      </td>

                      {/* Ordered (editable) */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          defaultValue={childOrdered}
                          onBlur={(e) => {
                            const val = e.target.value;
                            if (Number(val) !== childOrdered) saveOrderedQtyForRow(child.id, val);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          disabled={savingCell === child.id + '_qty'}
                          className="w-20 text-right px-1.5 py-0.5 text-xs border border-gray-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none text-indigo-700 font-medium disabled:opacity-50"
                        />
                      </td>

                      {/* Pending (computed) */}
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-semibold ${childPending > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {childPending.toLocaleString()}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${childStatus.color} ${childStatus.bgColor}`}>
                          {childStatus.label}
                        </span>
                      </td>

                      {/* Container (spans SOs + Priority + Due columns) */}
                      <td className="px-3 py-2" colSpan={3}>
                        <div className="flex items-center gap-2">
                          <div className="w-48" onClick={(e) => e.stopPropagation()}>
                            <SearchableSelect
                              value={child.import_container_id ?? ''}
                              onChange={(val) => saveContainerForRow(child.id, val)}
                              options={containerOptions}
                              placeholder="Assign container…"
                              className="text-xs py-0.5 border-gray-200"
                              disabled={savingCell === child.id}
                            />
                          </div>
                          {containerRef && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setCurrentPage('import-containers'); }}
                              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 hover:underline"
                              title="Open Import Containers"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {containerRef}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
