import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Lock, Unlock, Calendar, Clock, Search, Filter, Key, Eye, Printer, X, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [viewingPaper, setViewingPaper] = useState<ApprovedPaper | null>(null);
  const [paperViewerUrl, setPaperViewerUrl] = useState<string | null>(null);
  const [isBlurred, setIsBlurred] = useState(false);
  const [screenshotWarning, setScreenshotWarning] = useState(false);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);

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

  // Setup screenshot detection when viewer is open
  useEffect(() => {
    if (!viewingPaper) return;

    const cleanup = setupScreenshotDetection();
    return cleanup;
  }, [viewingPaper]);

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

  // Lazy load PDF.js to avoid breaking the app on initial load
  const loadPdfJs = async () => {
    const pdfjs = await import('pdfjs-dist');
    // Set up PDF.js worker - use unpkg CDN which works better with Vite
    if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
      // Use unpkg.com CDN which is more reliable for dynamic imports
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    }
    return pdfjs;
  };

  const resolvePaperUrl = async (fileUrl?: string | null): Promise<string | null> => {
    if (!fileUrl) return null;
    
    // If it's already a direct URL (http/https/data), return it
    const directFileUrlPattern = /^(https?:\/\/|\/|data:)/i;
    if (directFileUrlPattern.test(fileUrl)) {
      return fileUrl;
    }

    // Otherwise, get signed URL from Supabase Storage
    try {
      const { data, error } = await supabase.storage
        .from('exam_papers')
        .createSignedUrl(fileUrl, 3600); // 1 hour expiry

      if (error) {
        console.error('Error creating signed URL:', error);
        return null;
      }

      return data.signedUrl;
    } catch (error) {
      console.error('Error resolving paper URL:', error);
      return null;
    }
  };

  const loadPdfPages = async (url: string) => {
    setLoadingPdf(true);
    try {
      // Load PDF.js library if not already loaded
      const pdfjs = await loadPdfJs();
      
      // Fetch PDF as array buffer
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      
      // Load PDF document
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      setTotalPages(pdf.numPages);
      
      // Render all pages to canvas and convert to data URLs
      const pagePromises = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        pagePromises.push(
          pdf.getPage(pageNum).then(async (page) => {
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            if (!context) {
              throw new Error('Could not get canvas context');
            }
            
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            const renderContext = {
              canvasContext: context,
              viewport: viewport,
            };
            
            await page.render(renderContext).promise;
            
            // Convert canvas to data URL (image)
            return canvas.toDataURL('image/png');
          })
        );
      }
      
      const pageImages = await Promise.all(pagePromises);
      setPdfPages(pageImages);
      setCurrentPage(1);
      setLoadingPdf(false);
    } catch (error: any) {
      console.error('Error loading PDF:', error);
      alert(`Error loading PDF: ${error.message || 'Unknown error'}`);
      setLoadingPdf(false);
    }
  };

  const handleViewPaper = async (paper: ApprovedPaper) => {
    // If already expanded, collapse it
    if (expandedPaperId === paper.id) {
      setExpandedPaperId(null);
      setViewingPaper(null);
      setPaperViewerUrl(null);
      setIsBlurred(false);
      setScreenshotWarning(false);
      setPdfPages([]);
      setCurrentPage(1);
      setTotalPages(0);
      return;
    }

    if (!paper.file_url) {
      alert('Paper file URL not available. The paper may not have been uploaded yet.');
      return;
    }

    try {
      const url = await resolvePaperUrl(paper.file_url);
      if (!url) {
        alert('Failed to load paper. The file may not be accessible. Please contact support.');
        return;
      }

      setPaperViewerUrl(url);
      setViewingPaper(paper);
      setExpandedPaperId(paper.id);
      setIsBlurred(false);
      setScreenshotWarning(false);
      setPdfPages([]);
      setCurrentPage(1);
      setTotalPages(0);
      
      // Load PDF pages
      await loadPdfPages(url);
    } catch (error: any) {
      console.error('Error loading paper:', error);
      alert(`Error loading paper: ${error.message || 'Unknown error'}`);
    }
  };

  const setupScreenshotDetection = () => {
    // Detect Print Screen key
    const handleKeyDown = (e: KeyboardEvent) => {
      // Print Screen (Windows/Linux)
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        e.preventDefault();
        triggerBlur('Print Screen detected');
        return false;
      }
      
      // Windows Snipping Tool shortcut (Win + Shift + S)
      if (e.key === 's' || e.key === 'S') {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
          e.preventDefault();
          triggerBlur('Screenshot shortcut detected');
          return false;
        }
      }
      
      // Mac screenshot shortcuts (Cmd + Shift + 3/4/5)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === '3' || e.key === '4' || e.key === '5') {
          e.preventDefault();
          triggerBlur('Screenshot shortcut detected');
          return false;
        }
      }
      
      // F12 (DevTools) - often used for screenshots
      if (e.key === 'F12') {
        e.preventDefault();
        triggerBlur('Developer tools detected');
        return false;
      }
    };

    // Detect right-click (context menu often used for saving images)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerBlur('Right-click detected');
      return false;
    };

    // Detect visibility change (tab switching, alt+tab)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerBlur('Tab switch detected');
      }
    };

    // Detect window blur (alt+tab, clicking away)
    const handleBlur = () => {
      triggerBlur('Window focus lost');
    };

    // Monitor for dev tools opening
    let devToolsOpen = false;
    const checkDevTools = setInterval(() => {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;
      
      if ((widthThreshold || heightThreshold) && !devToolsOpen) {
        devToolsOpen = true;
        triggerBlur('Developer tools detected');
      } else if (!widthThreshold && !heightThreshold) {
        devToolsOpen = false;
      }
    }, 500);

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    // Cleanup function
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      clearInterval(checkDevTools);
    };
  };

  const triggerBlur = (reason: string) => {
    setIsBlurred(true);
    setScreenshotWarning(true);
    console.warn('⚠️ Screenshot attempt detected:', reason);
    
    // Show warning message
    setTimeout(() => {
      alert('⚠️ Screenshot detection triggered. Content has been blurred for security.');
    }, 100);

    // Auto-unblur after 3 seconds
    setTimeout(() => {
      setIsBlurred(false);
      setScreenshotWarning(false);
    }, 3000);
  };

  const handlePrintPaper = () => {
    if (!pdfPages.length || !viewingPaper) return;
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Please allow pop-ups to print the paper.');
      return;
    }

    // Create HTML with all PDF pages as images
    const imagesHtml = pdfPages.map((pageDataUrl, index) => 
      `<img src="${pageDataUrl}" style="width: 100%; page-break-after: always; display: block;" alt="Page ${index + 1}" />`
    ).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print - ${viewingPaper.course_code}</title>
          <style>
            @media print {
              body { margin: 0; padding: 0; }
              img { max-width: 100%; height: auto; page-break-after: always; }
            }
            body {
              margin: 0;
              padding: 20px;
              font-family: Arial, sans-serif;
            }
            img {
              width: 100%;
              height: auto;
              margin-bottom: 20px;
              display: block;
            }
          </style>
        </head>
        <body oncontextmenu="return false" onselectstart="return false" ondragstart="return false">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2>${viewingPaper.course_code} - ${viewingPaper.course_name}</h2>
          </div>
          ${imagesHtml}
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
            document.addEventListener('keydown', function(e) {
              if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                return false;
              }
            });
            document.addEventListener('contextmenu', function(e) {
              e.preventDefault();
              return false;
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
                    <>
                      <button
                        type="button"
                        onClick={() => handleViewPaper(paper)}
                        className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
                      >
                        {expandedPaperId === paper.id ? (
                          <>
                            <X className="h-4 w-4" />
                            Close
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4" />
                            View Paper
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReLock(paper)}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Re-lock
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Paper Viewer - Shows inside the card when expanded */}
              {expandedPaperId === paper.id && viewingPaper?.id === paper.id && paperViewerUrl && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-6 border-t border-slate-200 pt-6"
                  style={{
                    filter: isBlurred ? 'blur(20px)' : 'none',
                    transition: 'filter 0.3s ease',
                  }}
                >
                  {/* Screenshot Warning Banner */}
                  {screenshotWarning && (
                    <div className="mb-4 bg-red-600 text-white px-6 py-3 text-center font-semibold rounded-lg">
                      ⚠️ Screenshot attempt detected! Content has been blurred for security.
                    </div>
                  )}

                  {/* Exam Paper Card - Full Width */}
                    <div className="w-full rounded-xl border-2 border-blue-200/70 bg-white/95 p-4 shadow-md">
                      <div className="mb-3 flex items-center justify-between border-b border-blue-100 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
                            <span className="text-white text-xs">🪟</span>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">Secure In-Window Viewer</p>
                            <p className="text-[0.65rem] text-slate-600">Document stays inside the Safe Browser</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-700">
                          Live Preview
                        </span>
                      </div>

                      {/* Paper Info */}
                      <div className="mb-3 space-y-2">
                        <div>
                          <label className="text-[0.65rem] font-semibold text-slate-500">File</label>
                          <input
                            type="text"
                            value={paper.file_name || `${paper.course_code}_Exam_Paper.pdf`}
                            readOnly
                            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                          />
                        </div>
                        <div>
                          <label className="text-[0.65rem] font-semibold text-slate-500">Course</label>
                          <input
                            type="text"
                            value={paper.course_code}
                            readOnly
                            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                          />
                        </div>
                      </div>

                      {/* PDF Viewer - Full Width */}
                      <div className="mt-3 w-full overflow-auto rounded-lg border-2 border-slate-200 bg-slate-50 shadow-inner" style={{
                        maxHeight: '800px',
                        minHeight: '600px',
                      }}>
                        {loadingPdf ? (
                          <div className="flex items-center justify-center h-full min-h-[400px]">
                            <div className="text-center">
                              <div className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-solid border-blue-500 border-r-transparent"></div>
                              <p className="mt-2 text-xs text-slate-600">Loading PDF pages...</p>
                            </div>
                          </div>
                        ) : pdfPages.length > 0 ? (
                          <div className="p-4 space-y-4">
                            {/* Page Navigation */}
                            {totalPages > 1 && (
                              <div className="sticky top-0 z-10 bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center justify-between shadow-sm mb-4">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newPage = Math.max(1, currentPage - 1);
                                    setCurrentPage(newPage);
                                  }}
                                  disabled={currentPage === 1}
                                  className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <ChevronLeft className="h-3 w-3" />
                                  Prev
                                </button>
                                <span className="text-xs font-semibold text-slate-700">
                                  Page {currentPage} of {totalPages}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newPage = Math.min(totalPages, currentPage + 1);
                                    setCurrentPage(newPage);
                                  }}
                                  disabled={currentPage === totalPages}
                                  className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Next
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            )}

                            {/* PDF Pages - Full Width */}
                            {pdfPages.map((pageDataUrl, index) => (
                              <div
                                key={index}
                                data-page={index + 1}
                                className={`bg-white rounded shadow-sm flex justify-center ${index + 1 === currentPage ? 'ring-2 ring-blue-500' : ''}`}
                                style={{ display: totalPages > 1 && index + 1 !== currentPage ? 'none' : 'block' }}
                              >
                                <img
                                  src={pageDataUrl}
                                  alt={`Page ${index + 1}`}
                                  className="max-w-full h-auto"
                                  style={{
                                    userSelect: 'none',
                                    WebkitUserSelect: 'none',
                                    pointerEvents: 'none',
                                    draggable: false,
                                    width: '100%',
                                    maxWidth: '100%',
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    triggerBlur('Right-click detected');
                                    return false;
                                  }}
                                  onDragStart={(e) => e.preventDefault()}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full min-h-[400px]">
                            <p className="text-xs text-slate-600">No PDF content available</p>
                          </div>
                        )}
                      </div>

                      {/* Description and Actions */}
                      <p className="mt-3 text-[0.65rem] text-slate-500 text-center">
                        Zoom, scroll, and view from here. Document stays inside the Safe Browser.
                      </p>
                      
                      {/* Print Button */}
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          onClick={handlePrintPaper}
                          className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-600"
                        >
                          <Printer className="h-3 w-3" />
                          Print Paper
                        </button>
                      </div>
                    </div>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Old Separate Viewer - Removed */}
      {false && viewingPaper && paperViewerUrl && (
        <div className="mt-6" style={{
          filter: isBlurred ? 'blur(20px)' : 'none',
          transition: 'filter 0.3s ease',
        }}>
          {/* Screenshot Warning Banner */}
          {screenshotWarning && (
            <div className="mb-4 bg-red-600 text-white px-6 py-3 text-center font-semibold rounded-lg">
              ⚠️ Screenshot attempt detected! Content has been blurred for security.
            </div>
          )}

          {/* Exam Paper Card - Full Width */}
            <div className="rounded-xl border-2 border-blue-200/70 bg-white/95 p-4 shadow-md">
              <div className="mb-3 flex items-center justify-between border-b border-blue-100 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
                    <span className="text-white text-xs">🪟</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Secure In-Window Viewer</p>
                    <p className="text-[0.65rem] text-slate-600">Document stays inside the Safe Browser</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-700">
                    Live Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setViewingPaper(null);
                      setPaperViewerUrl(null);
                      setIsBlurred(false);
                      setScreenshotWarning(false);
                      setPdfPages([]);
                      setCurrentPage(1);
                      setTotalPages(0);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Paper Info */}
              <div className="mb-3 space-y-2">
                <div>
                  <label className="text-[0.65rem] font-semibold text-slate-500">File</label>
                  <input
                    type="text"
                    value={viewingPaper.file_name || `${viewingPaper.course_code}_Exam_Paper.pdf`}
                    readOnly
                    className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-[0.65rem] font-semibold text-slate-500">Course</label>
                  <input
                    type="text"
                    value={viewingPaper.course_code}
                    readOnly
                    className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                  />
                </div>
              </div>

              {/* PDF Viewer */}
              <div className="mt-3 aspect-[210/297] overflow-auto rounded-lg border-2 border-slate-200 bg-slate-50 shadow-inner" style={{
                filter: isBlurred ? 'blur(20px)' : 'none',
                transition: 'filter 0.3s ease',
                maxHeight: '600px',
              }}>
                {loadingPdf ? (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="text-center">
                      <div className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-solid border-blue-500 border-r-transparent"></div>
                      <p className="mt-2 text-xs text-slate-600">Loading PDF pages...</p>
                    </div>
                  </div>
                ) : pdfPages.length > 0 ? (
                  <div className="p-4 space-y-4">
                    {/* Page Navigation */}
                    {totalPages > 1 && (
                      <div className="sticky top-0 z-10 bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center justify-between shadow-sm mb-4">
                        <button
                          type="button"
                          onClick={() => {
                            const newPage = Math.max(1, currentPage - 1);
                            setCurrentPage(newPage);
                          }}
                          disabled={currentPage === 1}
                          className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft className="h-3 w-3" />
                          Prev
                        </button>
                        <span className="text-xs font-semibold text-slate-700">
                          Page {currentPage} of {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const newPage = Math.min(totalPages, currentPage + 1);
                            setCurrentPage(newPage);
                          }}
                          disabled={currentPage === totalPages}
                          className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Next
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {/* PDF Pages */}
                    {pdfPages.map((pageDataUrl, index) => (
                      <div
                        key={index}
                        data-page={index + 1}
                        className={`bg-white rounded shadow-sm ${index + 1 === currentPage ? 'ring-2 ring-blue-500' : ''}`}
                        style={{ display: totalPages > 1 && index + 1 !== currentPage ? 'none' : 'block' }}
                      >
                        <img
                          src={pageDataUrl}
                          alt={`Page ${index + 1}`}
                          className="w-full h-auto"
                          style={{
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            pointerEvents: 'none',
                            draggable: false,
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            triggerBlur('Right-click detected');
                            return false;
                          }}
                          onDragStart={(e) => e.preventDefault()}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <p className="text-xs text-slate-600">No PDF content available</p>
                  </div>
                )}
              </div>

              {/* Description and Actions */}
              <p className="mt-3 text-[0.65rem] text-slate-500 text-center">
                Zoom, scroll, and view from here. Document stays inside the Safe Browser.
              </p>
              
              {/* Print Button */}
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={handlePrintPaper}
                  className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-600"
                >
                  <Printer className="h-3 w-3" />
                  Print Paper
                </button>
              </div>
            </div>

        </div>
      )}

      {/* Old Full-Screen Modal - Removed */}
      {false && viewingPaper && paperViewerUrl && (
        <div 
          className="fixed inset-0 z-[300] flex flex-col bg-slate-900"
          onContextMenu={(e) => {
            e.preventDefault();
            triggerBlur('Right-click detected');
            return false;
          }}
          onDragStart={(e) => e.preventDefault()}
          style={{
            filter: isBlurred ? 'blur(20px)' : 'none',
            transition: 'filter 0.3s ease',
          }}
        >
          {/* Screenshot Warning Banner */}
          {screenshotWarning && (
            <div className="absolute top-0 left-0 right-0 z-[400] bg-red-600 text-white px-6 py-3 text-center font-semibold">
              ⚠️ Screenshot attempt detected! Content has been blurred for security.
            </div>
          )}

          {/* Viewer Header */}
          <div className="flex items-center justify-between bg-white border-b border-slate-200 px-6 py-4">
            <div>
              <h3 className="text-lg font-bold text-blue-900">
                {viewingPaper.course_code} - {viewingPaper.course_name}
              </h3>
              <p className="text-sm text-slate-600">
                View Only - Printing Enabled • Download & Screenshots Disabled
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePrintPaper}
                className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewingPaper(null);
                  setPaperViewerUrl(null);
                  setIsBlurred(false);
                  setScreenshotWarning(false);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* PDF Viewer - Secure In-Window Viewer Style */}
          <div className="flex-1 overflow-auto relative bg-slate-50 p-6" style={{
            filter: isBlurred ? 'blur(20px)' : 'none',
            transition: 'filter 0.3s ease',
          }}>
            {loadingPdf ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent"></div>
                  <p className="mt-4 text-sm text-slate-600">Loading PDF pages...</p>
                </div>
              </div>
            ) : pdfPages.length > 0 ? (
              <div className="max-w-4xl mx-auto">
                {/* Secure Viewer Container - Matching Vetting Dashboard Style */}
                <div className="rounded-xl border-2 border-blue-200/70 bg-white/95 p-4 shadow-md">
                  {/* Page Navigation */}
                  {totalPages > 1 && (
                    <div className="mb-3 bg-white border border-slate-200 rounded-lg px-4 py-2 flex items-center justify-between shadow-sm">
                    <button
                      type="button"
                      onClick={() => {
                        const newPage = Math.max(1, currentPage - 1);
                        setCurrentPage(newPage);
                        // Scroll to page
                        setTimeout(() => {
                          const pageElement = document.querySelector(`[data-page="${newPage}"]`);
                          pageElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                      }}
                      disabled={currentPage === 1}
                      className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <span className="text-sm font-semibold text-slate-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const newPage = Math.min(totalPages, currentPage + 1);
                        setCurrentPage(newPage);
                        // Scroll to page
                        setTimeout(() => {
                          const pageElement = document.querySelector(`[data-page="${newPage}"]`);
                          pageElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                      }}
                      disabled={currentPage === totalPages}
                      className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    </div>
                  )}

                  {/* PDF Pages as Images - Framed like Secure Viewer */}
                  <div className="mt-3 aspect-[210/297] overflow-auto rounded-lg border-2 border-slate-200 bg-slate-50 shadow-inner min-h-[600px]">
                    <div className="space-y-4 p-4">
                      {pdfPages.map((pageDataUrl, index) => (
                        <div
                          key={index}
                          data-page={index + 1}
                          className={`bg-white rounded shadow-sm ${index + 1 === currentPage ? 'ring-2 ring-blue-500' : ''}`}
                          style={{ display: totalPages > 1 && index + 1 !== currentPage ? 'none' : 'block' }}
                        >
                          <img
                            src={pageDataUrl}
                            alt={`Page ${index + 1}`}
                            className="w-full h-auto"
                            style={{
                              userSelect: 'none',
                              WebkitUserSelect: 'none',
                              pointerEvents: 'none',
                              draggable: false,
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              triggerBlur('Right-click detected');
                              return false;
                            }}
                            onDragStart={(e) => e.preventDefault()}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Description text matching vetting dashboard */}
                  <p className="mt-3 text-xs text-slate-500 text-center">
                    Zoom, scroll, and view from here. Document stays inside the Safe Browser.
                  </p>
                </div>

                {/* Show all pages option for printing */}
                {totalPages > 1 && (
                  <div className="text-center pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        // Show all pages
                        const allPages = document.querySelectorAll('[data-page]');
                        allPages.forEach((page, idx) => {
                          (page as HTMLElement).style.display = 'block';
                        });
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700 underline"
                    >
                      Show all pages for printing
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-600">No PDF content available</p>
              </div>
            )}

            {/* Download Prevention Overlay - blocks interactions */}
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 1 }}
              onContextMenu={(e) => {
                e.preventDefault();
                triggerBlur('Right-click detected');
                return false;
              }}
              onDragStart={(e) => e.preventDefault()}
            />
          </div>
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
