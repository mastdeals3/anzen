import { useState, useEffect } from 'react';
import { FileText, Sparkles, AlertTriangle, CheckCircle2, Calendar, Package, Building2, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { Email, ParsedEmailData } from '../../types/commandCenter';

interface InquiryFormPanelProps {
  email: Email | null;
  parsedData: ParsedEmailData | null;
  onSave: (data: InquiryFormData) => Promise<void>;
  saving: boolean;
}

export interface InquiryFormData {
  inquiryNumber: string;
  productName: string;
  specification: string;
  quantity: string;
  supplierName: string;
  supplierCountry: string;
  companyName: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  purposeIcons: string[];
  deliveryDateExpected: string;
  remarks: string;
  coaRequested: boolean;
  msdsRequested: boolean;
  sampleRequested: boolean;
  priceRequested: boolean;
  agencyLetterRequested: boolean;
  aceerp_no: string;
  purchasePrice: string;
  purchasePriceCurrency: string;
  offeredPrice: string;
  offeredPriceCurrency: string;
  deliveryDate: string;
  deliveryTerms: string;
}

export function InquiryFormPanel({ email, parsedData, onSave, saving }: InquiryFormPanelProps) {
  const [showEmailBody, setShowEmailBody] = useState(false);
  const [formData, setFormData] = useState<InquiryFormData>({
    inquiryNumber: '',
    productName: '',
    specification: '',
    quantity: '',
    supplierName: '',
    supplierCountry: '',
    companyName: '',
    contactPerson: '',
    contactEmail: '',
    contactPhone: '',
    priority: 'medium',
    purposeIcons: ['price'],
    deliveryDateExpected: '',
    remarks: '',
    coaRequested: false,
    msdsRequested: false,
    sampleRequested: false,
    priceRequested: true,
    agencyLetterRequested: false,
    aceerp_no: '',
    purchasePrice: '',
    purchasePriceCurrency: 'USD',
    offeredPrice: '',
    offeredPriceCurrency: 'USD',
    deliveryDate: '',
    deliveryTerms: '',
  });

  useEffect(() => {
    if (parsedData) {
      setFormData({
        inquiryNumber: '',
        productName: parsedData.productName || '',
        specification: parsedData.specification || '',
        quantity: parsedData.quantity || '',
        supplierName: parsedData.supplierName || '',
        supplierCountry: parsedData.supplierCountry || '',
        companyName: parsedData.companyName || '',
        contactPerson: parsedData.contactPerson || '',
        contactEmail: parsedData.contactEmail || '',
        contactPhone: parsedData.contactPhone || '',
        priority: parsedData.urgency || 'medium',
        purposeIcons: parsedData.purposeIcons || ['price'],
        deliveryDateExpected: parsedData.deliveryDateExpected || '',
        remarks: parsedData.remarks || '',
        coaRequested: parsedData.coaRequested || false,
        msdsRequested: parsedData.msdsRequested || false,
        sampleRequested: parsedData.sampleRequested || false,
        priceRequested: parsedData.priceRequested || true,
        agencyLetterRequested: parsedData.agencyLetterRequested || false,
        aceerp_no: '',
        purchasePrice: '',
        purchasePriceCurrency: 'USD',
        offeredPrice: '',
        offeredPriceCurrency: 'USD',
        deliveryDate: '',
        deliveryTerms: '',
      });
    }
  }, [parsedData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.productName.trim()) {
      alert('Product Name is required');
      return;
    }

    if (!formData.quantity.trim()) {
      alert('Quantity is required');
      return;
    }

    if (!formData.companyName.trim()) {
      alert('Company Name is required');
      return;
    }

    await onSave(formData);
  };

  const confidenceColor = {
    high: 'text-green-600 bg-green-50 border-green-200',
    medium: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    low: 'text-red-600 bg-red-50 border-red-200',
  };

  if (!email || !parsedData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 bg-gray-50">
        <FileText className="w-20 h-20 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Email Selected</h3>
        <p className="text-gray-600 max-w-md">
          Click on an email from the left panel to automatically parse and fill this inquiry form with AI
        </p>
        <div className="mt-6 text-sm text-gray-500 space-y-1">
          <p className="flex items-center gap-2 justify-center">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <span>AI extracts product, quantity, company, contact</span>
          </p>
          <p className="flex items-center gap-2 justify-center">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Only inquiry number needs manual input</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-transparent">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Create Inquiry</h2>
          {parsedData && (
            <div className={`px-3 py-1 rounded-lg text-sm font-medium border ${confidenceColor[parsedData.confidence]}`}>
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Confidence: {parsedData.confidence.toUpperCase()}</span>
                <span className="text-xs">({Math.round(parsedData.confidenceScore * 100)}%)</span>
              </div>
            </div>
          )}
        </div>

        {email && (
          <div className="mt-3 bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowEmailBody(!showEmailBody)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition border-b border-gray-200"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-blue-700">
                    {(email.from_name || email.from_email).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-base font-semibold text-gray-900 truncate">{email.subject}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-sm text-gray-900 font-medium">{email.from_name || 'Unknown'}</p>
                    <span className="text-gray-400 text-xs">•</span>
                    <p className="text-xs text-gray-500 truncate">&lt;{email.from_email}&gt;</p>
                  </div>
                </div>
              </div>
              {showEmailBody ? (
                <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0 ml-2" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 ml-2" />
              )}
            </button>
            {showEmailBody && (
              <div className="bg-white">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                    {new Date(email.received_date).toLocaleString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                <div className="px-5 py-6 max-h-[500px] overflow-y-auto">
                  <div
                    className="text-sm text-gray-900 leading-relaxed email-content"
                    style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif'
                    }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.body, {
                      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'b', 'i', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
                      ALLOWED_ATTR: ['style', 'class']
                    }) }}
                  />
                </div>
                <div className="px-5 py-3 bg-blue-50 border-t border-blue-100">
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-medium">AI has extracted data from this email. Review the form fields below.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {parsedData?.autoDetectedCompany && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg mt-3">
            <CheckCircle2 className="w-4 h-4" />
            <span>Company auto-detected from email domain</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-900 mb-1">Auto-Generated Inquiry Number</p>
                <p className="text-xs text-green-700">
                  Inquiry number will be automatically generated when you save (format: INQ-2025-NNNN)
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" />
              Product Information (AI Auto-filled)
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={formData.productName}
                  onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Specification
                </label>
                <input
                  type="text"
                  value={formData.specification}
                  onChange={(e) => setFormData({ ...formData, specification: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., BP, Powder / USP Grade / EP Standard"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quantity *
                  </label>
                  <input
                    type="text"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 150 KG"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority *
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier / Manufacturer
                  </label>
                  <input
                    type="text"
                    value={formData.supplierName}
                    onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country of Origin
                  </label>
                  <input
                    type="text"
                    value={formData.supplierCountry}
                    onChange={(e) => setFormData({ ...formData, supplierCountry: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Japan"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Expected Delivery Date
                </label>
                <input
                  type="text"
                  value={formData.deliveryDateExpected}
                  onChange={(e) => setFormData({ ...formData, deliveryDateExpected: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., November 2024, ASAP, 2 weeks"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Company & Contact (AI Auto-filled)
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                  readOnly
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Documents Requested
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={formData.priceRequested}
                  onChange={(e) => setFormData({ ...formData, priceRequested: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium">Price Quote</span>
              </label>
              <label className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={formData.coaRequested}
                  onChange={(e) => setFormData({ ...formData, coaRequested: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium">COA</span>
              </label>
              <label className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={formData.msdsRequested}
                  onChange={(e) => setFormData({ ...formData, msdsRequested: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium">MSDS</span>
              </label>
              <label className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={formData.sampleRequested}
                  onChange={(e) => setFormData({ ...formData, sampleRequested: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium">Sample</span>
              </label>
              <label className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={formData.agencyLetterRequested}
                  onChange={(e) => setFormData({ ...formData, agencyLetterRequested: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium">Agency Letter</span>
              </label>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Pricing</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Offered Price
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={formData.offeredPrice}
                    onChange={(e) => setFormData({ ...formData, offeredPrice: e.target.value })}
                    className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Click to add"
                  />
                  <select
                    value={formData.offeredPriceCurrency}
                    onChange={(e) => setFormData({ ...formData, offeredPriceCurrency: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="INR">INR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ACE ERP No
                </label>
                <input
                  type="text"
                  value={formData.aceerp_no}
                  onChange={(e) => setFormData({ ...formData, aceerp_no: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Delivery</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={formData.deliveryDate}
                  onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Terms
                </label>
                <select
                  value={formData.deliveryTerms}
                  onChange={(e) => setFormData({ ...formData, deliveryTerms: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option value="FOB Shanghai">FOB Shanghai</option>
                  <option value="CIF Dubai">CIF Dubai</option>
                  <option value="EXW">EXW</option>
                  <option value="DDP">DDP</option>
                  <option value="DAP">DAP</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Remarks
            </label>
            <textarea
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Additional notes or requirements..."
            />
          </div>
        </div>
      </form>

      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
        <button
          type="submit"
          onClick={handleSubmit}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating Inquiry...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Save & Create Inquiry
            </>
          )}
        </button>
        <p className="text-xs text-gray-500 text-center mt-2">
          Press Enter or click Save to create inquiry
        </p>
      </div>
    </div>
  );
}
