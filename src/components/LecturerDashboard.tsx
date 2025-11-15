import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { ExamPaper, Notification } from '../lib/supabase';
import {
  getSetterExams,
  createExamPaper,
  submitExamToRepository,
} from '../lib/examServices/examSubmission';
import {
  getTeamLeadExams,
  getExamsForIntegration,
  integrateExams,
  sendToChiefExaminer,
} from '../lib/examServices/teamLeadService';
import {
  getChiefExaminerExams,
  appointVetters,
  approveExamForPrinting,
  rejectExamAndRestart,
} from '../lib/examServices/chiefExaminerService';
import {
  getVetterSessions,
  startVettingSession,
  addVettingComment,
  completeVettingSession,
  getVettingComments,
} from '../lib/examServices/vettingService';
import {
  startRevision,
  submitRevisedExam,
  getUnaddressedComments,
} from '../lib/examServices/revisionService';
import { getUserNotifications, getUnreadCount } from '../lib/examServices/notificationService';

interface LecturerDashboardProps {
  currentUserId: string;
  userRoles: string[];
  baseRole: 'Admin' | 'Lecturer';
}

export default function LecturerDashboard({
  currentUserId,
  userRoles,
  baseRole,
}: LecturerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'setter' | 'teamlead' | 'chief' | 'vetter' | 'revision'>('overview');
  const [exams, setExams] = useState<ExamPaper[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const isSetter = userRoles.includes('Setter');
  const isTeamLead = userRoles.includes('Team Lead');
  const isChiefExaminer = userRoles.includes('Chief Examiner');
  const isVetter = userRoles.includes('Vetter');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load notifications
      const notifs = await getUserNotifications(currentUserId, true);
      const count = await getUnreadCount(currentUserId);
      setNotifications(notifs);
      setUnreadCount(count);

      // Load exams based on role
      if (isSetter && activeTab === 'setter') {
        const setterExams = await getSetterExams(currentUserId);
        setExams(setterExams);
      } else if (isTeamLead && activeTab === 'teamlead') {
        const teamLeadExams = await getTeamLeadExams(currentUserId);
        setExams(teamLeadExams);
      } else if (isChiefExaminer && activeTab === 'chief') {
        const chiefExams = await getChiefExaminerExams(currentUserId);
        setExams(chiefExams);
      } else if (isVetter && activeTab === 'vetter') {
        // Vetters see their assigned sessions, not direct exams
        setExams([]);
      } else if (activeTab === 'revision' && isTeamLead) {
        const teamLeadExams = await getTeamLeadExams(currentUserId);
        setExams(teamLeadExams.filter((e) => e.status === 'vetted_with_comments'));
      } else {
        // Overview - show all relevant exams
        const allExams: ExamPaper[] = [];
        if (isSetter) {
          const setterExams = await getSetterExams(currentUserId);
          allExams.push(...setterExams);
        }
        if (isTeamLead) {
          const teamLeadExams = await getTeamLeadExams(currentUserId);
          allExams.push(...teamLeadExams);
        }
        if (isChiefExaminer) {
          const chiefExams = await getChiefExaminerExams(currentUserId);
          allExams.push(...chiefExams);
        }
        setExams(allExams);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 bg-white p-6">
      {/* Dashboard Label */}
      <div className="flex items-center justify-between rounded-xl border-2 border-red-600 bg-gradient-to-r from-red-50 to-pink-50 p-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-red-900">Lecturer Dashboard</h1>
            <p className="text-sm text-blue-700">Teaching & Exam Management</p>
          </div>
        </div>
        <div className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
          LECTURER
        </div>
      </div>

      {/* Notifications */}
      {unreadCount > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-amber-900">
                You have {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
              </h3>
            </div>
            <button
              onClick={() => setActiveTab('overview')}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              View
            </button>
          </div>
        </div>
      )}

      {/* Role Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-semibold transition ${
            activeTab === 'overview'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-blue-700 hover:text-blue-800'
          }`}
        >
          Overview
        </button>
        {isSetter && (
          <button
            onClick={() => setActiveTab('setter')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'setter'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-blue-700 hover:text-blue-800'
            }`}
          >
            Setter ({exams.filter((e) => e.status === 'draft' || e.status === 'submitted_to_repository').length})
          </button>
        )}
        {isTeamLead && (
          <>
            <button
              onClick={() => setActiveTab('teamlead')}
              className={`px-4 py-2 text-sm font-semibold transition ${
                activeTab === 'teamlead'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-blue-700 hover:text-blue-800'
              }`}
            >
              Team Lead
            </button>
            <button
              onClick={() => setActiveTab('revision')}
              className={`px-4 py-2 text-sm font-semibold transition ${
                activeTab === 'revision'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-blue-700 hover:text-blue-800'
              }`}
            >
              Revision
            </button>
          </>
        )}
        {isChiefExaminer && (
          <button
            onClick={() => setActiveTab('chief')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'chief'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-blue-700 hover:text-blue-800'
            }`}
          >
            Chief Examiner
          </button>
        )}
        {isVetter && (
          <button
            onClick={() => setActiveTab('vetter')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'vetter'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-blue-700 hover:text-blue-800'
            }`}
          >
            Vetter
          </button>
        )}
      </div>

      {/* Content based on active tab */}
      {loading ? (
        <div className="flex items-center justify-center p-12 bg-white">
          <div className="text-blue-700">Loading...</div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
          {activeTab === 'overview' && (
            <div>
              <h2 className="text-xl font-semibold text-blue-900 mb-4">My Exams</h2>
              <div className="space-y-3">
                {exams.length === 0 ? (
                  <p className="text-center text-blue-600 py-8">No exams assigned</p>
                ) : (
                  exams.map((exam) => (
                    <div
                      key={exam.id}
                      className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-blue-900">
                            {exam.course_code} - {exam.course_name}
                          </h3>
                          <p className="text-sm text-blue-700">
                            {exam.semester} {exam.academic_year} • Status: {exam.status.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold border-2 ${
                            exam.status === 'approved_for_printing'
                              ? 'bg-green-100 text-green-800 border-green-300'
                              : exam.status === 'rejected_restart_process'
                              ? 'bg-red-100 text-red-800 border-red-300'
                              : 'bg-blue-100 text-blue-800 border-blue-300'
                          }`}
                        >
                          {exam.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Setter View */}
          {activeTab === 'setter' && isSetter && (
            <SetterView currentUserId={currentUserId} exams={exams} onRefresh={loadData} />
          )}

          {/* Team Lead View */}
          {activeTab === 'teamlead' && isTeamLead && (
            <TeamLeadView currentUserId={currentUserId} exams={exams} onRefresh={loadData} />
          )}

          {/* Chief Examiner View */}
          {activeTab === 'chief' && isChiefExaminer && (
            <ChiefExaminerView currentUserId={currentUserId} exams={exams} onRefresh={loadData} />
          )}

          {/* Vetter View */}
          {activeTab === 'vetter' && isVetter && (
            <VetterView currentUserId={currentUserId} onRefresh={loadData} />
          )}

          {/* Revision View */}
          {activeTab === 'revision' && isTeamLead && (
            <RevisionView currentUserId={currentUserId} exams={exams} onRefresh={loadData} />
          )}
        </div>
      )}
    </div>
  );
}

// Setter View Component
function SetterView({
  currentUserId,
  exams,
  onRefresh,
}: {
  currentUserId: string;
  exams: ExamPaper[];
  onRefresh: () => void;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    course_code: '',
    course_name: '',
    semester: '',
    academic_year: '',
    campus: '',
    deadline: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createExamPaper({
        ...formData,
        setter_id: currentUserId,
      });
      if (result.success) {
        setShowCreateForm(false);
        setFormData({
          course_code: '',
          course_name: '',
          semester: '',
          academic_year: '',
          campus: '',
          deadline: '',
        });
        onRefresh();
      }
    } catch (error) {
      console.error('Error creating exam:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (examId: string, file: File) => {
    // In a real app, upload to Supabase Storage
    // For now, we'll use a placeholder
    const fileUrl = URL.createObjectURL(file);
    const result = await submitExamToRepository(
      examId,
      fileUrl,
      file.name,
      file.size,
      currentUserId
    );
    if (result.success) {
      onRefresh();
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-blue-900">My Exam Papers</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          {showCreateForm ? 'Cancel' : 'Create New Exam'}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-6 rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md">
          <h3 className="font-semibold text-blue-900 mb-4">Create Exam Paper</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <input
              type="text"
              placeholder="Course Code"
              value={formData.course_code}
              onChange={(e) => setFormData({ ...formData, course_code: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Course Name"
              value={formData.course_name}
              onChange={(e) => setFormData({ ...formData, course_name: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Semester"
              value={formData.semester}
              onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Academic Year"
              value={formData.academic_year}
              onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Campus"
              value={formData.campus}
              onChange={(e) => setFormData({ ...formData, campus: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
            <input
              type="datetime-local"
              placeholder="Deadline"
              value={formData.deadline}
              onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
              className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2 text-blue-900 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={submitting}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Exam'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {exams.map((exam) => (
          <div
            key={exam.id}
            className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-blue-900">
                  {exam.course_code} - {exam.course_name}
                </h3>
                <p className="text-sm text-blue-700">
                  {exam.semester} {exam.academic_year} • {exam.campus}
                </p>
                {exam.deadline && (
                  <p className="text-xs text-amber-700 mt-1 font-semibold">
                    Deadline: {new Date(exam.deadline).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold border-2 ${
                    exam.status === 'submitted_to_repository'
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}
                >
                  {exam.status.replace(/_/g, ' ')}
                </span>
                {exam.status === 'draft' && (
                  <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 shadow-md transition-all">
                    Upload File
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(exam.id, file);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        ))}
        {exams.length === 0 && (
          <p className="text-center text-blue-600 py-8">No exam papers created yet</p>
        )}
      </div>
    </div>
  );
}

// Team Lead View Component
function TeamLeadView({
  currentUserId,
  exams,
  onRefresh,
}: {
  currentUserId: string;
  exams: ExamPaper[];
  onRefresh: () => void;
}) {
  const [examsForIntegration, setExamsForIntegration] = useState<ExamPaper[]>([]);
  const [selectedExams, setSelectedExams] = useState<string[]>([]);

  useEffect(() => {
    loadExamsForIntegration();
  }, []);

  const loadExamsForIntegration = async () => {
    const exams = await getExamsForIntegration();
    setExamsForIntegration(exams);
  };

  const handleIntegrate = async () => {
    if (selectedExams.length === 0) return;
    // In real app, upload integrated file
    const result = await integrateExams(
      selectedExams,
      'integrated-file-url',
      'integrated-exam.pdf',
      currentUserId
    );
    if (result.success) {
      onRefresh();
      loadExamsForIntegration();
      setSelectedExams([]);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-blue-900 mb-4">Team Lead Dashboard</h2>
      <div className="space-y-4">
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md">
          <h3 className="font-semibold text-blue-900 mb-3">Exams Ready for Integration</h3>
          <div className="space-y-2">
            {examsForIntegration.map((exam) => (
              <label
                key={exam.id}
                className="flex items-center gap-3 rounded-xl border-2 border-blue-200 bg-white p-3 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-all"
              >
                <input
                  type="checkbox"
                  checked={selectedExams.includes(exam.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedExams([...selectedExams, exam.id]);
                    } else {
                      setSelectedExams(selectedExams.filter((id) => id !== exam.id));
                    }
                  }}
                />
                <div className="flex-1">
                  <p className="font-semibold text-blue-900">
                    {exam.course_code} - {exam.course_name}
                  </p>
                  <p className="text-sm text-blue-700">{exam.campus}</p>
                </div>
              </label>
            ))}
          </div>
          {selectedExams.length > 0 && (
            <button
              onClick={handleIntegrate}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Integrate Selected ({selectedExams.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Chief Examiner View Component
function ChiefExaminerView({
  currentUserId,
  exams,
  onRefresh,
}: {
  currentUserId: string;
  exams: ExamPaper[];
  onRefresh: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-blue-900 mb-4">Chief Examiner Dashboard</h2>
      <div className="space-y-3">
        {exams.map((exam) => (
          <div
            key={exam.id}
            className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-blue-900">
                  {exam.course_code} - {exam.course_name}
                </h3>
                <p className="text-sm text-blue-700">Status: {exam.status.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex gap-2">
                {exam.status === 'sent_to_chief_examiner' && (
                  <button className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">
                    Appoint Vetters
                  </button>
                )}
                {exam.status === 'resubmitted_to_chief_examiner' && (
                  <>
                    <button className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                      Approve
                    </button>
                    <button className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500">
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vetter View Component
function VetterView({
  currentUserId,
  onRefresh,
}: {
  currentUserId: string;
  onRefresh: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-blue-900 mb-4">Vetter Dashboard</h2>
      <p className="text-blue-700">Your assigned vetting sessions will appear here</p>
    </div>
  );
}

// Revision View Component
function RevisionView({
  currentUserId,
  exams,
  onRefresh,
}: {
  currentUserId: string;
  exams: ExamPaper[];
  onRefresh: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-blue-900 mb-4">Revision Dashboard</h2>
      <div className="space-y-3">
        {exams.map((exam) => (
          <div
            key={exam.id}
            className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-blue-900">
                  {exam.course_code} - {exam.course_name}
                </h3>
                <p className="text-sm text-blue-700">Ready for revision</p>
              </div>
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                Start Revision
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}





