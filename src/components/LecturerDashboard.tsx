import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { motion } from 'framer-motion';

interface LecturerDashboardProps {
  currentUserId: string;
  userRoles: string[];
  baseRole: 'Admin' | 'Lecturer';
}

interface ClassData {
  id: string;
  code: string;
  name: string;
  students: number;
  schedule: string;
}

export default function LecturerDashboard({
  currentUserId: _currentUserId,
}: LecturerDashboardProps) {
  const [classes] = useState<ClassData[]>([
    { id: '1', code: 'CSC 302', name: 'Advanced Algorithms', students: 45, schedule: 'Mon • 10:00 — 12:00' },
    { id: '2', code: 'CSC 301', name: 'Data Structures', students: 38, schedule: 'Wed • 14:00 — 16:00' },
    { id: '3', code: 'CSC 303', name: 'Database Systems', students: 42, schedule: 'Fri • 09:00 — 11:00' },
  ]);

  const [attendanceData] = useState([
    { name: 'Present', value: 85, color: '#10b981' },
    { name: 'Absent', value: 10, color: '#ef4444' },
    { name: 'Late', value: 5, color: '#f59e0b' },
  ]);

  const [gradeDistribution] = useState([
    { name: 'A (90-100)', value: 25, color: '#10b981' },
    { name: 'B (80-89)', value: 35, color: '#3b82f6' },
    { name: 'C (70-79)', value: 20, color: '#f59e0b' },
    { name: 'D (60-69)', value: 15, color: '#f97316' },
    { name: 'F (<60)', value: 5, color: '#ef4444' },
  ]);

  const [pendingMarks] = useState(12);
  const [totalStudents] = useState(125);
  const [upcomingClasses] = useState(3);

  // Animation for spinning pie charts
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setRotation((prev) => (prev + 1) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);


  return (
    <div className="space-y-6 bg-gradient-to-br from-slate-50 to-blue-50 p-6 min-h-screen">

      {/* Quick Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="group relative overflow-hidden rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-200 opacity-20 blur-2xl"></div>
          <div className="relative z-10">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-emerald-700">{totalStudents}</p>
            <p className="mt-1 text-sm font-semibold text-emerald-600">Total Students</p>
      </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="group relative overflow-hidden rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-blue-200 opacity-20 blur-2xl"></div>
          <div className="relative z-10">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-blue-700">{classes.length}</p>
            <p className="mt-1 text-sm font-semibold text-blue-600">Active Classes</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="group relative overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-amber-200 opacity-20 blur-2xl"></div>
          <div className="relative z-10">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-md">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-amber-700">{pendingMarks}</p>
            <p className="mt-1 text-sm font-semibold text-amber-600">Pending Marks</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="group relative overflow-hidden rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-purple-200 opacity-20 blur-2xl"></div>
          <div className="relative z-10">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-md">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-purple-700">{upcomingClasses}</p>
            <p className="mt-1 text-sm font-semibold text-purple-600">Upcoming Classes</p>
          </div>
        </motion.div>
      </div>

      {/* Pie Charts Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Attendance Chart */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="rounded-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-white p-6 shadow-lg"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-green-900">Attendance Overview</h3>
              <p className="text-sm text-green-600">Current semester statistics</p>
                        </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
                      </div>
                    </div>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendanceData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  animationDuration={1000}
                  startAngle={rotation}
                >
                  {attendanceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {attendanceData.map((item) => (
              <div key={item.name} className="rounded-lg bg-white p-2 text-center">
                <p className="text-xs font-semibold text-slate-600">{item.name}</p>
                <p className="text-lg font-bold" style={{ color: item.color }}>
                  {item.value}%
                </p>
              </div>
            ))}
            </div>
        </motion.div>

        {/* Grade Distribution Chart */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6 }}
          className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-lg"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-blue-900">Grade Distribution</h3>
              <p className="text-sm text-blue-600">Performance breakdown</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
      </div>
          </div>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gradeDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  animationDuration={1000}
                  startAngle={-rotation}
                >
                  {gradeDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
        </div>
          <div className="mt-4 grid grid-cols-5 gap-1">
            {gradeDistribution.map((item) => (
              <div key={item.name} className="rounded-lg bg-white p-2 text-center">
                <p className="text-xs font-semibold" style={{ color: item.color }}>
                  {item.name.split(' ')[0]}
                </p>
                <p className="text-sm font-bold" style={{ color: item.color }}>
                  {item.value}%
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Quick Access Cards */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-slate-800">Quick Access</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* My Classes Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-indigo-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-indigo-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {classes.length} Classes
                </span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-indigo-900">My Classes</h3>
              <p className="mb-4 text-sm text-indigo-600">View and manage your assigned courses</p>
              <div className="space-y-2">
                {classes.slice(0, 2).map((classItem) => (
                  <div key={classItem.id} className="rounded-lg bg-white p-2">
                    <p className="text-xs font-semibold text-indigo-700">{classItem.code}</p>
                    <p className="text-xs text-indigo-600">{classItem.students} students</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Scheduling Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-rose-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                  {upcomingClasses} Upcoming
                </span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-rose-900">See Timetable</h3>
              <p className="mb-4 text-sm text-rose-600">Manage your class schedule and office hours</p>
              <div className="space-y-2">
                {classes.slice(0, 2).map((classItem) => (
                  <div key={classItem.id} className="rounded-lg bg-white p-2">
                    <p className="text-xs font-semibold text-rose-700">{classItem.schedule}</p>
                    <p className="text-xs text-rose-600">{classItem.code}</p>
          </div>
        ))}
      </div>
    </div>
          </motion.div>

          {/* Enter Marks Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                  {pendingMarks} Pending
                </span>
          </div>
              <h3 className="mb-2 text-lg font-bold text-amber-900">Enter Marks</h3>
              <p className="mb-4 text-sm text-amber-600">Record student assessment marks and grades</p>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-semibold text-amber-700">Quick Actions</p>
                <p className="text-xs text-amber-600">Click to enter marks for your classes</p>
        </div>
      </div>
          </motion.div>

          {/* Search Student Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-teal-200 bg-gradient-to-br from-teal-50 via-white to-teal-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-teal-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
                  Search
                </span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-teal-900">Search Student</h3>
              <p className="mb-4 text-sm text-teal-600">Lookup students by access number or name</p>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-semibold text-teal-700">Access Number Format</p>
                <p className="text-xs text-teal-600">a001, a002, a003...</p>
              </div>
            </div>
          </motion.div>

          {/* Monthly Reports Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-violet-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-violet-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                  Reports
                </span>
          </div>
              <h3 className="mb-2 text-lg font-bold text-violet-900">Make Reports</h3>
              <p className="mb-4 text-sm text-violet-600">Generate monthly attendance and grading reports</p>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-semibold text-violet-700">Available Reports</p>
                <p className="text-xs text-violet-600">Attendance • Grading • Curriculum</p>
      </div>
    </div>
          </motion.div>

          {/* Account Settings Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
            className="group relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 p-6 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-slate-200 opacity-10 blur-3xl"></div>
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Settings
                </span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900">Account Settings</h3>
              <p className="mb-4 text-sm text-slate-600">Manage your profile and preferences</p>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">Profile & Security</p>
                <p className="text-xs text-slate-600">Update your information</p>
              </div>
            </div>
          </motion.div>
          </div>
      </div>
    </div>
  );
}
