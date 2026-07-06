import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';

interface Option {
  value: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  /** When provided, shows a "Create X" option when no results match. Called with the current search text. */
  onCreateNew?: (searchText: string) => void;
}

const STRIP_PREFIXES = /^(PT\.?\s*|CV\.?\s*|UD\.?\s*|TBK\.?\s*|LTD\.?\s*|CO\.?\s*)/i;
const STRIP_TOKENS = /\b(pt|cv|ud|tbk|ltd|co)\.?\b/gi;

function normalize(text: string): string {
  return text
    .replace(STRIP_PREFIXES, '')
    .replace(STRIP_TOKENS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  onCreateNew,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(opt => opt.value === value);
  const debouncedFilter = useDebounce(filter, 200);

  const filtered = useMemo(() => {
    if (!debouncedFilter) return options;
    const q = debouncedFilter.toLowerCase().trim();
    const normalizedQ = normalize(debouncedFilter);
    const qTokens = normalizedQ.split(/\s+/).filter(Boolean);
    return options.filter(opt => {
      const raw = opt.label.toLowerCase();
      if (raw.includes(q)) return true;
      const stripped = normalize(opt.label);
      if (stripped.includes(normalizedQ)) return true;
      if (qTokens.length === 0) return false;
      const optTokens = stripped.split(/\s+/).filter(Boolean);
      return qTokens.every(qt => optTokens.some(ot => ot.includes(qt)));
    });
  }, [options, debouncedFilter]);

  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = Math.min(280, window.innerHeight * 0.4);
    const minWidth = Math.max(rect.width, 280);
    // Prevent right-edge overflow: shift left if needed
    const leftPos = Math.min(rect.left, window.innerWidth - minWidth - 8);

    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: leftPos,
        minWidth,
        zIndex: 9999,
      });
    } else {
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: leftPos,
        minWidth,
        zIndex: 9999,
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        !(listRef.current && listRef.current.closest('[data-searchable-dropdown]')?.contains(target))
      ) {
        setIsOpen(false);
        setFilter('');
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      setTimeout(() => inputRef.current?.focus(), 0);
      if (value && !filter) {
        const idx = filtered.findIndex(o => o.value === value);
        if (idx !== -1) {
          setHighlightedIndex(idx);
          scrollToIndex(idx);
        }
      }
    } else {
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filter]);

  const scrollToIndex = (index: number) => {
    if (listRef.current) {
      const el = listRef.current.children[index] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setFilter('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setFilter('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => {
        const next = prev < filtered.length - 1 ? prev + 1 : prev;
        scrollToIndex(next);
        return next;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => {
        const next = prev > 0 ? prev - 1 : 0;
        scrollToIndex(next);
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        handleSelect(filtered[highlightedIndex].value);
      }
    }
  };

  const dropdown = isOpen ? (
    <div
      data-searchable-dropdown="true"
      style={dropdownStyle}
      className="bg-white border border-gray-200 rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="p-2 border-b border-gray-100">
        <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search..."
            className="flex-1 py-1.5 text-sm bg-transparent border-0 outline-none focus:ring-0"
          />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="p-0.5">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto" role="listbox">
        {filtered.length === 0 ? (
          onCreateNew && filter.trim() ? (
            <div
              onMouseDown={(e) => { e.preventDefault(); onCreateNew(filter.trim()); setIsOpen(false); setFilter(''); }}
              className="px-3 py-2.5 cursor-pointer text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-1.5 font-medium"
              role="option"
            >
              <span className="text-base leading-none">+</span>
              Create &ldquo;{filter.trim()}&rdquo;
            </div>
          ) : (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">No results found</div>
          )
        ) : (
          <>
            {(() => {
              const hasGroups = filtered.some(o => o.group);
              if (!hasGroups) {
                return filtered.map((option, index) => (
                  <div
                    key={option.value}
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(option.value); }}
                    className={`px-3 py-2 cursor-pointer text-sm ${
                      index === highlightedIndex
                        ? 'bg-blue-500 text-white'
                        : option.value === value
                        ? 'bg-blue-50 text-blue-900'
                        : 'text-gray-800 hover:bg-gray-50'
                    }`}
                    role="option"
                    aria-selected={option.value === value}
                  >
                    {option.label}
                  </div>
                ));
              }
              let lastGroup = '';
              return filtered.map((option, index) => {
                const showHeader = option.group && option.group !== lastGroup;
                if (showHeader) lastGroup = option.group!;
                return (
                  <div key={option.value}>
                    {showHeader && (
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                        {option.group}
                      </div>
                    )}
                    <div
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(option.value); }}
                      className={`px-3 py-2 cursor-pointer text-sm ${
                        index === highlightedIndex
                          ? 'bg-blue-500 text-white'
                          : option.value === value
                          ? 'bg-blue-50 text-blue-900'
                          : 'text-gray-800 hover:bg-gray-50'
                      }`}
                      role="option"
                      aria-selected={option.value === value}
                    >
                      {option.label}
                    </div>
                  </div>
                );
              });
            })()}
            {onCreateNew && filter.trim() && (
              <div
                onMouseDown={(e) => { e.preventDefault(); onCreateNew(filter.trim()); setIsOpen(false); setFilter(''); }}
                className="px-3 py-2 cursor-pointer text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-1.5 font-medium border-t border-gray-100"
                role="option"
              >
                <span className="text-base leading-none">+</span>
                Create &ldquo;{filter.trim()}&rdquo;
              </div>
            )}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen(prev => !prev);
            if (isOpen) setFilter('');
          }
        }}
        disabled={disabled}
        className={`w-full px-3 border rounded-lg text-left flex items-center justify-between h-[34px] ${
          /\bpy-/.test(className) ? '' : 'py-2'
        } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:border-blue-500'} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={`truncate ${selectedOption ? 'text-gray-900' : 'text-gray-400'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
