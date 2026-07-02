/**
 * taxCalculations.ts
 * Shared utilities for the Finance / Expense module.
 *
 * Key design constraints:
 *   - Document Type is a UI-only grouping concept (no DB column).
 *   - PPN Import and PPh Import ONLY appear inside the PIB workflow.
 *     They must NEVER be shown as standalone expense categories.
 *   - PIB (pib_import) is completely separate from the Import/Customs Broker invoice.
 *   - All amounts in IDR; no currency conversion here.
 */

// ---------------------------------------------------------------------------
// Document Type definitions
// ---------------------------------------------------------------------------

/** All document types visible in the Expense form. */
export const DOCUMENT_TYPES = [
  'Operating Expense',
  'Utility',
  'Staff Expense',
  'Sales & Distribution',
  'Professional Services',
  'Import / Customs Broker Invoice',
  'Fixed Asset',
  'PIB',
] as const;

export type DocumentType = typeof DOCUMENT_TYPES[number];

// ---------------------------------------------------------------------------
// Document Type → expense_category mapping
// ---------------------------------------------------------------------------
// These are the expense_category values that appear under each Document Type.
// PPN Import (ppn_import) and PPh Import (pph_import) are intentionally
// omitted — they belong exclusively inside the PIB workflow.

export const DOCUMENT_TYPE_GROUPS: Record<DocumentType, string[]> = {
  'Operating Expense':                ['warehouse_rent', 'bank_charges', 'office_admin', 'office_shifting_renovation', 'other'],
  'Utility':                          ['utilities'],
  'Staff Expense':                    ['salary', 'staff_overtime', 'staff_welfare', 'travel_conveyance'],
  'Sales & Distribution':             ['delivery_sales', 'loading_sales', 'other_sales'],
  'Professional Services':            ['professional_services'],
  'Import / Customs Broker Invoice':  ['import_broker'],
  'Fixed Asset':                      ['fixed_asset'],
  'PIB':                              ['pib_import'],
};

/** Returns the Document Type that owns a given expense_category. */
export function getDocTypeForCategory(category: string): DocumentType | null {
  for (const [docType, cats] of Object.entries(DOCUMENT_TYPE_GROUPS) as [DocumentType, string[]][]) {
    if (cats.includes(category)) return docType;
  }
  return null;
}

/** Auto-selects category when a Document Type has exactly one. */
export function getSingleCategoryForDocType(docType: DocumentType): string | null {
  const cats = DOCUMENT_TYPE_GROUPS[docType];
  return cats.length === 1 ? cats[0] : null;
}

// ---------------------------------------------------------------------------
// Tax field visibility per Document Type
// ---------------------------------------------------------------------------

export interface TaxFieldConfig {
  /** Show PPN Input field */
  ppn: boolean;
  /** Show PPh 23 fields */
  pph23: boolean;
  /** Show PPh 21 fields */
  pph21: boolean;
  /** Show Bea Meterai (Stamp Duty) field */
  stamp: boolean;
  /** Show PIB breakdown fields (BM, PPN Import, PPh 22) */
  pib: boolean;
  /** Show broker item sub-cost breakdown */
  brokerItems: boolean;
}

export const DOCUMENT_TYPE_TAX_CONFIG: Record<DocumentType, TaxFieldConfig> = {
  'Operating Expense':               { ppn: true,  pph23: false, pph21: false, stamp: true,  pib: false, brokerItems: false },
  'Utility':                         { ppn: true,  pph23: false, pph21: false, stamp: false, pib: false, brokerItems: false },
  'Staff Expense':                   { ppn: false, pph23: false, pph21: true,  stamp: false, pib: false, brokerItems: false },
  'Sales & Distribution':            { ppn: false, pph23: false, pph21: false, stamp: false, pib: false, brokerItems: false },
  'Professional Services':           { ppn: true,  pph23: true,  pph21: false, stamp: true,  pib: false, brokerItems: false },
  'Import / Customs Broker Invoice': { ppn: true,  pph23: true,  pph21: false, stamp: true,  pib: false, brokerItems: true  },
  'Fixed Asset':                     { ppn: true,  pph23: false, pph21: false, stamp: false, pib: false, brokerItems: false },
  'PIB':                             { ppn: false, pph23: false, pph21: false, stamp: false, pib: true,  brokerItems: false },
};

// ---------------------------------------------------------------------------
// Broker item types (for Import / Customs Broker Invoice breakdown)
// ---------------------------------------------------------------------------

export const BROKER_ITEM_TYPES = [
  { value: 'do_charges',         label: 'D/O Charges' },
  { value: 'port_charges',       label: 'Port Charges' },
  { value: 'clearing_forwarding',label: 'Clearing & Forwarding' },
  { value: 'handling',           label: 'Handling' },
  { value: 'truck',              label: 'Trucking' },
  { value: 'freight',            label: 'Freight' },
  { value: 'administration',     label: 'Administration' },
  { value: 'other',              label: 'Other' },
] as const;

export type BrokerItemType = typeof BROKER_ITEM_TYPES[number]['value'];

export interface BrokerItem {
  type: BrokerItemType;
  description: string;
  amount: number;
}

/** Returns the sum of all broker item amounts. */
export function sumBrokerItems(items: BrokerItem[]): number {
  return items.reduce((sum, item) => sum + (item.amount || 0), 0);
}

// ---------------------------------------------------------------------------
// Tax calculations
// ---------------------------------------------------------------------------

/** Indonesian PPN (VAT) — 11% on DPP (taxable base). Returns 0 if not PKP. */
export function calculatePPN(
  dppAmount: number,
  isSupplierPKP: boolean,
  rate = 11,
): number {
  if (!isSupplierPKP || dppAmount <= 0) return 0;
  // Round to nearest rupiah
  return Math.round(dppAmount * rate / 100);
}

/**
 * PPh amount calculation.
 * rate is the withholding rate as a percentage (e.g. 2 for PPh 23 at 2%).
 * DPP for PPh 23 = gross expense (before PPN) = `amount`.
 */
export function calculatePPh(
  dppAmount: number,
  ratePercent: number,
): number {
  if (dppAmount <= 0 || ratePercent <= 0) return 0;
  return Math.round(dppAmount * ratePercent / 100);
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Computes a due date given an invoice/expense date and payment terms in days.
 * Returns ISO date string (YYYY-MM-DD) or '' if inputs are invalid.
 */
export function getDueDateFromTerms(
  invoiceDate: string,
  paymentTermsDays: number | null | undefined,
): string {
  if (!invoiceDate || !paymentTermsDays || paymentTermsDays <= 0) return '';
  const d = new Date(invoiceDate);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + paymentTermsDays);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Formats an IDR amount as a human-readable string, e.g. "Rp 1.500.000". */
export function formatIDR(amount: number | null | undefined): string {
  if (amount == null) return 'Rp 0';
  return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
}

/** Returns a human-readable label for an expense_category slug. */
export function categoryLabel(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Category → label map (for display in dropdowns)
// ---------------------------------------------------------------------------
export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  duty_customs:               'Import Duty / Bea Masuk',
  ppn_import:                 'PPN Import (PIB only)',
  pph_import:                 'PPh 22 Import (PIB only)',
  freight_import:             'Freight Import',
  clearing_forwarding:        'Clearing & Forwarding',
  port_charges:               'Port Charges',
  container_handling:         'Container Handling',
  transport_import:           'Transport Import',
  loading_import:             'Loading Import',
  bpom_ski_fees:              'BPOM / SKI Fees',
  other_import:               'Other Import Cost',
  pib_import:                 'PIB (Import Declaration)',
  import_broker:              'Customs Broker Invoice',
  delivery_sales:             'Delivery / Sales Dist.',
  loading_sales:              'Loading (Sales)',
  other_sales:                'Other Sales Cost',
  salary:                     'Salary / Gaji',
  staff_overtime:             'Staff Overtime',
  staff_welfare:              'Staff Welfare / Kesejahteraan',
  travel_conveyance:          'Travel & Conveyance',
  warehouse_rent:             'Warehouse Rent / Sewa Gudang',
  utilities:                  'Utilities (Listrik, Air, dll)',
  bank_charges:               'Bank Charges',
  office_admin:               'Office Administration',
  office_shifting_renovation: 'Office Shifting / Renovation',
  duty:                       'Duty / Bea',
  freight:                    'Freight',
  office:                     'Office Expense',
  other:                      'Other / Lainnya',
  fixed_asset:                'Fixed Asset Purchase',
  professional_services:      'Professional Services / Jasa Profesi',
};
