/**
 * The printable invoice model is deliberately hydrated with explicit queries.
 *
 * PostgREST embedded relations are convenient for lists, but an invoice is a
 * legal document: its product and batch data must not disappear because an
 * embedded relation is unavailable or changes shape.  Keep the invoice-item
 * record authoritative, then attach the display-only records by their IDs.
 */
export interface InvoiceDisplayItem {
  id: string;
  product_id: string;
  batch_id: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total?: number;
  delivery_challan_item_id: string | null;
  challan_id: string | null;
  dc_number?: string;
  products?: { product_name: string; product_code: string; unit: string };
  batches?: { batch_number: string; expiry_date: string | null } | null;
}

type QueryClient = {
  from: (table: string) => any;
};

export async function loadInvoiceDisplayItems(
  client: QueryClient,
  invoiceId: string,
): Promise<InvoiceDisplayItem[]> {
  const { data: invoiceItems, error: invoiceItemsError } = await client
    .from('sales_invoice_items')
    .select('id, invoice_id, product_id, batch_id, quantity, unit_price, tax_rate, delivery_challan_item_id')
    .eq('invoice_id', invoiceId);

  if (invoiceItemsError) throw invoiceItemsError;
  if (!invoiceItems?.length) return [];

  const productIds = [...new Set(invoiceItems.map((item: any) => item.product_id).filter(Boolean))];
  const batchIds = [...new Set(invoiceItems.map((item: any) => item.batch_id).filter(Boolean))];
  const dcItemIds = [...new Set(invoiceItems.map((item: any) => item.delivery_challan_item_id).filter(Boolean))];

  const [productsResult, batchesResult, dcItemsResult] = await Promise.all([
    productIds.length
      ? client.from('products').select('id, product_name, product_code, unit').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    batchIds.length
      ? client.from('batches').select('id, batch_number, expiry_date').in('id', batchIds)
      : Promise.resolve({ data: [], error: null }),
    dcItemIds.length
      ? client.from('delivery_challan_items').select('id, challan_id').in('id', dcItemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  if (dcItemsResult.error) throw dcItemsResult.error;

  const challanIds = [...new Set((dcItemsResult.data || []).map((item: any) => item.challan_id).filter(Boolean))];
  const challansResult = challanIds.length
    ? await client.from('delivery_challans').select('id, challan_number').in('id', challanIds)
    : { data: [], error: null };
  if (challansResult.error) throw challansResult.error;

  const productsById = new Map((productsResult.data || []).map((product: any) => [product.id, product]));
  const batchesById = new Map((batchesResult.data || []).map((batch: any) => [batch.id, batch]));
  const dcItemsById = new Map((dcItemsResult.data || []).map((item: any) => [item.id, item]));
  const challansById = new Map((challansResult.data || []).map((challan: any) => [challan.id, challan]));

  return invoiceItems.map((item: any) => {
    const dcItem = item.delivery_challan_item_id ? dcItemsById.get(item.delivery_challan_item_id) : undefined;
    const challan = dcItem?.challan_id ? challansById.get(dcItem.challan_id) : undefined;
    return {
      ...item,
      delivery_challan_item_id: item.delivery_challan_item_id ?? null,
      challan_id: dcItem?.challan_id ?? null,
      dc_number: challan?.challan_number,
      products: productsById.get(item.product_id),
      batches: item.batch_id ? batchesById.get(item.batch_id) ?? null : null,
    };
  });
}
