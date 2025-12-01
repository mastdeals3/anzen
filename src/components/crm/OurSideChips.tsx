import { CheckCircle2, Clock } from 'lucide-react';

interface OurSideChipsProps {
  inquiry: {
    price_required?: boolean;
    coa_required?: boolean;
    sample_required?: boolean;
    agency_letter_required?: boolean;
    price_sent_at?: string | null;
    coa_sent_at?: string | null;
    sample_sent_at?: string | null;
    agency_letter_sent_at?: string | null;
  };
  compact?: boolean;
}

export function OurSideChips({ inquiry, compact = false }: OurSideChipsProps) {
  const pending: string[] = [];

  if (inquiry.price_required && !inquiry.price_sent_at) pending.push('Price');
  if (inquiry.coa_required && !inquiry.coa_sent_at) pending.push('COA');
  if (inquiry.sample_required && !inquiry.sample_sent_at) pending.push('Sample');
  if (inquiry.agency_letter_required && !inquiry.agency_letter_sent_at) pending.push('Agency');

  // If nothing required at all, show neutral state
  const nothingRequired = !inquiry.price_required && !inquiry.coa_required &&
                          !inquiry.sample_required && !inquiry.agency_letter_required;

  if (nothingRequired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-500">
        <Minus className="w-3 h-3" />
        {!compact && 'Nothing required'}
      </span>
    );
  }

  // All requirements fulfilled
  if (pending.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-50 text-green-700 font-medium">
        <CheckCircle2 className="w-3 h-3" />
        {!compact && 'All done'}
      </span>
    );
  }

  // Has pending items
  return (
    <div className="flex flex-wrap gap-1">
      {pending.map(item => (
        <span
          key={item}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200"
          title={`${item} not sent yet`}
        >
          <Clock className="w-3 h-3" />
          {item}
        </span>
      ))}
    </div>
  );
}

function Minus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
