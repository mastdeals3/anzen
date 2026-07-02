import { useState } from 'react';
import { ChevronDown, ChevronRight, Package, Box } from 'lucide-react';
import { formatDate } from '../utils/dateFormat';
import { type ImportRequirement, STATUS_OPTIONS } from './ImportRequirementsTable';

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

interface ImportRequirementsProductSummaryProps {
  summaryRows: ProductSummaryRow[];
  detailRows: ImportRequirement[];
  loading: boolean;
}

const SUMMARY_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  pending:        { label: 'Pending',        color: 'text-gray-700',   bgColor: 'bg-gray-100'   },
  partial:        { label: 'Partial',         color: 'text-orange-700', bgColor: 'bg-orange-100' },
  fully_ordered:  { label: 'Fully Ordered',   color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  fully_received: { label: 'Fully Received',  color: 'text-green-700',  bgColor: 'bg-green-100'  },
};

const PRIORITY_CONFIG: Record<string, { dot: string }> = {
  high:   { dot: 'bg-red-500'    },
  medium: { dot: 'bg-orange-400' },
  low:    { dot: 'bg-green-500'  },
};

export function ImportRequirementsProductSummary({
  summaryRows,
  detailRows,
  loading,
}: ImportRequirementsProductSummaryProps) {
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

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

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-400 text-sm">Loading product summary…</div>
    );
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
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-8"></th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Product</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">SOs</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Required</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Ordered</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Remaining</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Received</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Earliest Delivery</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Priority</th>
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
                  <td className="px-3 py-3 text-center">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-gray-500 mx-auto" />
                      : <ChevronRight className="w-4 h-4 text-gray-400 mx-auto" />}
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-gray-900">{row.product_name}</div>
                        <div className="text-xs text-gray-400 font-mono">{row.product_code}</div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                      {row.so_count}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="font-semibold text-gray-900">{row.total_required_qty.toLocaleString()}</span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="font-semibold text-indigo-700">{row.total_ordered_qty.toLocaleString()}</span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className={`font-semibold ${row.total_remaining_qty > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {row.total_remaining_qty.toLocaleString()}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="text-green-700">{row.total_received_qty.toLocaleString()}</span>
                  </td>

                  <td className="px-3 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${summaryStatus.color} ${summaryStatus.bgColor}`}>
                      {summaryStatus.label}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-xs text-gray-600">
                    {row.earliest_delivery_date ? formatDate(row.earliest_delivery_date) : '—'}
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityCfg.dot}`}></span>
                      <span className="text-xs text-gray-600 capitalize">{row.highest_priority}</span>
                    </div>
                  </td>
                </tr>

                {/* Expanded child rows */}
                {isExpanded && children.map((child) => {
                  const childStatus = getStatusStyle(child.status);
                  const childOrdered = child.ordered_qty ?? 0;
                  return (
                    <tr key={child.id} className="bg-blue-50/40 border-l-4 border-l-blue-300">
                      <td className="px-3 py-2"></td>

                      <td className="px-3 py-2 pl-8">
                        <div className="text-xs text-gray-500">
                          <span className="font-mono text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded text-xs">
                            {child.sales_orders?.so_number}
                          </span>
                          <span className="ml-2 text-gray-500">{child.customers?.company_name}</span>
                        </div>
                      </td>

                      <td className="px-3 py-2"></td>

                      <td className="px-3 py-2 text-right text-xs text-gray-700">
                        {child.required_quantity.toLocaleString()}
                      </td>

                      <td className="px-3 py-2 text-right text-xs text-indigo-700 font-medium">
                        {childOrdered.toLocaleString()}
                      </td>

                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-medium ${Math.max(child.required_quantity - childOrdered, 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {Math.max(child.required_quantity - childOrdered, 0).toLocaleString()}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-right text-xs text-gray-500">
                        {(child.received_qty ?? 0).toLocaleString()}
                      </td>

                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${childStatus.color} ${childStatus.bgColor}`}>
                          {childStatus.label}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-xs text-gray-600">
                        {formatDate(child.required_delivery_date)}
                      </td>

                      <td className="px-3 py-2">
                        {child.import_containers?.container_ref ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">
                            <Box className="w-3 h-3" />
                            {child.import_containers.container_ref}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
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
