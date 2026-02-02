import { useState, useRef, useEffect } from 'react';
import { FileText, Download, ChevronDown, X, Loader2 } from 'lucide-react';
import {
  getRoleConsentDocuments,
  type RoleDocumentInfo,
} from '../lib/roleConsentStorage';

interface ComplianceDocumentsDropdownProps {
  /** Workflow roles the user has (Chief Examiner, Team Lead, Vetter, Setter) - from currentUserHasRole */
  workflowRoles: string[];
  className?: string;
}

export default function ComplianceDocumentsDropdown({
  workflowRoles: userWorkflowRoles,
  className = '',
}: ComplianceDocumentsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<RoleDocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<RoleDocumentInfo | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  if (userWorkflowRoles.length === 0) return null;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && documents.length === 0) {
      setLoading(true);
      getRoleConsentDocuments(userWorkflowRoles)
        .then(setDocuments)
        .catch((err) => {
          console.error('Error loading consent documents:', err);
          setDocuments([]);
        })
        .finally(() => setLoading(false));
    }
  }, [open, userWorkflowRoles.join(','), documents.length]);

  const handleView = (doc: RoleDocumentInfo) => {
    if (doc.url) {
      window.open(doc.url, '_blank', 'noopener,noreferrer');
    } else {
      setViewingDoc(doc);
    }
  };

  const handleDownload = (doc: RoleDocumentInfo) => {
    if (doc.url) {
      const a = document.createElement('a');
      a.href = doc.url;
      a.download = doc.title.replace(/\s+/g, '-') + '.pdf';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-gradient-to-r from-white to-blue-50/50 px-4 py-2.5 text-base font-semibold text-slate-700 shadow-sm hover:bg-blue-50 hover:border-blue-300 hover:shadow-md transition-all"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <FileText className="w-5 h-5 text-blue-600" />
        <span className="whitespace-nowrap">Compliance Documents</span>
        <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-xl py-2 z-50">
          <div className="px-4 py-2 border-b border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Role Agreements
            </p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading documents...</span>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {documents.map((doc) => (
                <div
                  key={doc.role}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50"
                >
                  <span className="flex-1 text-left text-sm font-medium text-slate-800 truncate">
                    {doc.title}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleView(doc)}
                      disabled={!doc.url}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="View"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={!doc.url}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {documents.length === 0 && !loading && (
                <p className="px-4 py-6 text-sm text-slate-500 text-center">
                  No documents available. Ensure files are uploaded to the role_conscents bucket.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {viewingDoc && !viewingDoc.url && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-blue-900">{viewingDoc.title}</h3>
              <button
                type="button"
                onClick={() => setViewingDoc(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-amber-700">
              Document could not be loaded. {viewingDoc.error || 'Please check that the file exists in the role_conscents bucket.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
