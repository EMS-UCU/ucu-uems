import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Unlock, Calendar, Clock, Search, Filter, Key } from 'lucide-react';
import {
  getApprovedPapersRepository,
  unlockPaper,
  reLockPaper,
  getPapersNeedingPasswordGeneration,
  generatePasswordForPaper,
  type ApprovedPaper,
} from '../lib/examServices/repositoryService';
import { supabase } from '../lib/supabase';

interface ApprovedPapersRepositoryProps {
  currentUserId: string;
}

export default function ApprovedPapersRepository({
  currentUserId,
}: ApprovedPapersRepositoryProps) {
  const [papers, setPapers] = useState<ApprovedPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'locked' | 'unlocked'>('all');
  const [unlockingPaperId, setUnlockingPaperId] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<ApprovedPaper | null>(null);
  const [generatingPasswords, setGeneratingPasswords] = useState(false);

  useEffect(() => {
    loadPapers();
    
    // Refresh papers every 2 minutes to catch new approvals
    const refreshInterval = setInterval(() => {
      loadPapers();
    }, 120000);
    
    // Check for expired unlocks every 5 minutes
    const unlockInterval = setInterval(() => {
      checkExpiredUnlocks();
    }, 300000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(unlockInterval);
    };
  }, []);

  const loadPapers = async () => {
    setLoading(true);
    try {
      console.log('📥 Loading approved papers from repository...');
      const data = await getApprovedPapersRepository();
      console.log('✅ Loaded approved papers:', data.length, data);
      setPapers(data);
    } catch (error) {
      console.error('❌ Error loading approved papers:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkExpiredUnlocks = async () => {
    const now = new Date();
    const expiredPapers = papers.filter(
      (p) => !p.is_locked && p.unlock_expires_at && new Date(p.unlock_expires_at) <= now
    );

    if (expiredPapers.length > 0) {
      // Re-lock expired papers
      for (const paper of expiredPapers) {
        await reLockPaper(paper.id, currentUserId);
      }
      await loadPapers();
    }
  };

  const handleUnlock = async (paper: ApprovedPaper) => {
    if (!unlockPassword.trim()) {
      setUnlockError('Please enter the unlock password');
      return;
    }

    setUnlockingPaperId(paper.id);
    setUnlockError(null);

    try {
      const result = await unlockPaper(paper.id, unlockPassword, currentUserId, 24); // 24 hour unlock

      if (result.success) {
        setUnlockPassword('');
        setSelectedPaper(null);
        // Clear search query so the unlocked paper is visible
        setSearchQuery('');
        // Ensure unlocked filter is active to show the unlocked paper
        setFilterStatus('unlocked');
        await loadPapers();
      } else {
        setUnlockError(result.error || 'Failed to unlock paper');
      }
    } catch (error: any) {
      setUnlockError(error.message || 'An error occurred');
    } finally {
      setUnlockingPaperId(null);
    }
  };

  const handleReLock = async (paper: ApprovedPaper) => {
    try {
      const result = await reLockPaper(paper.id, currentUserId);
      if (result.success) {
        await loadPapers();
      } else {
        alert(`Failed to re-lock paper: ${result.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleGeneratePasswords = async () => {
    // Check if there are locked papers without passwords
    const lockedPapersWithoutPasswords = papers.filter(
      p => p.is_locked && !p.unlock_password_hash && p.approval_status === 'approved_for_printing'
    );

    if (lockedPapersWithoutPasswords.length === 0) {
      alert('No locked papers found that need password generation.');
      return;
    }

    const force = confirm(
      `Found ${lockedPapersWithoutPasswords.length} locked paper(s) without passwords.\n\n` +
      `Click OK to generate passwords for all of them (even if due date hasn't passed).\n` +
      `Click Cancel to only generate for papers that are due.`
    );

    setGeneratingPasswords(true);
    try {
      let papersToProcess: ApprovedPaper[];
      
      if (force) {
        // Generate for all locked papers without passwords
        papersToProcess = lockedPapersWithoutPasswords;
      } else {
        // Only generate for papers that are due
        papersToProcess = await getPapersNeedingPasswordGeneration();
        if (papersToProcess.length === 0) {
          alert('No papers are currently due for password generation. Papers need to have a printing due date/time that has passed.');
          setGeneratingPasswords(false);
          return;
        }
      }

      // Generate passwords for each paper
      const results = [];
      for (const paper of papersToProcess) {
        const result = await generatePasswordForPaper(paper.id, force);
        results.push({
          paperId: paper.id,
          courseCode: paper.course_code,
          success: result.success,
          error: result.error,
          password: result.password
        });
      }

      // Show results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      if (successful.length > 0) {
        const passwordList = successful
          .map(r => r.password ? `${r.courseCode}: ${r.password}` : r.courseCode)
          .join('\n');
        alert(`✅ Generated passwords for ${successful.length} paper(s):\n\n${passwordList}\n\nCheck your notifications for details.${failed.length > 0 ? `\n\n⚠️ Failed for ${failed.length} paper(s).` : ''}`);
      } else {
        alert(`❌ Failed to generate passwords:\n${failed.map(f => `${f.courseCode}: ${f.error}`).join('\n')}`);
      }

      // Reload papers to show updated password status
      await loadPapers();
    } catch (error: any) {
      console.error('Error generating passwords:', error);
      alert(`Error generating passwords: ${error.message}`);
    } finally {
      setGeneratingPasswords(false);
    }
  };

  const filteredPapers = papers.filter((paper) => {
    // If search query is empty, show all papers (match everything)
    const matchesSearch = !searchQuery.trim() ||
      paper.course_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      paper.course_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter =
      filterStatus === 'all' ||
      (filterStatus === 'locked' && paper.is_locked) ||
      (filterStatus === 'unlocked' && !paper.is_locked);

    return matchesSearch && matchesFilter;
  });

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString?: string, timeString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (timeString) {
      const [hours, minutes] = timeString.split(':');
      date.setHours(parseInt(hours, 10), parseInt(minutes, 10));
    }
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isExpired = (paper: ApprovedPaper) => {
    if (paper.is_locked || !paper.unlock_expires_at) return false;
    return new Date(paper.unlock_expires_at) <= new Date();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent"></div>
          <p className="mt-4 text-sm text-slate-600">Loading approved papers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-blue-900">Approved Papers Repository</h2>
            <p className="mt-1 text-sm text-slate-600">
              Manage locked approved papers and unlock them using generated passwords
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGeneratePasswords}
              disabled={generatingPasswords}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-700 transition hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generate passwords for papers that are due for printing"
            >
              {generatingPasswords ? 'Generating...' : 'Generate Passwords'}
            </button>
            <button
              type="button"
              onClick={loadPapers}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              Refresh
            </button>
            <div className="flex items-center gap-2 rounded-lg bg-blue-100 px-4 py-2">
              <Key className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">
                {papers.filter((p) => p.is_locked).length} Locked
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by course code or name..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-10 pr-10 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              filterStatus === 'all'
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({papers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('locked')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              filterStatus === 'locked'
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Lock className="mr-1 inline h-4 w-4" />
            Locked ({papers.filter((p) => p.is_locked).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('unlocked')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              filterStatus === 'unlocked'
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Unlock className="mr-1 inline h-4 w-4" />
            Unlocked ({papers.filter((p) => !p.is_locked).length})
          </button>
        </div>
      </div>

      {/* Papers List */}
      {filteredPapers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-slate-600">
            {searchQuery || filterStatus !== 'all'
              ? 'No papers match your search criteria'
              : 'No approved papers in repository yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPapers.map((paper, index) => (
            <motion.div
              key={paper.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-blue-900">
                      {paper.course_code} - {paper.course_name}
                    </h3>
                    {paper.is_locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                        <Lock className="h-3 w-3" />
                        Locked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                        <Unlock className="h-3 w-3" />
                        Unlocked
                        {paper.unlock_expires_at && (
                          <span className="ml-1 text-[0.65rem]">
                            (expires {formatDateTime(paper.unlock_expires_at)})
                          </span>
                        )}
                      </span>
                    )}
                    {!paper.is_locked && isExpired(paper) && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[0.65rem] font-semibold text-amber-700">
                        Expired
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1">Printing Due</p>
                      <p className="flex items-center gap-2 text-slate-700">
                        <Calendar className="h-4 w-4" />
                        {formatDateTime(paper.printing_due_date, paper.printing_due_time)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1">Password Status</p>
                      <p className="flex items-center gap-2 text-slate-700">
                        <Key className="h-4 w-4" />
                        {paper.password_generated_at
                          ? `Generated ${formatDate(paper.password_generated_at)}`
                          : 'Not generated yet'}
                      </p>
                    </div>
                    {paper.unlocked_at && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">Unlocked</p>
                        <p className="text-slate-700">{formatDateTime(paper.unlocked_at)}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="ml-4 flex flex-col gap-2">
                  {paper.is_locked ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPaper(paper)}
                      className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
                    >
                      Unlock Paper
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReLock(paper)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Re-lock
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Unlock Modal */}
      {selectedPaper && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-blue-900 mb-2">Unlock Paper</h3>
            <p className="text-sm text-slate-600 mb-4">
              Enter the unlock password for <strong>{selectedPaper.course_code}</strong>. The paper will be unlocked for 24 hours.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Unlock Password *
                </label>
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => {
                    setUnlockPassword(e.target.value);
                    setUnlockError(null);
                  }}
                  placeholder="Enter password from notification"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  autoFocus
                />
                {unlockError && (
                  <p className="mt-1 text-xs text-red-600">{unlockError}</p>
                )}
              </div>

              {!selectedPaper.password_generated_at && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-700">
                    ⚠️ Password not generated yet. Password will be generated on the printing due date ({formatDateTime(selectedPaper.printing_due_date, selectedPaper.printing_due_time)}).
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => handleUnlock(selectedPaper)}
                disabled={!unlockPassword.trim() || unlockingPaperId === selectedPaper.id}
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlockingPaperId === selectedPaper.id ? 'Unlocking...' : 'Unlock Paper'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPaper(null);
                  setUnlockPassword('');
                  setUnlockError(null);
                }}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
