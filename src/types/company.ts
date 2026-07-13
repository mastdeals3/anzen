export interface CompanySnapshot {
  company_name: string;
  company_legal_name?: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_website?: string | null;
  company_tax_id: string | null;
  company_logo_url: string | null;
  company_stamp_url?: string | null;
  pbf_license: string | null;
  cdob_certificate: string | null;
}

// Used only when company_snapshot is null (pre-backfill rows or dev).
// In production, the DB trigger and backfill guarantee this is never reached.
export const FALLBACK_COMPANY: CompanySnapshot = {
  company_name: 'PT. Avira Parama Pharma',
  company_legal_name: null,
  company_address: 'Komplek Ruko Metro Sunter Blok A1 NO.15, Jl. Metro Indah Raya, Kelurahan Papanggo, Kec. Tanjung Priok, Jakarta Utara - 14340',
  company_phone: '(+62 21) 65832426',
  company_email: 'sales@sapharmajaya.co.id',
  company_website: null,
  company_tax_id: null,
  company_logo_url: null,
  company_stamp_url: null,
  pbf_license: 'No izin PBF: 27092400534390007',
  cdob_certificate: 'No Sertifikasi CDOB: 270924005343900070001',
};
