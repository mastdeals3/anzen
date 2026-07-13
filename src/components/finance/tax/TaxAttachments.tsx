import { useState, useEffect } from 'react';
import { Upload, Trash2, FileText, ExternalLink } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

type AttachmentTable = 'tax_payment_files' | 'faktur_pajak_files';

interface Attachment {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  kind: string | null;
  uploaded_at: string;
}

interface Props {
  /** Which file table to write to. */
  table: AttachmentTable;
  /** Foreign-key column value: tax_payments.id or faktur_pajak.id. */
  parentId: string;
  /** Storage folder prefix inside the `documents` bucket. */
  storagePrefix: string;
  /** Attachment kinds allowed for this parent. */
  allowedKinds: readonly { value: string; label: string }[];
  disabled?: boolean;
}

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
];

export function TaxAttachments({ table, parentId, storagePrefix, allowedKinds, disabled }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<string>(allowedKinds[0]?.value ?? 'other');
  const parentColumn = table === 'tax_payment_files' ? 'tax_payment_id' : 'faktur_pajak_id';

  useEffect(() => {
    if (!parentId) return;
    void refresh();
  }, [parentId, table]);

  async function refresh() {
    const { data, error } = await supabase
      .from(table)
      .select('id, file_url, file_name, file_type, file_size, kind, uploaded_at')
      .eq(parentColumn, parentId)
      .order('uploaded_at', { ascending: false });
    if (!error && data) setItems(data as Attachment[]);
  }

  async function handleFile(file: File) {
    if (!ALLOWED_MIME.includes(file.type)) {
      alert('Only PDF / JPEG / PNG / WEBP are allowed.');
      return;
    }
    if (file.size > MAX_SIZE) {
      alert('Max file size is 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const path = `${storagePrefix}/${parentId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from(table).insert({
        [parentColumn]: parentId,
        file_url: path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        kind,
      });
      if (insErr) throw insErr;
      await refresh();
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function preview(a: Attachment) {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(a.file_url, 60 * 5);
    if (error || !data?.signedUrl) {
      alert('Cannot open file: ' + (error?.message ?? 'unknown'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function remove(a: Attachment) {
    if (!confirm(`Delete ${a.file_name}?`)) return;
    await supabase.storage.from('documents').remove([a.file_url]);
    await supabase.from(table).delete().eq('id', a.id);
    await refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-white"
          disabled={disabled || uploading}
        >
          {allowedKinds.map(k => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700 disabled:opacity-50">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading…' : 'Attach'}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={disabled || uploading}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">No attachments yet.</p>
      ) : (
        <ul className="divide-y border rounded">
          {items.map(a => (
            <li key={a.id} className="flex items-center gap-2 px-2 py-1 text-sm">
              <FileText className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="flex-1 truncate">{a.file_name}</span>
              <span className="text-xs text-gray-500 shrink-0">{a.kind}</span>
              <button
                onClick={() => void preview(a)}
                className="p-1 hover:bg-gray-100 rounded"
                title="Preview"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              {!disabled && (
                <button
                  onClick={() => void remove(a)}
                  className="p-1 hover:bg-red-50 text-red-600 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
