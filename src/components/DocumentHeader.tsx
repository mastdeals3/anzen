import { CompanyLogo } from './CompanyLogo';
import { type CompanySnapshot } from '../types/company';

interface DocumentHeaderProps {
  co: CompanySnapshot;
  /** Document title, e.g. "INVOICE", "SURAT JALAN". */
  title: string;
  /** Optional extra classes for the title (used for color accents, e.g. red Credit Note). */
  titleClassName?: string;
}

// Shared boxed header used by every printable business document
// (Invoice, Proforma, Delivery Challan, Purchase Order, Credit Note,
// Material Return, Stock Rejection). Centralises the company logo,
// company identity block, document title and PBF/CDOB licence lines so
// they render identically on screen, print preview, print and PDF export
// across Chrome, Safari and Edge.
//
// Layout contract:
//   • Logo lives in ONE fixed 80×80px container, contained and centered —
//     it never stretches or crops regardless of the source aspect ratio.
//     The size is identical on screen and print so View / Print / PDF
//     match exactly.
//     The logo is centered with position:absolute + inset 0 + margin:auto
//     instead of flexbox, for two reasons that both matter here:
//       1. WebKit sizes a replaced flex item by its intrinsic dimensions
//          before honouring percentage max-width/max-height, and flex
//          items default to min-width:auto (min-content). In Safari's
//          print/rasterisation path a logo wider than 80px therefore kept
//          its intrinsic width; justify-content:center spilled the excess
//          equally to both sides and the left half was clipped by the
//          page edge in Print and PDF Export. Absolute positioning takes
//          the img out of flex layout entirely: min-width:auto no longer
//          applies and the percentages resolve against the 80×80
//          containing block identically in Blink and WebKit.
//       2. html2canvas (PDF export) ignores object-fit and stretches the
//          bitmap into the img's layout box, so the layout box itself must
//          equal the contained size — max-width/max-height with auto
//          width/height guarantees that; width/height:100% + object-fit
//          would distort the exported logo.
//   • The company identity block is a fixed-max-width column that wraps
//     naturally (overflow-wrap) and can shrink (min-w-0) so long addresses
//     never overlap the right-aligned title.
//   • The title is flex-shrink-0 so it always keeps its width.
export function DocumentHeader({ co, title, titleClassName = '' }: DocumentHeaderProps) {
  return (
    <div className="mb-3 border-2 border-black p-3 print:mb-2 print:p-2">
      <div className="mb-2 flex items-start justify-between gap-4">
        {/* Company Logo + Identity */}
        <div className="flex min-w-0 items-start gap-3">
          <div
            style={{
              position: 'relative',
              width: '80px',
              height: '80px',
              flexShrink: 0,
              backgroundColor: '#fff',
            }}
          >
            <CompanyLogo
              logoUrl={co.company_logo_url}
              alt={co.company_name}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                margin: 'auto',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
          <div className="min-w-0" style={{ maxWidth: '340px' }}>
            <h1 className="text-base font-bold print:text-sm" style={{ overflowWrap: 'anywhere' }}>
              {co.company_name}
            </h1>
            {co.company_address && (
              <p className="text-xs print:text-[10px]" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                {co.company_address}
              </p>
            )}
            {co.company_phone && <p className="text-xs print:text-[10px]">Telp: {co.company_phone}</p>}
          </div>
        </div>

        {/* Document Title */}
        <div className="flex-shrink-0 text-right">
          <h2 className={`text-3xl font-bold print:text-2xl ${titleClassName}`}>{title}</h2>
        </div>
      </div>

      {/* Company Licenses */}
      <div className="text-xs space-y-0.5 print:text-[10px] print:space-y-0">
        <div>
          <span className="font-semibold">No izin PBF</span>
          <span className="ml-16">: {co.pbf_license?.replace(/^No izin PBF:\s*/i, '') ?? '—'}</span>
        </div>
        <div>
          <span className="font-semibold">No Sertifikasi CDOB</span>
          <span className="ml-4">: {co.cdob_certificate?.replace(/^No Sertifikasi CDOB:\s*/i, '') ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}
