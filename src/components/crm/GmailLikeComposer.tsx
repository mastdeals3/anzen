import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, Paperclip, X, ChevronDown, Loader, Minimize2, Maximize2, AlertCircle, FileText, Check } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { openGmailReconnectPopup } from './gmailReconnect';
import { applyEmailTemplateVariables, getDisplayContactName, getSalutation } from '../../utils/crmEmailPersonalization';
import { buildNormalizedBaseKey, buildUniqueDocumentNames } from '../../utils/documentNaming';

interface Inquiry {
  id: string;
  inquiry_number: string;
  company_name: string;
  contact_person: string | null;
  contact_email: string | null;
  product_name: string;
  specification?: string | null;
  quantity: string;
  supplier_name?: string | null;
  supplier_country?: string | null;
  email_subject?: string | null;
  mail_subject?: string | null;
  offered_price?: number | null;
  offered_price_currency?: string;
  purchase_price?: number | null;
  purchase_price_currency?: string;
  remarks?: string | null;
}

interface EmailTemplate {
  id: string;
  template_name: string;
  subject: string;
  body: string;
  category: string;
  variables: string[];
}

interface CrmDoc {
  id: string;
  inquiry_id: string | null;
  product_name: string | null;
  make: string | null;
  document_type: string;
  display_file_name: string | null;
  original_file_name: string | null;
  storage_path: string;
  created_at: string;
}

interface GmailLikeComposerProps {
  isOpen: boolean;
  onClose: () => void;
  inquiry: Inquiry;
  inquiries?: Inquiry[]; // multiple for multi-product email
  mode?: 'price' | 'coa' | 'general';
  replyTo?: {
    email_id: string;
    subject: string;
    from_email: string;
    body: string;
  };
}

interface AttachedFile {
  file: File;
  name: string;
  size: number;
}

interface CrmDocAttachment {
  doc: CrmDoc;
  signedUrl?: string;
  loading?: boolean;
}

function inferDocumentType(fileName: string, mode: 'price' | 'coa' | 'general'): 'COA' | 'MSDS' | 'MHD' | 'TDS' | 'SPEC' | 'OTHER' {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('coa')) return 'COA';
  if (normalized.includes('msds') || normalized.includes('sds')) return 'MSDS';
  if (normalized.includes('mhd') || normalized.includes('expiry')) return 'MHD';
  if (normalized.includes('tds')) return 'TDS';
  if (normalized.includes('spec')) return 'SPEC';
  if (mode === 'coa') return 'COA';
  return 'OTHER';
}

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};

const quillFormats = ['bold', 'italic', 'underline', 'list', 'bullet', 'link'];

function buildSubject(inquiry: Inquiry, _mode: 'price' | 'coa' | 'general', replyTo?: GmailLikeComposerProps['replyTo']): string {
  if (replyTo?.subject) {
    return replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`;
  }
  const baseSubject = inquiry.mail_subject || inquiry.email_subject || `${inquiry.product_name} - ${inquiry.inquiry_number}`;
  return `Re: ${baseSubject}`;
}

// Build a professional HTML table for multi-product price quotation
function buildPriceTable(items: Inquiry[]): string {
  const rows = items.map(inq => {
    const cur = inq.offered_price_currency || 'USD';
    const price = inq.offered_price && inq.offered_price > 0
      ? `<strong>${cur} ${inq.offered_price.toLocaleString()} / kg</strong>`
      : '<em>To be confirmed</em>';
    const spec = inq.specification?.trim() || '';
    const supplier = inq.supplier_name?.trim() || '';
    const remarks = inq.remarks?.trim() || '';

    return `<tr>
      <td style="padding:8px 12px;border:1px solid #d1d5db;font-weight:600">${inq.product_name}</td>
      ${spec ? `<td style="padding:8px 12px;border:1px solid #d1d5db;color:#374151">${spec}</td>` : ''}
      ${supplier ? `<td style="padding:8px 12px;border:1px solid #d1d5db;color:#374151">${supplier}</td>` : ''}
      <td style="padding:8px 12px;border:1px solid #d1d5db">${price}</td>
      ${remarks ? `<td style="padding:8px 12px;border:1px solid #d1d5db;color:#374151">${remarks}</td>` : ''}
    </tr>`;
  }).join('');

  // Determine which columns to show based on data presence
  const hasSpec = items.some(i => i.specification?.trim());
  const hasSupplier = items.some(i => i.supplier_name?.trim());
  const hasRemarks = items.some(i => i.remarks?.trim());

  const headers = [
    '<th style="padding:8px 12px;border:1px solid #d1d5db;background:#f9fafb;text-align:left">Product</th>',
    hasSpec ? '<th style="padding:8px 12px;border:1px solid #d1d5db;background:#f9fafb;text-align:left">Specification</th>' : '',
    hasSupplier ? '<th style="padding:8px 12px;border:1px solid #d1d5db;background:#f9fafb;text-align:left">Make / Origin</th>' : '',
    '<th style="padding:8px 12px;border:1px solid #d1d5db;background:#f9fafb;text-align:left">Offered Price</th>',
    hasRemarks ? '<th style="padding:8px 12px;border:1px solid #d1d5db;background:#f9fafb;text-align:left">Remarks</th>' : '',
  ].join('');

  return `<table style="border-collapse:collapse;width:100%;font-size:14px;font-family:sans-serif">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function GmailLikeComposer({ isOpen, onClose, inquiry, inquiries, mode = 'general', replyTo }: GmailLikeComposerProps) {
  // All inquiries to include (multi-product support)
  const allInquiries = inquiries && inquiries.length > 0 ? inquiries : [inquiry];

  const [toEmail, setToEmail] = useState(inquiry.contact_email || '');
  const [ccEmail, setCcEmail] = useState('');
  const [bccEmail, setBccEmail] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentUserName, setCurrentUserName] = useState('');
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  // CRM docs panel
  const [crmDocs, setCrmDocs] = useState<CrmDoc[]>([]);
  const [crmDocsLoading, setCrmDocsLoading] = useState(false);
  const [selectedCrmDocs, setSelectedCrmDocs] = useState<Set<string>>(new Set());
  const [showDocPanel, setShowDocPanel] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadTemplates();
    loadUserInfo();
    setSubject(buildSubject(inquiry, mode, replyTo));
    setSelectedCrmDocs(new Set());
    setAttachments([]);

    if (replyTo) {
      const quotedBody = `<br><br><div style="border-left:3px solid #e2e8f0;padding-left:12px;margin-left:8px;color:#64748b"><p><strong>${replyTo.from_email} wrote:</strong></p>${replyTo.body}</div>`;
      setBody(quotedBody);
    } else {
      generateBody(mode);
    }

    // Load CRM docs for all inquiry IDs
    loadCrmDocs();
  }, [isOpen, inquiry.id, mode]);

  const loadUserInfo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [profileRes, gmailRes] = await Promise.all([
        supabase.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle(),
        supabase.from('gmail_connections').select('id').eq('user_id', user.id).eq('is_connected', true).maybeSingle(),
      ]);
      setCurrentUserName(profileRes.data?.full_name || '');
      setGmailConnected(!!gmailRes.data);
    } catch (err) {
      console.error('Error loading user info:', err);
    }
  };

  const loadCrmDocs = async () => {
    const ids = allInquiries.map(i => i.id);
    setCrmDocsLoading(true);
    const { data } = await supabase
      .from('crm_product_documents')
      .select('id,inquiry_id,product_name,make,document_type,display_file_name,original_file_name,storage_path,created_at')
      .in('inquiry_id', ids)
      .order('created_at', { ascending: false });
    setCrmDocs((data || []) as unknown as CrmDoc[]);
    setCrmDocsLoading(false);
  };

  const loadTemplates = async () => {
    try {
      const { data } = await supabase.from('crm_email_templates').select('*').eq('is_active', true).order('template_name');
      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
    }
  };

  const generateBody = (emailMode: 'price' | 'coa' | 'general') => {
    const salutation = `<p>${getSalutation(inquiry.contact_person)}</p>`;
    const closing = `<p>Please note that prices are subject to change based on availability and market conditions.</p><p>Should you have any questions, please feel free to contact us.</p><p>Best regards,<br><strong>SA Pharma Jaya</strong></p>`;

    if (emailMode === 'price') {
      let html = salutation;
      if (allInquiries.length > 1) {
        html += `<p>Thank you for your inquiry. Please find our price quotation below:</p>`;
        html += buildPriceTable(allInquiries);
      } else {
        const inq = allInquiries[0];
        const cur = inq.offered_price_currency || 'USD';
        html += `<p>Thank you for your inquiry. Please find our price quotation below:</p>`;
        html += buildPriceTable([inq]);
      }
      html += closing;
      setBody(html);
    } else if (emailMode === 'coa') {
      let html = salutation;
      const productList = allInquiries.map(i => `<strong>${i.product_name}</strong>`).join(', ');
      html += `<p>Further to your inquiry for ${productList}, please find attached the requested documents (COA / MSDS).</p>`;
      html += `<p>Kindly review the documents and let us know if you require any further information or alternative grades.</p>`;
      html += `<p>Best regards,<br><strong>SA Pharma Jaya</strong></p>`;
      setBody(html);
    } else {
      let html = salutation;
      html += `<p>Thank you for your inquiry regarding <strong>${inquiry.product_name}</strong>.</p>`;
      if (inquiry.specification) html += `<p><strong>Specification:</strong> ${inquiry.specification}</p>`;
      html += `<p><strong>Quantity:</strong> ${inquiry.quantity}</p>`;
      html += `<p>Please find the attached documents for your reference.</p>`;
      html += `<p>Best regards,<br><strong>SA Pharma Jaya</strong></p>`;
      setBody(html);
    }
  };

  const applyTemplate = (template: EmailTemplate) => {
    const offeredPriceText = inquiry.offered_price
      ? `${inquiry.offered_price_currency || 'USD'} ${inquiry.offered_price.toLocaleString()}`
      : 'To be confirmed';
    setSubject(applyEmailTemplateVariables(template.subject, {
      ...inquiry, contact_person: getDisplayContactName(inquiry.contact_person),
      user_name: currentUserName, offered_price: offeredPriceText,
    }));
    setBody(applyEmailTemplateVariables(template.body, {
      ...inquiry, contact_person: getDisplayContactName(inquiry.contact_person),
      user_name: currentUserName, offered_price: offeredPriceText,
    }));
    setShowTemplates(false);
    supabase.from('crm_email_templates')
      .update({ use_count: (template as any).use_count + 1, last_used: new Date().toISOString() })
      .eq('id', template.id).then(() => {});
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > 25 * 1024 * 1024) { alert(`${f.name} exceeds 25MB limit.`); continue; }
      newFiles.push({ file: f, name: f.name, size: f.size });
    }
    setAttachments(prev => [...prev, ...newFiles]);
  };

  const toggleCrmDoc = (docId: string) => {
    setSelectedCrmDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const formatSize = (b: number) => {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const DOC_TYPE_COLOR: Record<string, string> = {
    COA: 'bg-green-100 text-green-700',
    MSDS: 'bg-red-100 text-red-700',
    TDS: 'bg-blue-100 text-blue-700',
    SPEC: 'bg-amber-100 text-amber-700',
  };

  const sendEmail = async () => {
    if (!toEmail.trim() || !subject.trim() || !body.trim()) {
      alert('Please fill in To, Subject, and Body.');
      return;
    }
    if (!gmailConnected) {
      alert('Gmail is not connected. Please connect your Gmail account in Settings > Gmail Settings.');
      return;
    }

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Upload new file attachments
      const uploadedFiles: { storagePath: string; fileName: string }[] = [];
      const attachmentFolder = `email-attachments/${user.id}`;
      const { data: existingObjects } = await supabase.storage.from('crm-documents').list(attachmentFolder, { limit: 1000 });
      const existingStoragePaths = (existingObjects || []).map(obj => `${attachmentFolder}/${obj.name}`);
      const normalizedDocType = mode === 'coa' ? 'coa' : mode === 'price' ? 'quotation' : 'attachment';
      const normalizedBaseKey = buildNormalizedBaseKey(inquiry.product_name || 'product', inquiry.supplier_name || inquiry.company_name || 'supplier', normalizedDocType);

      for (const att of attachments) {
        const fileNaming = buildUniqueDocumentNames({
          product: inquiry.product_name || 'product',
          supplier: inquiry.supplier_name || inquiry.company_name || 'supplier',
          docType: normalizedDocType,
          originalFilename: att.name,
          existingStoragePaths: existingStoragePaths.filter(p => p.split('/').pop()?.startsWith(normalizedBaseKey)),
        });
        const filePath = `${attachmentFolder}/${fileNaming.fileName}`;
        const { error: upErr } = await supabase.storage.from('crm-documents').upload(filePath, att.file);
        if (!upErr) {
          uploadedFiles.push({ storagePath: filePath, fileName: fileNaming.fileName });
          existingStoragePaths.push(filePath);
        }
      }

      // 2. Get signed URLs for selected CRM docs so they can be sent via email
      const selectedDocList = crmDocs.filter(d => selectedCrmDocs.has(d.id));
      const crmDocAttachmentUrls: string[] = [];
      for (const doc of selectedDocList) {
        const { data: signed } = await supabase.storage.from('crm-documents').createSignedUrl(doc.storage_path, 3600);
        if (signed?.signedUrl) crmDocAttachmentUrls.push(signed.signedUrl);
      }

      const toList = [toEmail.trim(), ...(ccEmail ? ccEmail.split(',').map(e => e.trim()).filter(Boolean) : [])];

      // 3. Send via Gmail
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('send-bulk-email', {
        body: {
          userId: user.id,
          toEmails: toList,
          subject,
          body,
          isHtml: true,
          senderName: currentUserName,
          workflowType: 'crm_bulk_email',
          attachmentUrls: crmDocAttachmentUrls, // pre-signed URLs for CRM docs
        },
      });

      if (fnErr || !fnData?.success) {
        const composedError = fnData?.code
          ? `${fnData.code}: ${fnData?.error || fnErr?.message || 'Failed to send email'}`
          : (fnData?.error || fnErr?.message || 'Failed to send email');
        throw new Error(composedError);
      }

      // 4. Log to crm_email_activities (once per inquiry)
      const allAttachmentPaths = [
        ...uploadedFiles.map(f => f.storagePath),
        ...selectedDocList.map(d => d.storage_path),
      ];

      for (const inq of allInquiries) {
        const { data: activityData, error: activityError } = await supabase.from('crm_email_activities').insert([{
          inquiry_id: inq.id,
          email_type: 'sent',
          from_email: user.email,
          to_email: toList,
          cc_email: ccEmail ? ccEmail.split(',').map(e => e.trim()).filter(Boolean) : null,
          bcc_email: bccEmail ? bccEmail.split(',').map(e => e.trim()).filter(Boolean) : null,
          subject,
          body,
          attachment_urls: allAttachmentPaths.length > 0 ? allAttachmentPaths : null,
          sent_date: new Date().toISOString(),
          created_by: user.id,
        }]).select('id').single();

        if (activityError) throw activityError;

        // 5. Record newly uploaded files in crm_product_documents
        if (uploadedFiles.length > 0 && activityData) {
          const rows = uploadedFiles.map(({ storagePath, fileName }) => {
            const docType = inferDocumentType(fileName, mode);
            return {
              inquiry_id: inq.id,
              email_activity_id: activityData.id,
              product_name: inq.product_name,
              make: inq.supplier_name || null,
              document_type: docType,
              original_file_name: fileName,
              display_file_name: fileName,
              storage_bucket: 'crm-documents',
              storage_path: storagePath,
              uploaded_by: user.id,
            };
          });
          await supabase.from('crm_product_documents').insert(rows);
        }
      }

      // 6. Auto-update inquiry status
      for (const inq of allInquiries) {
        const updateData: Record<string, unknown> = {};
        if (mode === 'price') {
          updateData.price_quoted = true;
          updateData.price_quoted_date = new Date().toISOString().split('T')[0];
          updateData.status = 'price_quoted';
        } else if (mode === 'coa') {
          updateData.coa_sent = true;
          updateData.coa_sent_date = new Date().toISOString().split('T')[0];
        }
        if (Object.keys(updateData).length > 0) {
          await supabase.from('crm_inquiries').update(updateData).eq('id', inq.id);
        }
      }

      onClose();
    } catch (err: any) {
      console.error('Email send error:', err);
      const errorMessage = err.message || 'Failed to send email. Please try again.';
      const needsReauth = errorMessage.includes('TOKEN_REAUTH_REQUIRED') || errorMessage.includes('Failed to refresh access token');
      if (needsReauth) {
        if (window.confirm('Your Gmail connection has expired. Reconnect Gmail now?')) openGmailReconnectPopup();
      } else {
        alert(errorMessage);
      }
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const isMulti = allInquiries.length > 1;
  const modeLabel = mode === 'price' ? 'Send Price Quotation' : mode === 'coa' ? 'Send COA / MSDS' : 'New Message';

  const windowCls = fullscreen
    ? 'fixed inset-4 z-50 flex flex-col bg-white rounded-xl shadow-2xl border border-gray-200'
    : 'fixed bottom-0 right-6 z-50 flex flex-col bg-white rounded-t-xl shadow-2xl border border-gray-200 w-[620px]';

  const totalAttachCount = attachments.length + selectedCrmDocs.size;

  return (
    <>
      {fullscreen && <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />}

      <div className={windowCls} style={!fullscreen ? { maxHeight: minimized ? 'auto' : '90vh' } : {}}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-gray-800 rounded-t-xl cursor-pointer select-none"
          onClick={() => !fullscreen && setMinimized(m => !m)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-white truncate">
              {minimized ? (subject || modeLabel) : modeLabel}
            </span>
            {!minimized && (
              <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-600 text-gray-200">
                {isMulti ? `${allInquiries.length} products` : inquiry.company_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            {templates.length > 0 && !minimized && (
              <button onClick={() => setShowTemplates(s => !s)}
                className="p-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition" title="Templates">
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => { setMinimized(m => !m); setFullscreen(false); }}
              className="p-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
              title={minimized ? 'Expand' : 'Minimize'}>
              <Minimize2 className="w-4 h-4" />
            </button>
            <button onClick={() => { setFullscreen(f => !f); setMinimized(false); }}
              className="p-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
              title={fullscreen ? 'Restore' : 'Full Screen'}>
              <Maximize2 className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="p-1 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!minimized && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Gmail not connected warning */}
            {gmailConnected === false && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Gmail not connected — go to Settings &gt; Gmail Settings to connect before sending.
              </div>
            )}

            {/* Multi-product indicator */}
            {isMulti && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
                <strong>{allInquiries.length} products</strong> from the same inquiry thread:{' '}
                {allInquiries.map(i => i.product_name).join(', ')}
              </div>
            )}

            {/* Templates dropdown */}
            {showTemplates && templates.length > 0 && (
              <div className="border-b border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-600 mb-2">Choose template:</p>
                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="text-left px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-blue-50 hover:border-blue-300 transition">
                      <div className="font-medium text-gray-900 truncate">{t.template_name}</div>
                      <div className="text-gray-400 truncate">{t.category}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fields */}
            <div className="border-b border-gray-100">
              <div className="flex items-center px-4 py-1.5 border-b border-gray-100">
                <span className="text-xs text-gray-500 w-8 shrink-0">To</span>
                <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
                  className="flex-1 text-sm outline-none py-1 text-gray-900 placeholder-gray-400" placeholder="Recipients" />
                <div className="flex gap-2 ml-2 shrink-0">
                  <button onClick={() => setShowCc(s => !s)} className="text-xs text-gray-500 hover:text-gray-700">Cc</button>
                  <button onClick={() => setShowBcc(s => !s)} className="text-xs text-gray-500 hover:text-gray-700">Bcc</button>
                </div>
              </div>
              {showCc && (
                <div className="flex items-center px-4 py-1.5 border-b border-gray-100">
                  <span className="text-xs text-gray-500 w-8 shrink-0">Cc</span>
                  <input type="text" value={ccEmail} onChange={e => setCcEmail(e.target.value)}
                    className="flex-1 text-sm outline-none py-1 text-gray-900 placeholder-gray-400" placeholder="Cc (comma-separated)" />
                </div>
              )}
              {showBcc && (
                <div className="flex items-center px-4 py-1.5 border-b border-gray-100">
                  <span className="text-xs text-gray-500 w-8 shrink-0">Bcc</span>
                  <input type="text" value={bccEmail} onChange={e => setBccEmail(e.target.value)}
                    className="flex-1 text-sm outline-none py-1 text-gray-900 placeholder-gray-400" placeholder="Bcc (comma-separated)" />
                </div>
              )}
              <div className="flex items-center px-4 py-1.5">
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                  className="flex-1 text-sm outline-none py-1 text-gray-900 placeholder-gray-400 font-medium" placeholder="Subject" />
              </div>
            </div>

            {/* Rich text body */}
            <div className="flex-1 overflow-y-auto" style={{ minHeight: fullscreen ? 300 : 220 }}>
              <ReactQuill theme="snow" value={body} onChange={setBody}
                modules={quillModules} formats={quillFormats}
                style={{ height: fullscreen ? '100%' : 220, border: 'none' }}
                className="crm-quill-composer" />
            </div>

            {/* CRM Documents panel */}
            {showDocPanel && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 max-h-48 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-700 mb-2">
                  Attach documents from CRM
                  {crmDocsLoading && <span className="ml-2 text-gray-400">Loading…</span>}
                  {!crmDocsLoading && crmDocs.length === 0 && <span className="ml-2 text-gray-400 font-normal">— No documents uploaded yet for this inquiry</span>}
                </p>
                {crmDocs.map(doc => (
                  <label key={doc.id} className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-white transition mb-0.5 ${selectedCrmDocs.has(doc.id) ? 'bg-white border border-blue-200' : ''}`}>
                    <input type="checkbox" checked={selectedCrmDocs.has(doc.id)} onChange={() => toggleCrmDoc(doc.id)} className="w-3.5 h-3.5" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${DOC_TYPE_COLOR[doc.document_type] || 'bg-gray-100 text-gray-600'}`}>{doc.document_type}</span>
                    <span className="flex-1 text-xs text-gray-700 truncate">{doc.display_file_name || doc.original_file_name || doc.storage_path.split('/').pop()}</span>
                    {selectedCrmDocs.has(doc.id) && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                  </label>
                ))}
              </div>
            )}

            {/* Attached new files list */}
            {attachments.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1 text-xs text-gray-700">
                    <span className="truncate max-w-[120px]">{a.name}</span>
                    <span className="text-gray-400">({formatSize(a.size)})</span>
                    <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100">
              <button
                onClick={sendEmail}
                disabled={sending || !toEmail.trim() || !subject.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <><Loader className="w-4 h-4 animate-spin" />Sending…</> : <><Send className="w-4 h-4" />Send</>}
              </button>

              <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition" title="Attach new file">
                <Paperclip className="w-4 h-4" />
              </button>

              <button
                onClick={() => setShowDocPanel(s => !s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition ${showDocPanel ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-300 hover:bg-gray-100'}`}
                title="Attach from CRM documents"
              >
                <FileText className="w-3.5 h-3.5" />
                CRM Docs
                {selectedCrmDocs.size > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-white text-blue-700 rounded-full text-[10px] font-bold">{selectedCrmDocs.size}</span>
                )}
              </button>

              {totalAttachCount > 0 && (
                <span className="text-xs text-gray-500">{totalAttachCount} attachment{totalAttachCount !== 1 ? 's' : ''}</span>
              )}

              <div className="ml-auto text-xs text-gray-400 truncate">
                {isMulti ? `${allInquiries.length} products · ${inquiry.company_name}` : `${inquiry.inquiry_number} · ${inquiry.product_name}`}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .crm-quill-composer .ql-container { border: none !important; font-size: 14px; }
        .crm-quill-composer .ql-toolbar { border: none !important; border-bottom: 1px solid #f1f5f9 !important; padding: 6px 12px; }
        .crm-quill-composer .ql-editor { padding: 12px 16px; min-height: 180px; }
        .crm-quill-composer .ql-editor p { margin-bottom: 6px; }
      `}</style>
    </>
  );
}
