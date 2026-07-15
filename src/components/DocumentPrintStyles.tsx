interface DocumentPrintStylesProps {
  /** id of the print-content root (e.g. "invoice-print-content"). */
  contentId: string;
}

// Single source of truth for print CSS shared by every printable business
// document. Rendered once per document view. Guarantees that View, Print
// Preview, Print and PDF Export produce an identical A4 layout in Chrome,
// Safari and Edge.
//
// What it does during @media print:
//   • Neutralises the on-screen modal shell — the fixed/inset overlay, the
//     min-h-screen flex centering wrapper, scroll containers and any
//     transforms — all of which otherwise corrupt pagination (blank pages,
//     shifted content, clipped edges).
//   • Isolates the print-content subtree via the visibility technique so
//     only the document prints, then re-anchors it at the page origin at a
//     true A4 width.
//   • Prevents page splitting inside header/summary blocks while still
//     allowing long item tables to break across pages with repeated header
//     rows — so a one-page document reliably prints as exactly one page.
export function DocumentPrintStyles({ contentId }: DocumentPrintStylesProps) {
  const css = `
    @media print {
      @page {
        size: A4 portrait;
        margin: 8mm;
      }

      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        height: auto !important;
        overflow: visible !important;
      }

      /* Hide the screen-only chrome (action bar). */
      .doc-print-hide {
        display: none !important;
      }

      /* Neutralise the modal shell so it cannot affect pagination:
         drop fixed positioning, viewport heights, scrolling, flex
         centering and any transforms. These wrappers carry the
         .doc-print-root / .doc-print-scroll / .doc-print-sheet markers. */
      .doc-print-root {
        position: static !important;
        inset: auto !important;
        overflow: visible !important;
        background: #ffffff !important;
      }
      .doc-print-scroll {
        display: block !important;
        min-height: 0 !important;
        height: auto !important;
        padding: 0 !important;
        overflow: visible !important;
        transform: none !important;
      }
      .doc-print-sheet {
        position: static !important;
        max-width: 100% !important;
        width: 100% !important;
        box-shadow: none !important;
        transform: none !important;
      }

      /* Print-content isolation. */
      body * {
        visibility: hidden;
      }
      #${contentId},
      #${contentId} * {
        visibility: visible;
      }
      #${contentId} {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        padding: 0 !important;
        transform: none !important;
      }

      /* Keep structural blocks intact; let long tables paginate cleanly. */
      #${contentId} > div {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      #${contentId} table {
        page-break-inside: auto;
        break-inside: auto;
      }
      #${contentId} tr {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      #${contentId} thead {
        display: table-header-group;
      }
      #${contentId} tfoot {
        display: table-footer-group;
      }
    }
  `;
  return <style>{css}</style>;
}
