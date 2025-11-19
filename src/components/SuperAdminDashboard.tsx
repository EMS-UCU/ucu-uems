import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { DatabaseUser, ExamPaper } from '../lib/supabase';
import PrivilegeElevationPanel from './PrivilegeElevationPanel';
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

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
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load users from user_profiles
      const { data: usersData } = await supabase
        .from('user_profiles')
        .select('*')
        .order('name', { ascending: true });

      // Load exam papers
      const { data: examsData } = await supabase
        .from('exam_papers')
        .select('*')
        .order('created_at', { ascending: false });

      // Convert to DatabaseUser format
      const dbUsers: DatabaseUser[] = (usersData || []).map((profile: any) => ({
        id: profile.id,
        email: profile.email,
        username: profile.username,
        name: profile.name,
        base_role: profile.base_role,
        roles: profile.roles || [],
        password_hash: '', // Don't expose password
        is_super_admin: profile.is_super_admin || false,
        campus: profile.campus,
        department: profile.department,
        lecturer_category: profile.lecturer_category,
        created_at: profile.created_at || new Date().toISOString(),
        updated_at: profile.updated_at || new Date().toISOString(),
      }));

      setUsers(dbUsers);
      setExamPapers(examsData || []);

      // Calculate stats
      const lecturers = dbUsers.filter((u) => u.base_role === 'Lecturer');
      const admins = dbUsers.filter((u) => u.roles?.includes('Admin'));
      const inProgress = (examsData || []).filter(
        (e) =>
          e.status !== 'approved_for_printing' &&
          e.status !== 'rejected_restart_process' &&
          e.status !== 'draft'
      );

      setStats({
        totalUsers: dbUsers.length,
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

  // Prepare chart data
  const userDistributionData = useMemo(() => {
    const lecturers = users.filter((u) => u.base_role === 'Lecturer');
    const admins = users.filter((u) => u.roles?.includes('Admin'));
    const others = users.length - lecturers.length - admins.length;
    
    const data = [
      { name: 'Lecturers', value: lecturers.length, color: '#ef4444' },
      { name: 'Admins', value: admins.length, color: '#a855f7' },
      { name: 'Others', value: others, color: '#3b82f6' },
    ];
    
    // If all values are 0, return a placeholder
    if (data.every(d => d.value === 0)) {
      return [{ name: 'No Data', value: 1, color: '#e5e7eb' }];
    }
    
    return data;
  }, [users]);

  const examStatusData = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    examPapers.forEach((exam) => {
      const status = exam.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    return Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace(/_/g, ' '),
      value,
      color: name === 'approved_for_printing' ? '#10b981' : 
             name === 'rejected_restart_process' ? '#ef4444' : 
             '#3b82f6',
    }));
  }, [examPapers]);

  const examTrendData = useMemo(() => {
    // Group exams by month
    const monthlyData: Record<string, number> = {};
    examPapers.forEach((exam) => {
      if (exam.created_at) {
        const date = new Date(exam.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
      }
    });
    
    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12) // Last 12 months
      .map(([month, count]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        exams: count,
      }));
  }, [examPapers]);

  const lecturerCategoryData = useMemo(() => {
    const lecturers = users.filter((u) => u.base_role === 'Lecturer');
    const ug = lecturers.filter((u) => u.lecturer_category === 'Undergraduate').length;
    const pg = lecturers.filter((u) => u.lecturer_category === 'Postgraduate').length;
    const uncategorized = lecturers.filter((u) => !u.lecturer_category).length;
    
    const data = [
      { name: 'Undergraduate', value: ug, color: '#10b981' },
      { name: 'Postgraduate', value: pg, color: '#a855f7' },
      { name: 'Uncategorized', value: uncategorized, color: '#64748b' },
    ];
    
    // If all values are 0, return a placeholder
    if (data.every(d => d.value === 0)) {
      return [{ name: 'No Lecturers', value: 1, color: '#e5e7eb' }];
    }
    
    return data;
  }, [users]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 bg-white">
        <div className="text-blue-700">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-white p-6">

      {/* Stats Overview with Smooth Hover Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { key: 'users', label: 'Total Users', value: stats.totalUsers, colorClass: 'text-blue-600', icon: '👥' },
          { key: 'lecturers', label: 'Lecturers', value: stats.totalLecturers, colorClass: 'text-red-600', icon: '👨‍🏫' },
          { key: 'admins', label: 'Admins', value: stats.totalAdmins, colorClass: 'text-purple-600', icon: '🛡️' },
          { key: 'exams', label: 'Total Exams', value: stats.totalExams, colorClass: 'text-blue-600', icon: '📝' },
          { key: 'progress', label: 'In Progress', value: stats.examsInProgress, colorClass: 'text-amber-600', icon: '⏳' },
        ].map((stat) => (
          <motion.div
            key={stat.key}
            className="relative rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md cursor-pointer overflow-hidden"
            onHoverStart={() => setHoveredCard(stat.key)}
            onHoverEnd={() => setHoveredCard(null)}
            whileHover={{ scale: 1.05, y: -5 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-br from-blue-100/50 to-purple-100/50 opacity-0"
              animate={{ opacity: hoveredCard === stat.key ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  {stat.label}
          </p>
                <span className="text-xl">{stat.icon}</span>
        </div>
              <motion.p
                className={`mt-2 text-3xl font-bold ${stat.colorClass}`}
                animate={{ scale: hoveredCard === stat.key ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400 }}
              >
                {stat.value}
              </motion.p>
              {hoveredCard === stat.key && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mt-3 pt-3 border-t border-blue-200"
                >
                  <p className="text-xs text-blue-600">
                    {stat.key === 'users' && 'Total registered users in the system'}
                    {stat.key === 'lecturers' && 'Active lecturers across all categories'}
                    {stat.key === 'admins' && 'Users with admin privileges'}
                    {stat.key === 'exams' && 'Total exam papers created'}
                    {stat.key === 'progress' && 'Exams currently in workflow'}
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Animated Spinning Donut Chart - User Distribution */}
        <motion.div
          className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-blue-900">User Distribution</h2>
            <span className="text-blue-600">👥</span>
          </div>
          <p className="text-xs text-blue-600 mb-3">System Overview</p>
          <div className="relative h-56 w-full" style={{ minHeight: '224px' }}>
            <motion.div
              initial={{ rotate: -720, scale: 0.3, opacity: 0 }}
              animate={{ 
                rotate: [0, -360, -720, 0],
                scale: [0.3, 0.8, 1.15, 1],
                opacity: [0, 0.5, 1, 1]
              }}
              transition={{ 
                duration: 2.5,
                ease: [0.4, 0, 0.2, 1],
                times: [0, 0.4, 0.8, 1]
              }}
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie
                    data={userDistributionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    innerRadius={65}
                    fill="#8884d8"
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={1500}
                  >
                    {userDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '2px solid #3b82f6',
                      borderRadius: '8px',
                      padding: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </motion.div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-900">{stats.totalUsers}</div>
                <div className="text-xs text-blue-600 mt-0.5">Total Users</div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {userDistributionData.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-sm text-blue-700">
                  {entry.name} {entry.value}
                </span>
        </div>
            ))}
        </div>
        </motion.div>

        {/* Animated Spinning Donut Chart - Lecturer Categories */}
        <motion.div
          className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-blue-900">Lecturer Categories</h2>
            <span className="text-blue-600">👨‍🏫</span>
          </div>
          <p className="text-xs text-blue-600 mb-3">Staff Overview</p>
          <div className="relative h-56 w-full" style={{ minHeight: '224px' }}>
            <motion.div
              initial={{ rotate: 720, scale: 0.3, opacity: 0 }}
              animate={{ 
                rotate: [0, 360, 720, 0],
                scale: [0.3, 0.8, 1.15, 1],
                opacity: [0, 0.5, 1, 1]
              }}
              transition={{ 
                duration: 2.5,
                ease: [0.4, 0, 0.2, 1],
                times: [0, 0.4, 0.8, 1],
                delay: 0.1
              }}
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie
                    data={lecturerCategoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    innerRadius={65}
                    fill="#8884d8"
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={1500}
                  >
                    {lecturerCategoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '2px solid #3b82f6',
                      borderRadius: '8px',
                      padding: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </motion.div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-900">{stats.totalLecturers}</div>
                <div className="text-xs text-blue-600 mt-0.5">Total Lecturers</div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {lecturerCategoryData.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-sm text-blue-700">
                  {entry.name} {entry.value}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Thick Line Graph - Exam Trends */}
      <motion.div
        className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <h2 className="text-xl font-semibold text-blue-900 mb-4">Exam Trends Over Time</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={examTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
              <XAxis
                dataKey="month"
                stroke="#3b82f6"
                style={{ fontSize: '12px', fontWeight: '600' }}
              />
              <YAxis
                stroke="#3b82f6"
                style={{ fontSize: '12px', fontWeight: '600' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '2px solid #3b82f6',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="exams"
                stroke="#3b82f6"
                strokeWidth={6}
                dot={{ fill: '#3b82f6', r: 6 }}
                activeDot={{ r: 8 }}
                name="Exams Created"
                animationDuration={1000}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Exam Status Distribution Donut Chart */}
      {examStatusData.length > 0 && (
        <motion.div
          className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-blue-900">Exam Status Distribution</h2>
            <span className="text-blue-600">📝</span>
          </div>
          <p className="text-xs text-blue-600 mb-3">Financial Overview</p>
          <div className="relative h-56 w-full" style={{ minHeight: '224px' }}>
            <motion.div
              initial={{ rotate: -720, scale: 0.3, opacity: 0 }}
              animate={{ 
                rotate: [0, -360, -720, 0],
                scale: [0.3, 0.8, 1.15, 1],
                opacity: [0, 0.5, 1, 1]
              }}
              transition={{ 
                duration: 2.5,
                ease: [0.4, 0, 0.2, 1],
                times: [0, 0.4, 0.8, 1],
                delay: 0.3
              }}
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie
                    data={examStatusData.length > 0 ? examStatusData : [{ name: 'No Exams', value: 1, color: '#e5e7eb' }]}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    innerRadius={65}
                    fill="#8884d8"
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={1500}
                  >
                    {(examStatusData.length > 0 ? examStatusData : [{ name: 'No Exams', value: 1, color: '#e5e7eb' }]).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '2px solid #3b82f6',
                      borderRadius: '8px',
                      padding: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </motion.div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-900">{stats.totalExams}</div>
                <div className="text-xs text-blue-600 mt-0.5">Total Exams</div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {examStatusData.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-sm text-blue-700">
                  {entry.name} {entry.value}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Lecturers by Category */}
      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <h2 className="text-xl font-semibold text-blue-900 mb-4">Lecturers by Category</h2>
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {/* Undergraduate Lecturers */}
          <div className="rounded-xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-green-900">Undergraduate Lecturers</h3>
              <span className="text-xs font-semibold text-green-700 bg-green-500/20 px-3 py-1 rounded-full">
                UG
              </span>
            </div>
            <p className="text-3xl font-bold text-green-700 mb-2">
              {users.filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Undergraduate').length}
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {users
                .filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Undergraduate')
                .map((lecturer, index) => (
                  <motion.div
                    key={lecturer.id}
                    className="group relative rounded-xl border-2 border-green-200 bg-gradient-to-br from-white to-green-50/30 p-4 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                  >
                    {/* Animated background gradient on hover */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-green-100/0 to-green-100/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      initial={false}
                    />
                    
                    <div className="relative z-10 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Avatar/Icon */}
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                            {lecturer.name?.charAt(0)?.toUpperCase() || 'L'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-green-900 truncate">{lecturer.name}</p>
                    {lecturer.department && (
                              <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {lecturer.department}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Roles and Privileges */}
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {lecturer.roles && lecturer.roles.length > 0 ? (
                              lecturer.roles.map((role) => (
                                <motion.span
                          key={role}
                                  className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-300 font-medium shadow-sm"
                                  whileHover={{ scale: 1.1 }}
                        >
                          {role}
                                </motion.span>
                              ))
                            ) : (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                No roles
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            {lecturer.roles?.length || 0} privileges
                          </div>
                        </div>
                      </div>
                      
                      {/* UG Badge */}
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 text-white text-xs font-bold shadow-md">
                          UG
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              {users.filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Undergraduate').length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-3">
                    <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-green-600 font-medium">No undergraduate lecturers yet</p>
                </motion.div>
              )}
            </div>
          </div>

          {/* Postgraduate Lecturers */}
          <div className="rounded-xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-purple-900">Postgraduate Lecturers</h3>
              <span className="text-xs font-semibold text-purple-700 bg-purple-500/20 px-3 py-1 rounded-full">
                PG
              </span>
            </div>
            <p className="text-3xl font-bold text-purple-700 mb-2">
              {users.filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Postgraduate').length}
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {users
                .filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Postgraduate')
                .map((lecturer, index) => (
                  <motion.div
                    key={lecturer.id}
                    className="group relative rounded-xl border-2 border-purple-200 bg-gradient-to-br from-white to-purple-50/30 p-4 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                  >
                    {/* Animated background gradient on hover */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-purple-100/0 to-purple-100/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      initial={false}
                    />
                    
                    <div className="relative z-10 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Avatar/Icon */}
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                            {lecturer.name?.charAt(0)?.toUpperCase() || 'L'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-purple-900 truncate">{lecturer.name}</p>
                    {lecturer.department && (
                              <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {lecturer.department}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Roles and Privileges */}
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {lecturer.roles && lecturer.roles.length > 0 ? (
                              lecturer.roles.map((role) => (
                                <motion.span
                          key={role}
                                  className="text-xs px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 border border-purple-300 font-medium shadow-sm"
                                  whileHover={{ scale: 1.1 }}
                        >
                          {role}
                                </motion.span>
                              ))
                            ) : (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                No roles
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-1 rounded-full border border-purple-200">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            {lecturer.roles?.length || 0} privileges
                          </div>
                        </div>
                      </div>
                      
                      {/* PG Badge */}
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-white text-xs font-bold shadow-md">
                          PG
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              {users.filter((u) => u.base_role === 'Lecturer' && u.lecturer_category === 'Postgraduate').length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 mb-3">
                    <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-purple-600 font-medium">No postgraduate lecturers yet</p>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Uncategorized Lecturers */}
        {users.filter((u) => u.base_role === 'Lecturer' && !u.lecturer_category).length > 0 && (
          <div className="rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-900">Uncategorized Lecturers</h3>
              <span className="text-xs font-semibold text-slate-600 bg-slate-200 px-3 py-1 rounded-full">
                {users.filter((u) => u.base_role === 'Lecturer' && !u.lecturer_category).length}
              </span>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              These lecturers need to be assigned to a category (Undergraduate or Postgraduate)
            </p>
            <div className="space-y-3 max-h-48 overflow-y-auto">
              {users
                .filter((u) => u.base_role === 'Lecturer' && !u.lecturer_category)
                .map((lecturer, index) => (
                  <motion.div
                    key={lecturer.id}
                    className="group relative rounded-xl border-2 border-slate-200 bg-gradient-to-br from-white to-slate-50/30 p-4 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                  >
                    {/* Animated background gradient on hover */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-amber-100/0 to-amber-100/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      initial={false}
                    />
                    
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                        {lecturer.name?.charAt(0)?.toUpperCase() || 'L'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{lecturer.name}</p>
                    {lecturer.department && (
                          <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            {lecturer.department}
                          </p>
                        )}
                        <div className="mt-2">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Needs categorization
                          </span>
                        </div>
                      </div>
                  </div>
                  </motion.div>
                ))}
            </div>
          </div>
        )}
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
          {examPapers.slice(0, 10).map((exam, index) => (
            <motion.div
              key={exam.id}
              className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 cursor-pointer overflow-hidden relative"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ scale: 1.02, x: 5 }}
              onHoverStart={() => setHoveredCard(`exam-${exam.id}`)}
              onHoverEnd={() => setHoveredCard(null)}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-blue-100/50 to-purple-100/50"
                initial={{ x: '-100%' }}
                animate={{ x: hoveredCard === `exam-${exam.id}` ? '0%' : '-100%' }}
                transition={{ duration: 0.3 }}
              />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900">
                    {exam.course_code} - {exam.course_name}
                  </h3>
                  <p className="text-sm text-blue-700">
                    {exam.semester} {exam.academic_year} • {exam.campus}
                  </p>
                  {hoveredCard === `exam-${exam.id}` && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 pt-2 border-t border-blue-200"
                    >
                      <p className="text-xs text-blue-600">
                        Created: {exam.created_at ? new Date(exam.created_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </motion.div>
                  )}
                </div>
                <div className="text-right ml-4">
                  <motion.span
                    className={`rounded-full px-3 py-1 text-xs font-semibold inline-block ${
                      exam.status === 'approved_for_printing'
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : exam.status === 'rejected_restart_process'
                        ? 'bg-red-100 text-red-700 border border-red-300'
                        : 'bg-blue-100 text-blue-700 border border-blue-300'
                    }`}
                    whileHover={{ scale: 1.1 }}
                  >
                    {exam.status.replace(/_/g, ' ')}
                  </motion.span>
                </div>
              </div>
            </motion.div>
          ))}
          {examPapers.length === 0 && (
            <p className="text-center text-blue-600 py-8">No exam papers yet</p>
          )}
        </div>
      </div>
    </div>
  );
}





