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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold text-slate-100 mb-4">
          {isSuperAdmin ? 'Elevate to Chief Examiner' : 'Appoint Roles'}
        </h2>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-200'
                : 'bg-rose-500/10 border border-rose-500/40 text-rose-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Select Lecturer
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Role to Grant
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold text-slate-100 mb-4">Lecturers & Roles</h2>
        <div className="space-y-3">
          {lecturers.map((lecturer) => (
            <div
              key={lecturer.id}
              className="rounded-lg border border-slate-700 bg-slate-950/60 p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100">{lecturer.name}</h3>
                  <p className="text-sm text-slate-400">{lecturer.email}</p>
                  {lecturer.campus && (
                    <p className="text-xs text-slate-500">Campus: {lecturer.campus}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-2">
                    {lecturer.roles?.map((role) => (
                      <span
                        key={role}
                        className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                  {lecturer.roles && lecturer.roles.length > 0 && (
                    <button
                      onClick={() => handleRevoke(lecturer.id, lecturer.roles[0])}
                      className="ml-2 rounded px-2 py-1 text-xs text-rose-400 hover:text-rose-300"
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









