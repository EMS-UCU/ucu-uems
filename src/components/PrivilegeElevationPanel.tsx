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

  useEffect(() => {
    loadLecturers();
  }, []);

  const loadLecturers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('base_role', 'Lecturer')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error loading lecturers:', error);
        return;
      }

      setLecturers(data || []);
    } catch (error) {
      console.error('Error loading lecturers:', error);
    }
  };

  const handleElevate = async () => {
    if (!selectedUserId) {
      setMessage({ type: 'error', text: 'Please select a lecturer' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      let result;
      if (isSuperAdmin && selectedRole === 'Chief Examiner') {
        result = await elevateToChiefExaminer(selectedUserId, currentUserId);
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
      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <h2 className="text-xl font-semibold text-blue-900 mb-4">
          {isSuperAdmin ? 'Elevate to Chief Examiner' : 'Appoint Roles'}
        </h2>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 ${
              message.type === 'success'
                ? 'bg-emerald-100 border border-emerald-300 text-emerald-700'
                : 'bg-rose-100 border border-rose-300 text-rose-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-blue-700 mb-2">
              Select Lecturer
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-blue-300 bg-white px-4 py-2 text-blue-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
            <label className="block text-sm font-semibold text-blue-700 mb-2">
              Role to Grant
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              className="w-full rounded-lg border border-blue-300 bg-white px-4 py-2 text-blue-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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

          <button
            onClick={handleElevate}
            disabled={loading || !selectedUserId}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : `Grant ${selectedRole} Role`}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <h2 className="text-xl font-semibold text-blue-900 mb-4">Lecturers & Roles</h2>
        <div className="space-y-3">
          {lecturers.map((lecturer) => (
            <div
              key={lecturer.id}
              className="rounded-lg border border-blue-200 bg-white p-4 hover:shadow-md transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-blue-900">{lecturer.name}</h3>
                  <p className="text-sm text-blue-700">{lecturer.email}</p>
                  {lecturer.campus && (
                    <p className="text-xs text-blue-600">Campus: {lecturer.campus}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-2">
                    {lecturer.roles?.map((role) => (
                      <span
                        key={role}
                        className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700 border border-purple-300"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                  {lecturer.roles && lecturer.roles.length > 0 && (
                    <button
                      onClick={() => handleRevoke(lecturer.id, lecturer.roles[0])}
                      className="ml-2 rounded px-2 py-1 text-xs text-rose-600 hover:text-rose-500"
                      title="Revoke role"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}










