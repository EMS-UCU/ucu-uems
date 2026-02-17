import { useState, useEffect, useRef, useMemo } from 'react';
import { elevateToChiefExaminer, revokeRole } from '../lib/privilegeElevation';
import { supabase } from '../lib/supabase';
import type { DatabaseUser } from '../lib/supabase';

interface PrivilegeElevationPanelProps {
  currentUserId: string;
  isSuperAdmin: boolean;
  isChiefExaminer: boolean;
  /** Called when elevation or revoke succeeds - use to refresh parent dashboards in real-time */
  onPrivilegeChange?: () => void | Promise<void>;
}

export default function PrivilegeElevationPanel({
  currentUserId,
  isSuperAdmin,
  isChiefExaminer,
  onPrivilegeChange,
}: PrivilegeElevationPanelProps) {
  const [lecturers, setLecturers] = useState<DatabaseUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Chief Examiner assignment details - ordered: Faculty → Department → Program Category → Lecturer → Semester → Year
  const [faculty, setFaculty] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [category, setCategory] = useState<'Undergraduate' | 'Postgraduate' | ''>('');
  const [semester, setSemester] = useState<string>('');
  const [year, setYear] = useState<string>('');
  
  // Saved Chief Examiner assignments
  const [savedAssignments, setSavedAssignments] = useState<any[]>([]);
  // Keep track of optimistic updates separately
  const optimisticUpdatesRef = useRef<Map<string, any>>(new Map());

  // Dropdown options with filtering hierarchy
  const allFaculties = [
    'Faculty of Engineering, Design and Technology',
    'Faculty of Nursing and Midwifery'
  ];

  // Departments filtered by Faculty
  const allDepartments: Record<string, string[]> = {
    'Faculty of Engineering, Design and Technology': [
      'Department of Computing and Technology',
      'Department of Civil and Environmental Engineering'
    ],
    'Faculty of Nursing and Midwifery': [
      'Department of Nursing',
      'Department of Midwifery'
    ]
  };

  // Filtered departments based on selected faculty
  const departments = faculty ? (allDepartments[faculty] || []) : [];

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
    // Always load assignments if user is Super Admin or Chief Examiner
    if (isSuperAdmin || isChiefExaminer) {
      loadSavedAssignments();
    }
  }, [isSuperAdmin, isChiefExaminer]);

  // Filter lecturers based on selected category, department, and faculty
  // Note: All lecturers currently belong to "Department of Computing and Technology"
  // So only show lecturers when that specific department is selected
  const filteredLecturers = useMemo(() => {
    if (!category) {
      return [];
    }
    
    // Only show lecturers if Department of Computing and Technology is selected
    // This is because all current lecturers belong to this department
    if (department !== 'Department of Computing and Technology') {
      return [];
    }
    
    // Filter by category
    let filtered = lecturers.filter(lecturer => lecturer.lecturer_category === category);
    
    // Also filter by department to ensure exact match
    // Support both naming conventions: "Department of Computing and Technology" and "Computing and Technology"
    filtered = filtered.filter(lecturer => 
      lecturer.department === 'Department of Computing and Technology' || 
      lecturer.department === 'Computing and Technology'
    );
    
    return filtered;
  }, [lecturers, category, department]);

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
    if (isSuperAdmin) {
      if (!faculty || !department || !category || !semester || !year) {
        setMessage({ type: 'error', text: 'Please fill in all fields: Faculty, Department, Program Category, Semester, and Year' });
        return;
      }
    }

    setLoading(true);
    setMessage(null);

    try {
      let result;
      if (isSuperAdmin) {
        result = await elevateToChiefExaminer(
          selectedUserId, 
          currentUserId,
          {
            category: category as 'Undergraduate' | 'Postgraduate',
            faculty,
            department,
            semester,
            year,
          }
        );
      } else if (isChiefExaminer) {
        // For Chief Examiners, they can appoint other roles
        setMessage({ type: 'error', text: 'Please use the role appointment panel for other roles' });
        setLoading(false);
        return;
      } else {
        setMessage({ type: 'error', text: 'You do not have permission to perform this action' });
        setLoading(false);
        return;
      }

      if (result.success) {
        setMessage({ type: 'success', text: 'Successfully promoted lecturer to Chief Examiner' });
        
        // Optimistic update: add the new assignment immediately so card appears in real-time
        const promotedLecturer = lecturers.find(l => l.id === selectedUserId);
        if (promotedLecturer) {
          const newAssignment = {
            id: `temp-${Date.now()}`,
            user_id: selectedUserId,
            elevated_by: currentUserId,
            role_granted: 'Chief Examiner',
            is_active: true,
            created_at: new Date().toISOString(),
            granted_at: new Date().toISOString(),
            metadata: {
              category: category as 'Undergraduate' | 'Postgraduate',
              faculty,
              department,
              semester,
              year,
            },
            user_profiles: {
              name: promotedLecturer.name,
              email: promotedLecturer.email || '',
            }
          };
          optimisticUpdatesRef.current.set(selectedUserId, newAssignment);
          setSavedAssignments(prev => [newAssignment, ...prev]);
        }
        
        // Refresh data (lecturers list + assignments) - runs in parallel for faster UI update
        await Promise.all([loadLecturers(), loadSavedAssignments()]);
        
        // One follow-up refresh to sync with DB (handles replication delay)
        setTimeout(() => loadSavedAssignments(), 300);
        
        // Notify parent dashboards to refresh in real-time
        onPrivilegeChange?.();
        
        setSelectedUserId('');
        // Reset form fields
        setFaculty('');
        setDepartment('');
        setCategory('');
        setSemester('');
        setYear('');
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to elevate user' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const loadSavedAssignments = async (preserveOptimistic = true) => {
    try {
      // Get optimistic updates from ref
      const optimisticUpdates = preserveOptimistic 
        ? Array.from(optimisticUpdatesRef.current.values())
        : [];
      
      // First, try to load from privilege_elevations table
      let query = supabase
        .from('privilege_elevations')
        .select(`
          *,
          user_profiles!privilege_elevations_user_id_fkey (
            name,
            email
          )
        `)
        .eq('role_granted', 'Chief Examiner')
        .eq('is_active', true);
      
      // If user is Chief Examiner (but not Super Admin), filter to their own assignment
      if (isChiefExaminer && !isSuperAdmin) {
        query = query.eq('user_id', currentUserId);
      }
      
      // NOTE: table uses granted_at, not created_at
      const { data, error } = await query.order('granted_at', { ascending: false });
      
      // Also load Chief Examiners directly from user_profiles (in case they don't have privilege_elevations records)
      // Fetch all lecturers and filter for those with Chief Examiner role
      const { data: allLecturers, error: usersError } = await supabase
        .from('user_profiles')
        .select('id, name, email, roles')
        .eq('base_role', 'Lecturer');
      
      if (usersError) {
        console.error('Error loading users:', usersError);
      }
      
      // Filter for Chief Examiners
      const chiefExaminerUsers = allLecturers?.filter(user => 
        user.roles && Array.isArray(user.roles) && user.roles.includes('Chief Examiner')
      ) || [];

      // Combine data from privilege_elevations and user_profiles
      const assignmentsFromElevations: any[] = [];
      
      if (error) {
        console.error('Error loading assignments with join:', error);
        // Try alternative query without join
        const { data: altData, error: altError } = await supabase
          .from('privilege_elevations')
          .select('*')
          .eq('role_granted', 'Chief Examiner')
          .eq('is_active', true)
          .order('granted_at', { ascending: false });

        if (!altError && altData && altData.length > 0) {
          // Fetch user details separately
          const userIds = altData.map(a => a.user_id);
          const { data: users } = await supabase
            .from('user_profiles')
            .select('id, name, email')
            .in('id', userIds);

          assignmentsFromElevations.push(...altData.map(assignment => ({
            ...assignment,
            user_profiles: users?.find(u => u.id === assignment.user_id) || null
          })));
        }
      } else if (data && data.length > 0) {
        assignmentsFromElevations.push(...data);
      }

      // Now, get all Chief Examiners from user_profiles and create cards for those without privilege_elevations records
      const existingUserIds = new Set(assignmentsFromElevations.map(a => a.user_id));
      const additionalAssignments: any[] = [];
      
      if (chiefExaminerUsers && chiefExaminerUsers.length > 0) {
        for (const user of chiefExaminerUsers) {
          // Filter by current user if they're Chief Examiner (but not Super Admin)
          if (isChiefExaminer && !isSuperAdmin && user.id !== currentUserId) {
            continue;
          }
          
          // Skip if we already have this user in assignmentsFromElevations
          if (existingUserIds.has(user.id)) {
            continue;
          }
          
          // Create a card entry for this Chief Examiner even without a privilege_elevations record
          additionalAssignments.push({
            id: `user-${user.id}`,
            user_id: user.id,
            role_granted: 'Chief Examiner',
            is_active: true,
            metadata: null, // No metadata if created before the new system
            granted_at: new Date().toISOString(), // Use current date as fallback
            user_profiles: {
              name: user.name,
              email: user.email || ''
            }
          });
        }
      }

      // Combine all assignments
      const allAssignments = [...assignmentsFromElevations, ...additionalAssignments];
      
      console.log('Loaded assignments:', allAssignments.length, allAssignments);
      
      // Merge with optimistic updates, but remove any optimistic entries that now exist in DB
      if (preserveOptimistic && optimisticUpdates.length > 0) {
        const dbUserIds = new Set(allAssignments.map(a => a.user_id));
        const remainingOptimistic = optimisticUpdates.filter(
          opt => !dbUserIds.has(opt.user_id)
        );
        // Remove confirmed optimistic updates from ref
        dbUserIds.forEach(userId => optimisticUpdatesRef.current.delete(userId));
        setSavedAssignments([...allAssignments, ...remainingOptimistic]);
      } else {
        setSavedAssignments(allAssignments);
      }
    } catch (error: any) {
      console.error('Error loading assignments:', error);
      // Keep optimistic updates if any
      if (preserveOptimistic) {
        const currentOptimistic = Array.from(optimisticUpdatesRef.current.values());
        if (currentOptimistic.length > 0) {
          setSavedAssignments(currentOptimistic);
          return;
        }
      }
      setSavedAssignments([]);
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
        // Remove from optimistic updates if present
        optimisticUpdatesRef.current.delete(userId);
        setMessage({ type: 'success', text: `Successfully revoked ${role} role` });
        await loadLecturers();
        await loadSavedAssignments();
        // Notify parent dashboards to refresh in real-time
        onPrivilegeChange?.();
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
      {/* Saved Chief Examiner Assignments - Show FIRST and prominently */}
      {(isSuperAdmin || isChiefExaminer) && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-emerald-900">
              {isSuperAdmin ? 'Chief Examiner Assignments' : 'My Chief Examiner Assignment'}
            </h2>
            {savedAssignments.length > 0 && (
              <span className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-sm font-bold shadow-md">
                {savedAssignments.length} {savedAssignments.length === 1 ? 'Assignment' : 'Assignments'}
              </span>
            )}
          </div>
          <div className={savedAssignments.length === 0 ? "space-y-4" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}>
            {savedAssignments.length === 0 ? (
              <div className="text-center py-12 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border-2 border-dashed border-emerald-300">
                <svg className="w-16 h-16 mx-auto mb-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <defs>
                    <linearGradient id="emptyIconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                  </defs>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" stroke="url(#emptyIconGradient)" />
                </svg>
                <p className="text-base font-semibold text-emerald-700 mb-1">No Chief Examiner Assignments Yet</p>
                <p className="text-xs text-emerald-600">Promote a lecturer to Chief Examiner to see assignments here.</p>
              </div>
            ) : (
              savedAssignments.map((assignment) => {
                const lecturer = assignment.user_profiles;
                const metadata = assignment.metadata || {};
                return (
                  <div
                    key={assignment.id}
                    className="group relative rounded-2xl bg-gradient-to-br from-white via-purple-50/30 to-pink-50/40 p-3.5 shadow-lg hover:shadow-xl transition-all duration-300 border border-purple-200/50 hover:border-purple-300 overflow-hidden"
                  >
                    {/* Animated gradient background overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    
                    {/* Colorful decorative corner accent */}
                    <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-violet-400/20 to-fuchsia-400/20 rounded-bl-full"></div>
                    
                    {/* Icon in top right with colorful gradient */}
                    <div className="absolute top-2.5 right-2.5 z-10">
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg blur-sm opacity-60"></div>
                        <svg className="w-5 h-5 relative" fill="none" viewBox="0 0 24 24">
                          <defs>
                            <linearGradient id={`shieldGradient-${assignment.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#8b5cf6" />
                              <stop offset="50%" stopColor="#a855f7" />
                              <stop offset="100%" stopColor="#ec4899" />
                            </linearGradient>
                          </defs>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke={`url(#shieldGradient-${assignment.id})`} />
                        </svg>
                      </div>
                    </div>

                    {/* Lecturer Name and Email - Compact */}
                    <div className="mb-2.5 relative z-10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-red-600 mb-0.5 truncate group-hover:text-red-700 transition-colors">{lecturer?.name || 'Unknown'}</h3>
                          <p className="text-xs text-slate-600 truncate">{lecturer?.email || ''}</p>
                        </div>
                      </div>
                    </div>

                    {/* Role Badge with colorful gradient */}
                    <div className="mb-2.5 relative z-10">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-2.5 py-0.5 text-xs font-bold shadow-sm">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Chief Examiner
                      </span>
                    </div>

                    {/* Assignment Details Section - Compact with colorful icons */}
                    <div className="mb-2.5 rounded-lg bg-gradient-to-br from-slate-50 to-slate-100/80 border border-slate-200/60 p-2 relative z-10">
                      <div className="flex items-center gap-1.5 mb-2">
                        <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                        </svg>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-700">Assignment Details</p>
                      </div>
                      <div className="space-y-1.5">
                        {metadata.category && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M7 2a1 1 0 00-.707 1.707L7 4.414v3.758a1 1 0 01-.293.707l-4 4C.817 14.769 2.156 18 4.828 18h10.343c2.673 0 4.012-3.231 2.122-5.121l-4-4A1 1 0 0113 8.172V4.414l.707-.707A1 1 0 0013 2H7z" clipRule="evenodd" />
                              </svg>
                              <span className="text-xs text-slate-500">Category:</span>
                            </div>
                            <span className="text-xs font-bold text-slate-800">{metadata.category}</span>
                          </div>
                        )}
                        {metadata.faculty && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84l5.25 2.25a1 1 0 01.356-.356l5.25-2.25a1 1 0 00.356-.356L17.394 4.08a1 1 0 000-1.84l-7-3zM3.5 8.5a1 1 0 01.356-.356l5.25-2.25a1 1 0 01.788 0l5.25 2.25a1 1 0 01.356.356l-5.25 2.25a1 1 0 01-.788 0L3.856 8.5a1 1 0 01-.356-.356z" />
                                <path d="M3.394 12.08a1 1 0 00.788 0l5.25-2.25a1 1 0 01.788 0l5.25 2.25a1 1 0 00.788 0l2.25-1a1 1 0 011.84.788l-2.25 1a1 1 0 01-.788 0l-5.25-2.25a1 1 0 00-.788 0l-5.25 2.25a1 1 0 01-.788 0l-2.25-1a1 1 0 01.84-1.788l2.25 1z" />
                              </svg>
                              <span className="text-xs text-slate-500">Faculty:</span>
                            </div>
                            <span className="text-xs font-semibold text-slate-800 text-right truncate max-w-[60%]">{metadata.faculty}</span>
                          </div>
                        )}
                        {metadata.department && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                              </svg>
                              <span className="text-xs text-slate-500">Dept:</span>
                            </div>
                            <span className="text-xs font-semibold text-slate-800 text-right truncate max-w-[60%]">{metadata.department}</span>
                          </div>
                        )}
                        {(metadata.semester || metadata.year) && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 text-pink-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                              </svg>
                              <span className="text-xs text-slate-500">Sem/Year:</span>
                            </div>
                            <span className="text-xs font-semibold text-slate-800">{metadata.semester} {metadata.year}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Button - Only show revoke for Super Admin */}
                    {isSuperAdmin && (
                      <div className="relative z-10">
                        <button
                          onClick={() => handleRevoke(assignment.user_id, 'Chief Examiner')}
                          className="w-full rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white px-2.5 py-1.5 text-xs font-bold shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

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
          {/* Faculty Selection - Show FIRST */}
          {isSuperAdmin && (
            <div>
              <label className="block text-sm font-semibold text-pink-800 mb-2">
                Faculty *
              </label>
              <select
                value={faculty}
                onChange={(e) => {
                  setFaculty(e.target.value);
                  // Reset dependent fields when faculty changes
                  setDepartment('');
                  setCategory('');
                  setSelectedUserId('');
                  setSemester('');
                  setYear('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                required
              >
                <option value="">Select Faculty...</option>
                {allFaculties.map((fac) => (
                  <option key={fac} value={fac}>
                    {fac}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Department Selection - Show after Faculty is selected */}
          {isSuperAdmin && faculty && (
            <div>
              <label className="block text-sm font-semibold text-pink-800 mb-2">
                Department *
              </label>
              <select
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  // Reset dependent fields when department changes
                  setCategory('');
                  setSelectedUserId('');
                  setSemester('');
                  setYear('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                required
                disabled={!faculty || departments.length === 0}
              >
                <option value="">Select Department...</option>
                {departments.length === 0 ? (
                  <option value="" disabled>
                    {faculty ? 'No departments found for this faculty' : 'Select a faculty first'}
                  </option>
                ) : (
                  departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {/* Program Category Selection - Show after Department is selected */}
          {isSuperAdmin && faculty && department && (
            <div>
              <label className="block text-sm font-semibold text-pink-800 mb-2">
                Program Category *
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const newCategory = e.target.value as 'Undergraduate' | 'Postgraduate' | '';
                  setCategory(newCategory);
                  // Reset lecturer selection when category changes
                  setSelectedUserId('');
                  setSemester('');
                  setYear('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                required
              >
                <option value="">Select Program Category...</option>
                <option value="Undergraduate">Undergraduate</option>
                <option value="Postgraduate">Postgraduate</option>
              </select>
            </div>
          )}

          {/* Lecturer Selection - Show after Category is selected */}
          {isSuperAdmin && faculty && department && category && (
            <div>
              <label className="block text-sm font-semibold text-pink-800 mb-2">
                Select Lecturer *
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value);
                  // Reset semester and year when lecturer changes (optional)
                  setSemester('');
                  setYear('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                required
              >
                <option value="">Choose a lecturer...</option>
                {filteredLecturers.length === 0 ? (
                  <option value="" disabled>
                    No {category} lecturers found {department ? `in ${department}` : ''}
                  </option>
                ) : (
                  filteredLecturers.map((lecturer) => (
                    <option key={lecturer.id} value={lecturer.id}>
                      {lecturer.name} {lecturer.email ? `(${lecturer.email})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {/* Semester and Year - Show after Lecturer is selected */}
          {isSuperAdmin && faculty && department && category && selectedUserId && (
            <>
              <div className="border-t border-pink-300 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-pink-800 mb-4">Assignment Details *</h3>
                
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
            </>
          )}

          <button
            onClick={handleElevate}
            disabled={loading || !selectedUserId || (isSuperAdmin && (!faculty || !department || !category || !semester || !year))}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : 'Promote to Chief Examiner'}
          </button>
        </div>
      </div>
    </div>
  );
}










