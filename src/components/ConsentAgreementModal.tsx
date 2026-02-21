import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WorkflowRole } from '../lib/roleConsentService';
import { getRoleConsentAgreementsForRoles, type RoleConsentAgreement } from '../lib/roleConsentAgreementService';

interface ConsentAgreementModalProps {
  rolesToAccept: WorkflowRole[];
  userName: string;
  onAccept: (role: WorkflowRole) => Promise<void>;
  onDecline: () => void;
  onComplete: () => void;
}

export default function ConsentAgreementModal({
  rolesToAccept,
  userName,
  onAccept,
  onDecline,
  onComplete,
}: ConsentAgreementModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [agreements, setAgreements] = useState<Map<WorkflowRole, RoleConsentAgreement>>(new Map());
  const [loading, setLoading] = useState(true);

  const currentRole = rolesToAccept[currentIndex];
  const document = agreements.get(currentRole || '');

  // Fetch agreements from database on mount
  useEffect(() => {
    const loadAgreements = async () => {
      if (rolesToAccept.length === 0) {
        console.log('⚠️ ConsentAgreementModal: No roles to accept, skipping load');
        setLoading(false);
        return;
      }
      
      console.log('📥 ConsentAgreementModal: Loading agreements for roles:', rolesToAccept);
      setLoading(true);
      setError(null);
      
      try {
        const agreementsMap = await getRoleConsentAgreementsForRoles(rolesToAccept);
        console.log('✅ ConsentAgreementModal: Loaded agreements:', Array.from(agreementsMap.keys()));
        console.log('📊 ConsentAgreementModal: Agreements map size:', agreementsMap.size, 'Roles needed:', rolesToAccept.length);
        setAgreements(agreementsMap);
        
        if (agreementsMap.size === 0) {
          console.warn('⚠️ ConsentAgreementModal: No consent agreements found in database');
          setError('No consent agreements found. Please contact your administrator to set up the agreements.');
        } else if (agreementsMap.size < rolesToAccept.length) {
          const missing = rolesToAccept.filter(r => !agreementsMap.has(r));
          console.warn('⚠️ ConsentAgreementModal: Missing agreements for roles:', missing);
          setError(`Some consent agreements are missing: ${missing.join(', ')}. Please contact your administrator.`);
        } else {
          console.log('✅ ConsentAgreementModal: All agreements loaded successfully');
        }
      } catch (err) {
        console.error('❌ ConsentAgreementModal: Error loading agreements:', err);
        setError('Failed to load consent agreements. Please check your connection and try again.');
      } finally {
        setLoading(false);
        console.log('🏁 ConsentAgreementModal: Loading complete');
      }
    };

    loadAgreements();
  }, [rolesToAccept]);

  const handleAccept = async () => {
    if (!currentRole || !document) {
      console.error('Cannot accept: missing role or document', { currentRole, document });
      return;
    }
    setError(null);
    setAccepting(true);
    try {
      console.log('✅ Accepting agreement for role:', currentRole);
      await onAccept(currentRole);
      console.log('✅ Agreement accepted successfully');
      if (currentIndex < rolesToAccept.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        console.log('✅ All agreements accepted, completing...');
        onComplete();
      }
    } catch (err: unknown) {
      console.error('❌ Error accepting agreement:', err);
      setError(err instanceof Error ? err.message : 'Failed to record acceptance');
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = () => {
    setShowDeclineConfirm(true);
  };

  const confirmDecline = () => {
    setDeclining(true);
    onDecline();
  };

  if (loading) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl bg-white p-8 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <p className="text-blue-700 font-semibold">Loading consent agreements...</p>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  if (!effectiveDocument || !currentRole) {
    console.log('⚠️ ConsentAgreementModal: Missing document or role', { 
      currentRole, 
      document: effectiveDocument ? 'exists' : 'missing',
      agreementsSize: agreements.size,
      rolesToAccept 
    });
    if (error) {
      console.log('❌ ConsentAgreementModal: Showing error state');
      return (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-2xl bg-white p-8 shadow-2xl max-w-md"
            >
              <p className="text-red-600 font-semibold mb-4">{error}</p>
              <button
                onClick={() => currentRole && onDecline(currentRole)}
                className="rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700 transition-colors"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      );
    }
    // Still show loading if we're waiting for agreements
    if (loading) {
      return null; // Loading state already handled above
    }
    console.log('⚠️ ConsentAgreementModal: Returning null - no document/role and not loading');
    return null;
  }
  
  console.log('✅ ConsentAgreementModal: Rendering modal for role:', currentRole);

  const roleLabel = document.role;
  const progressText = `${currentIndex + 1} of ${rolesToAccept.length}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
        onClick={(e) => {
          // Prevent closing by clicking outside
          if (e.target === e.currentTarget) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onKeyDown={(e) => {
          // Prevent closing with Escape key
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border-2 border-blue-200 overflow-hidden"
        >
          {/* Header */}
          <div className="flex-shrink-0 bg-gradient-to-r from-blue-700 to-blue-900 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-200 text-sm font-medium uppercase tracking-wider">
                  Uganda Christian University
                </p>
                <h2 className="text-xl font-bold text-white mt-0.5">
                  {document.title}
                </h2>
              </div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold text-white">
                {progressText}
              </span>
            </div>
          </div>

          {/* Content - scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-4 p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-lg">
              <p className="text-slate-700 text-sm font-medium">
                <span className="font-bold text-amber-700">Important:</span> You must read and accept the terms and conditions below to continue using the system with your assigned role.
              </p>
            </div>
            <p className="text-slate-600 text-sm mb-4">
              Welcome, <span className="font-semibold text-slate-800">{userName}</span>.
              You have been assigned the <span className="font-bold text-blue-700">{roleLabel}</span> role.
            </p>
            <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-6 text-slate-800 text-sm leading-relaxed">
              <div className="mb-4 pb-4 border-b border-slate-300">
                <h3 className="font-bold text-base text-slate-900 mb-2">Terms and Conditions Agreement</h3>
                <p className="text-xs text-slate-600 mb-3">
                  By proceeding, you acknowledge that you have read, understood, and agree to be bound by the following terms:
                </p>
              </div>
              <div className="space-y-3 whitespace-pre-wrap text-slate-700">
                {document.agreement_summary.split('\n').map((line, idx) => (
                  <p key={idx} className={line.trim() ? '' : 'h-2'}>{line || '\u00A0'}</p>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-slate-300">
                <p className="text-xs font-semibold text-slate-700">
                  By clicking "I Accept" below, you confirm that you have read and agree to all terms and conditions stated above.
                </p>
                <p className="text-xs text-slate-600 mt-2">
                  If you do not agree to these terms, please click "I Decline" to exit the system.
                </p>
              </div>
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t-2 border-slate-300 bg-gradient-to-r from-slate-50 to-blue-50 px-6 py-4">
            {showDeclineConfirm ? (
              <div className="space-y-4">
                <div className="p-4 bg-red-50 border-2 border-red-200 rounded-lg">
                  <p className="text-red-800 font-semibold text-sm mb-2">
                    ⚠️ Warning: Declining Terms and Conditions
                  </p>
                  <p className="text-red-700 text-sm">
                    If you decline these terms, you will not be able to access the system with your assigned role. 
                    You will be logged out and will need to contact your administrator if you wish to proceed.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDeclineConfirm(false)}
                    disabled={declining}
                    className="rounded-xl border-2 border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 shadow-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDecline}
                    disabled={declining}
                    className="rounded-xl bg-red-600 px-6 py-3 font-semibold text-white shadow-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {declining ? 'Processing...' : 'Yes, I Decline'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-xs text-slate-600 font-medium mb-1">
                    Please review the terms and conditions above
                  </p>
                  <p className="text-xs text-slate-500">
                    You must accept these terms to continue using the system
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={accepting || declining}
                    className="rounded-xl border-2 border-red-300 bg-white px-6 py-3 font-semibold text-red-700 shadow-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    I Decline
                  </button>
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={accepting || declining}
                    className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {accepting ? 'Processing...' : 'I Accept'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
