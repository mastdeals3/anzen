import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Package, Box } from 'lucide-react';
import { formatDate } from '../utils/dateFormat';

export interface ImportRequirement {
  id: string;
  product_id: string;
  sales_order_id: string;
  customer_id: string;
  required_quantity: number;
  shortage_quantity: number;
  required_delivery_date: string;
  priority: 'high' | 'medium' | 'low';
  status: ImportStatus;
  lead_time_days: number;
  notes?: string;
  // New columns (migration 20260702150000)
  import_container_id?: string | null;
  ordered_qty?: number;
  allocated_qty?: number;
  received_qty?: number;
  po_reference?: string | null;
  // Joined
  products?: { product_name: string; product_code: string };
  sales_orders?: { so_number: string };
  customers?: { company_name: string };
  import_containers?: { container_ref: string } | null;
}

export type ImportStatus =
  | 'pending'
  | 'rfq_sent'
  | 'po_created'
  | 'supplier_confirmed'
  | 'in_production'
  | 'ready_to_ship'
  | 'in_transit'
  | 'customs_clearance'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

interface ImportRequirementsTableProps {
  requirements: ImportRequirement[];
  onRefresh: () => void;
  canEdit: boolean;
}

export const STATUS_OPTIONS: { value: ImportStatus; label: string; color: string; bgColor: string }[] = [
  { value: 'pending',            label: 'Pending Procurement', color: 'text-gray-700',   bgColor: 'bg-gray-100'   },
  { value: 'rfq_sent',           label: 'RFQ Sent',            color: 'text-blue-700',   bgColor: 'bg-blue-100'   },
  { value: 'po_created',         label: 'PO Created',          color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  { value: 'supplier_confirmed', label: 'Supplier Confirmed',  color: 'text-purple-700', bgColor: 'bg-purple-100' },
  { value: 'in_production',      label: 'In Production',       color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  { value: 'ready_to_ship',      label: 'Ready to Ship',       color: 'text-lime-700',   bgColor: 'bg-lime-100'   },
  { value: 'in_transit',         label: 'In Transit',          color: 'text-orange-700', bgColor: 'bg-orange-100' },
  { value: 'customs_clearance',  label: 'Customs Clearance',   color: 'text-amber-700',  bgColor: 'bg-amber-100'  },
  { value: 'ordered',            label: 'Ordered (Legacy)',     color: 'text-blue-600',   bgColor: 'bg-blue-50'    },
  { value: 'partially_received', label: 'Partially Received',  color: 'text-teal-700',   bgColor: 'bg-teal-100'   },
  { value: 'received',           label: 'Received',             color: 'text-green-700',  bgColor: 'bg-green-100'  },
  { value: 'cancelled',          label: 'Cancelled',            color: 'text-red-700',    bgColor: 'bg-red-100'    },
];

const PRIORITY_OPTIONS = [
  { value: 'high',   label: 'High',   color: 'text-red-700',    bgColor: 'bg-red-100'    },
  { value: 'medium', label: 'Medium', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  { value: 'low',    label: 'Low',    color: 'text-green-700',  bgColor: 'bg-green-100'  },
];

export function ImportRequirementsTable({ requirements, onRefresh, canEdit }: ImportRequirementsTableProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

  const startEditing = (id: string, field: string, currentValue: unknown) => {
    if (!canEdit) return;
    setEditingCell({ id, field });
    setEditValue(String(currentValue ?? ''));
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async (id: string, field: string) => {
    try {
      const numericFields = ['required_quantity', 'shortage_quantity', 'lead_time_days', 'ordered_qty', 'allocated_qty', 'received_qty'];
      const updateData: Record<string, unknown> = {};
      updateData[field] = numericFields.includes(field) ? Number(editValue) : (editValue || null);

      const { error } = await supabase
        .from('import_requirements')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
      onRefresh();
      cancelEditing();
    } catch (error) {
      console.error('Error updating import requirement:', error);
      alert('Failed to update');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, field: string) => {
    if (e.key === 'Enter') saveEdit(id, field);
    else if (e.key === 'Escape') cancelEditing();
  };

  const getStatusStyle = (status: ImportStatus) =>
    STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0];

  const getPriorityStyle = (priority: string) =>
    PRIORITY_OPTIONS.find(o => o.value === priority) ?? PRIORITY_OPTIONS[1];

  const getDaysUntilDelivery = (date: string) => {
    const diff = new Date(date).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getDeliveryColor = (days: number) => {
    if (days < 0) return 'text-red-700 font-bold';
    if (days <= 7) return 'text-red-600 font-semibold';
    if (days <= 30) return 'text-orange-600';
    return 'text-gray-600';
  };

  // Render an editable cell
  const EditableText = ({ id, field, value, type = 'text' }: { id: string; field: string; value: string | number | null | undefined; type?: string }) => {
    const isEditing = editingCell?.id === id && editingCell.field === field;
    if (isEditing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => saveEdit(id, field)}
          onKeyDown={(e) => handleKeyDown(e, id, field)}
          className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      );
    }
    return (
      <div
        onClick={() => startEditing(id, field, value)}
        className={`text-sm ${canEdit ? 'cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded' : ''}`}
      >
        {value != null && value !== '' ? (type === 'number' ? Number(value).toLocaleString() : String(value)) : <span className="text-gray-400">—</span>}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Product</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Sales Order</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Customer</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Required</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Shortage</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Ordered</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Remaining</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Container</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Delivery</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Priority</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Status</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">PO Ref</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Lead</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Notes</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {requirements.map((req) => {
            const daysUntil = getDaysUntilDelivery(req.required_delivery_date);
            const priorityStyle = getPriorityStyle(req.priority);
            const statusStyle = getStatusStyle(req.status);
            const orderedQty = req.ordered_qty ?? 0;
            const remainingQty = Math.max(req.required_quantity - orderedQty, 0);
            const isEditing = (field: string) => editingCell?.id === req.id && editingCell.field === field;

            return (
              <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                {/* Product */}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-gray-900 text-xs leading-tight">{req.products?.product_name}</div>
                      <div className="text-gray-400 text-xs">{req.products?.product_code}</div>
                    </div>
                  </div>
                </td>

                {/* SO */}
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    {req.sales_orders?.so_number}
                  </span>
                </td>

                {/* Customer */}
                <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                  {req.customers?.company_name}
                </td>

                {/* Required Qty */}
                <td className="px-3 py-2 text-right">
                  <EditableText id={req.id} field="required_quantity" value={req.required_quantity} type="number" />
                </td>

                {/* Shortage Qty (read-only) */}
                <td className="px-3 py-2 text-right">
                  <span className="text-red-600 font-semibold text-sm">{req.shortage_quantity.toLocaleString()}</span>
                </td>

                {/* Ordered Qty */}
                <td className="px-3 py-2 text-right">
                  {isEditing('ordered_qty') ? (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      type="number"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'ordered_qty')}
                      onKeyDown={(e) => handleKeyDown(e, req.id, 'ordered_qty')}
                      className="w-24 px-2 py-1 border border-blue-400 rounded text-sm text-right focus:outline-none"
                    />
                  ) : (
                    <div
                      onClick={() => startEditing(req.id, 'ordered_qty', orderedQty)}
                      className={`text-sm font-medium text-indigo-700 text-right ${canEdit ? 'cursor-pointer hover:bg-indigo-50 px-1 py-0.5 rounded' : ''}`}
                    >
                      {orderedQty.toLocaleString()}
                    </div>
                  )}
                </td>

                {/* Remaining Qty (computed, read-only) */}
                <td className="px-3 py-2 text-right">
                  <span className={`text-sm font-semibold ${remainingQty > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {remainingQty.toLocaleString()}
                  </span>
                </td>

                {/* Container */}
                <td className="px-3 py-2">
                  {req.import_containers?.container_ref ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full font-medium">
                      <Box className="w-3 h-3" />
                      {req.import_containers.container_ref}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">—</span>
                  )}
                </td>

                {/* Delivery Date */}
                <td className="px-3 py-2">
                  {isEditing('required_delivery_date') ? (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'required_delivery_date')}
                      onKeyDown={(e) => handleKeyDown(e, req.id, 'required_delivery_date')}
                      className="px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none"
                    />
                  ) : (
                    <div
                      onClick={() => startEditing(req.id, 'required_delivery_date', req.required_delivery_date)}
                      className={`${canEdit ? 'cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded' : ''}`}
                    >
                      <div className="text-xs text-gray-700">{formatDate(req.required_delivery_date)}</div>
                      <div className={`text-xs ${getDeliveryColor(daysUntil)}`}>
                        {daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `${daysUntil}d`}
                      </div>
                    </div>
                  )}
                </td>

                {/* Priority */}
                <td className="px-3 py-2">
                  {isEditing('priority') ? (
                    <select
                      ref={inputRef as React.RefObject<HTMLSelectElement>}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'priority')}
                      className="px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none"
                    >
                      {PRIORITY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      onClick={() => startEditing(req.id, 'priority', req.priority)}
                      className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${priorityStyle.color} ${priorityStyle.bgColor} ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}`}
                    >
                      {priorityStyle.label}
                    </span>
                  )}
                </td>

                {/* Status */}
                <td className="px-3 py-2">
                  {isEditing('status') ? (
                    <select
                      ref={inputRef as React.RefObject<HTMLSelectElement>}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'status')}
                      className="px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none min-w-[160px]"
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      onClick={() => startEditing(req.id, 'status', req.status)}
                      className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap ${statusStyle.color} ${statusStyle.bgColor} ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}`}
                    >
                      {statusStyle.label}
                    </span>
                  )}
                </td>

                {/* PO Reference */}
                <td className="px-3 py-2">
                  <EditableText id={req.id} field="po_reference" value={req.po_reference} />
                </td>

                {/* Lead Time */}
                <td className="px-3 py-2">
                  {isEditing('lead_time_days') ? (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'lead_time_days')}
                      onKeyDown={(e) => handleKeyDown(e, req.id, 'lead_time_days')}
                      className="w-16 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none"
                    />
                  ) : (
                    <div
                      onClick={() => startEditing(req.id, 'lead_time_days', req.lead_time_days)}
                      className={`text-sm ${canEdit ? 'cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded' : ''}`}
                    >
                      {req.lead_time_days}d
                    </div>
                  )}
                </td>

                {/* Notes */}
                <td className="px-3 py-2 max-w-[200px]">
                  {isEditing('notes') ? (
                    <textarea
                      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(req.id, 'notes')}
                      rows={2}
                      className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none"
                    />
                  ) : (
                    <div
                      onClick={() => startEditing(req.id, 'notes', req.notes)}
                      className={`text-xs text-gray-500 truncate ${canEdit ? 'cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded' : ''}`}
                      title={req.notes || 'Click to add notes'}
                    >
                      {req.notes || <span className="text-gray-300">—</span>}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {requirements.length === 0 && (
        <div className="text-center py-10 text-gray-400 text-sm">
          No import requirements found
        </div>
      )}
    </div>
  );
}
