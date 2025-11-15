import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { DatabaseUser, ExamPaper } from '../lib/supabase';
import PrivilegeElevationPanel from './PrivilegeElevationPanel';

interface SuperAdminDashboardProps {
  currentUserId: string;
  isSuperAdmin: boolean;
}

export default function SuperAdminDashboard({
  currentUserId,
  isSuperAdmin,
}: SuperAdminDashboardProps) {
  const [users, setUsers] = useState<DatabaseUser[]>([]);
  const [examPapers, setExamPapers] = useState<ExamPaper[]>([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalLecturers: 0,
    totalAdmins: 0,
    totalExams: 0,
    examsInProgress: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load users
      const { data: usersData } = await supabase
        .from('users')
        .select('*')
        .order('name', { ascending: true });

      // Load exam papers
      const { data: examsData } = await supabase
        .from('exam_papers')
        .select('*')
        .order('created_at', { ascending: false });

      setUsers(usersData || []);
      setExamPapers(examsData || []);

      // Calculate stats
      const lecturers = (usersData || []).filter((u) => u.base_role === 'Lecturer');
      const admins = (usersData || []).filter((u) => u.roles?.includes('Admin'));
      const inProgress = (examsData || []).filter(
        (e) =>
          e.status !== 'approved_for_printing' &&
          e.status !== 'rejected_restart_process' &&
          e.status !== 'draft'
      );

      setStats({
        totalUsers: usersData?.length || 0,
        totalLecturers: lecturers.length,
        totalAdmins: admins.length,
        totalExams: examsData?.length || 0,
        examsInProgress: inProgress.length,
      });
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 bg-white">
        <div className="text-blue-700">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-white p-6">
      {/* Dashboard Label */}
      <div className="flex items-center justify-between rounded-xl border-2 border-blue-600 bg-gradient-to-r from-blue-50 to-purple-50 p-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-blue-900">Super Admin Dashboard</h1>
            <p className="text-sm text-blue-700">System Administration & Management</p>
          </div>
        </div>
        <div className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
          SUPER ADMIN
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all hover:border-blue-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Total Users
          </p>
          <p className="mt-2 text-2xl font-bold text-blue-600">{stats.totalUsers}</p>
        </div>
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all hover:border-blue-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Lecturers
          </p>
          <p className="mt-2 text-2xl font-bold text-red-600">{stats.totalLecturers}</p>
        </div>
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all hover:border-blue-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Admins
          </p>
          <p className="mt-2 text-2xl font-bold text-purple-600">{stats.totalAdmins}</p>
        </div>
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all hover:border-blue-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Total Exams
          </p>
          <p className="mt-2 text-2xl font-bold text-blue-600">{stats.totalExams}</p>
        </div>
        <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md hover:shadow-lg transition-all hover:border-blue-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            In Progress
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-600">{stats.examsInProgress}</p>
        </div>
      </div>

      {/* Privilege Elevation */}
      <PrivilegeElevationPanel
        currentUserId={currentUserId}
        isSuperAdmin={isSuperAdmin}
        isChiefExaminer={false}
      />

      {/* Recent Exam Papers */}
      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <h2 className="text-xl font-semibold text-blue-900 mb-4">Recent Exam Papers</h2>
        <div className="space-y-3">
          {examPapers.slice(0, 10).map((exam) => (
            <div
              key={exam.id}
              className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 hover:shadow-lg transition-all hover:border-blue-300"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-blue-900">
                    {exam.course_code} - {exam.course_name}
                  </h3>
                  <p className="text-sm text-blue-700">
                    {exam.semester} {exam.academic_year} • {exam.campus}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      exam.status === 'approved_for_printing'
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : exam.status === 'rejected_restart_process'
                        ? 'bg-red-100 text-red-700 border border-red-300'
                        : 'bg-blue-100 text-blue-700 border border-blue-300'
                    }`}
                  >
                    {exam.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {examPapers.length === 0 && (
            <p className="text-center text-blue-600 py-8">No exam papers yet</p>
          )}
        </div>
      </div>
    </div>
  );
}





