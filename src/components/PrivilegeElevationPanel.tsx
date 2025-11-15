import { useState, useEffect } from 'react';
import { elevateToChiefExaminer, appointRole, revokeRole, getPrivilegeHistory } from '../lib/privilegeElevation';
import { supabase } from '../lib/supabase';
import type { DatabaseUser } from '../lib/supabase';

interface PrivilegeElevationPanelProps {
  currentUserId: string;
  isSuperAdmin: boolean;
  isChiefExaminer: boolean;
}

export default function PrivilegeElevationPanel({
  currentUserId,
  isSuperAdmin,
  isChiefExaminer,
}: PrivilegeElevationPanelProps) {
  const [lecturers, setLecturers] = useState<DatabaseUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'Chief Examiner' | 'Vetter' | 'Team Lead' | 'Setter'>('Chief Examiner');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Chief Examiner assignment details
  const [faculty, setFaculty] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [course, setCourse] = useState<string>('');
  const [semester, setSemester] = useState<string>('');
  const [year, setYear] = useState<string>('');

  // Dropdown options
  const faculties = [
    'Faculty of Engineering, Design and Technology'
  ];

  const departments = [
    'Computing and Technology'
  ];

  const courses = [
    'Bachelors of Science in Information Technology',
    'Bachelors of Science in Computer Science',
    'Bachelors of Science in Data Science and Analytics',
    'Diploma in Information Technology and Entrepreneurship',
    'Bachelors of Science in Electronics and Communications Engineering'
  ];

  const semesters = [
    'Trinity',
    'Easter',
    'Advent'
  ];

  // Generate years for the next 5 years
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => String(currentYear + i));

  useEffect(() => {
    loadLecturers();
  }, []);

  const loadLecturers = async () => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('base_role', 'Lecturer')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error loading lecturers:', error);
        setMessage({ type: 'error', text: `Failed to load lecturers: ${error.message}` });
        return;
      }

      // Convert user_profiles to DatabaseUser format
      const lecturersData: DatabaseUser[] = (data || []).map((profile: any) => ({
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

      setLecturers(lecturersData);
      
      if (lecturersData.length === 0) {
        setMessage({ type: 'error', text: 'No lecturers found in the system' });
      }
    } catch (error: any) {
      console.error('Error loading lecturers:', error);
      setMessage({ type: 'error', text: `Error loading lecturers: ${error.message || 'Unknown error'}` });
    }
  };

  const handleElevate = async () => {
    if (!selectedUserId) {
      setMessage({ type: 'error', text: 'Please select a lecturer' });
      return;
    }

    // Validate Chief Examiner fields
    if (selectedRole === 'Chief Examiner' && isSuperAdmin) {
      if (!faculty || !department || !course || !semester || !year) {
        setMessage({ type: 'error', text: 'Please fill in all fields: Faculty, Department, Course, Semester, and Year' });
        return;
      }
    }

    setLoading(true);
    setMessage(null);

    try {
      let result;
      if (isSuperAdmin && selectedRole === 'Chief Examiner') {
        result = await elevateToChiefExaminer(
          selectedUserId, 
          currentUserId,
          {
            faculty,
            department,
            course,
            semester,
            year,
          }
        );
      } else if (isChiefExaminer && ['Vetter', 'Team Lead', 'Setter'].includes(selectedRole)) {
        result = await appointRole(selectedUserId, selectedRole as 'Vetter' | 'Team Lead' | 'Setter', currentUserId);
      } else {
        setMessage({ type: 'error', text: 'You do not have permission to perform this action' });
        setLoading(false);
        return;
      }

      if (result.success) {
        setMessage({ type: 'success', text: `Successfully elevated user to ${selectedRole}` });
        await loadLecturers();
        setSelectedUserId('');
        // Reset form fields
        if (selectedRole === 'Chief Examiner') {
          setFaculty('');
          setDepartment('');
          setCourse('');
          setSemester('');
          setYear('');
        }
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to elevate user' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (userId: string, role: string) => {
    if (!confirm(`Are you sure you want to revoke ${role} role from this user?`)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const result = await revokeRole(userId, role, currentUserId);
      if (result.success) {
        setMessage({ type: 'success', text: `Successfully revoked ${role} role` });
        await loadLecturers();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to revoke role' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-pink-300 bg-pink-100 p-6 shadow-md">
        <h2 className="text-xl font-semibold text-pink-900 mb-4">
          {isSuperAdmin ? 'Elevate to Chief Examiner' : 'Appoint Roles'}
        </h2>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-700'
                : 'bg-rose-500/10 border border-rose-500/40 text-rose-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-pink-800 mb-2">
              Select Lecturer
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="">Choose a lecturer...</option>
              {lecturers.map((lecturer) => (
                <option key={lecturer.id} value={lecturer.id}>
                  {lecturer.name} {lecturer.email ? `(${lecturer.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-pink-800 mb-2">
              Role to Grant
            </label>
            <select
              value={selectedRole}
              onChange={(e) => {
                setSelectedRole(e.target.value as any);
                // Reset Chief Examiner fields when switching roles
                if (e.target.value !== 'Chief Examiner') {
                  setFaculty('');
                  setDepartment('');
                  setCourse('');
                  setSemester('');
                  setYear('');
                }
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:bg-slate-100 disabled:text-slate-500"
              disabled={!isSuperAdmin && selectedRole === 'Chief Examiner'}
            >
              {isSuperAdmin && <option value="Chief Examiner">Chief Examiner</option>}
              {isChiefExaminer && (
                <>
                  <option value="Vetter">Vetter</option>
                  <option value="Team Lead">Team Lead</option>
                  <option value="Setter">Setter</option>
                </>
              )}
            </select>
          </div>

          {/* Chief Examiner Assignment Details - Only show when Chief Examiner is selected */}
          {isSuperAdmin && selectedRole === 'Chief Examiner' && (
            <>
              <div className="border-t border-pink-300 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-pink-800 mb-4">Assignment Details *</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-pink-800 mb-2">
                      Faculty *
                    </label>
                    <select
                      value={faculty}
                      onChange={(e) => setFaculty(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    >
                      <option value="">Select Faculty...</option>
                      {faculties.map((fac) => (
                        <option key={fac} value={fac}>
                          {fac}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-pink-800 mb-2">
                      Department *
                    </label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    >
                      <option value="">Select Department...</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-pink-800 mb-2">
                      Course *
                    </label>
                    <select
                      value={course}
                      onChange={(e) => setCourse(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      required
                    >
                      <option value="">Select Course...</option>
                      {courses.map((crs) => (
                        <option key={crs} value={crs}>
                          {crs}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-pink-800 mb-2">
                        Semester *
                      </label>
                      <select
                        value={semester}
                        onChange={(e) => setSemester(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        required
                      >
                        <option value="">Select Semester...</option>
                        {semesters.map((sem) => (
                          <option key={sem} value={sem}>
                            {sem}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-pink-800 mb-2">
                        Year *
                      </label>
                      <select
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        required
                      >
                        <option value="">Select Year...</option>
                        {years.map((yr) => (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          <button
            onClick={handleElevate}
            disabled={loading || !selectedUserId || (selectedRole === 'Chief Examiner' && isSuperAdmin && (!faculty || !department || !course || !semester || !year))}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : `Grant ${selectedRole} Role`}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-purple-300 bg-purple-100 p-6 shadow-md">
        <h2 className="text-xl font-semibold text-purple-900 mb-4">Lecturers & Roles</h2>
        <div className="space-y-3">
          {lecturers.length === 0 ? (
            <p className="text-center text-purple-600 py-8">No lecturers found</p>
          ) : (
            lecturers.map((lecturer) => (
            <div
              key={lecturer.id}
              className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-purple-900">{lecturer.name}</h3>
                  <p className="text-sm text-purple-700">{lecturer.email}</p>
                  {lecturer.campus && (
                    <p className="text-xs text-purple-600">Campus: {lecturer.campus}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-2">
                    {lecturer.roles?.map((role) => (
                      <span
                        key={role}
                        className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-700 border border-purple-300"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                  {lecturer.roles && lecturer.roles.length > 0 && (
                    <button
                      onClick={() => handleRevoke(lecturer.id, lecturer.roles[0])}
                      className="ml-2 rounded px-2 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-300"
                      title="Revoke role"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}










