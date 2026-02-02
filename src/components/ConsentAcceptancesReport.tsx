import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import type { WorkflowRole } from '../lib/roleConsentDocuments';

interface ConsentAcceptance {
  id: string;
  user_id: string;
  role: WorkflowRole;
  accepted_at: string;
  user_name?: string;
  user_email?: string;
}

export default function ConsentAcceptancesReport() {
  const [acceptances, setAcceptances] = useState<ConsentAcceptance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<WorkflowRole | 'all'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'user' | 'role'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadAcceptances();
  }, []);

  const loadAcceptances = async () => {
    setLoading(true);
    try {
      console.log('📥 Loading consent acceptances...');
      
      // Fetch acceptances first
      const { data: acceptancesData, error: acceptancesError } = await supabase
        .from('role_consent_acceptances')
        .select('id, user_id, role, accepted_at')
        .order('accepted_at', { ascending: false });

      if (acceptancesError) {
        console.error('❌ Error loading acceptances:', acceptancesError);
        return;
      }

      if (!acceptancesData || acceptancesData.length === 0) {
        console.log('ℹ️ No acceptances found');
        setAcceptances([]);
        return;
      }

      console.log('✅ Loaded acceptances:', acceptancesData.length);

      // Get unique user IDs
      const userIds = [...new Set(acceptancesData.map(a => a.user_id))];
      console.log('👥 Fetching profiles for users:', userIds.length);

      // Fetch user profiles for those user IDs
      const { data: profilesData, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, name, email')
        .in('id', userIds);

      if (profilesError) {
        console.error('❌ Error loading user profiles:', profilesError);
        // Still show acceptances without user names
      }

      // Create a map of user_id -> profile
      const profilesMap = new Map<string, { name: string; email: string }>();
      (profilesData || []).forEach((profile: any) => {
        profilesMap.set(profile.id, {
          name: profile.name || 'Unknown User',
          email: profile.email || '',
        });
      });

      console.log('✅ Loaded profiles:', profilesMap.size);

      // Transform data to include user info
      const transformedData: ConsentAcceptance[] = acceptancesData.map((item: any) => {
        const profile = profilesMap.get(item.user_id);
        return {
          id: item.id,
          user_id: item.user_id,
          role: item.role,
          accepted_at: item.accepted_at,
          user_name: profile?.name || 'Unknown User',
          user_email: profile?.email || '',
        };
      });

      console.log('✅ Transformed acceptances:', transformedData.length);
      setAcceptances(transformedData);
    } catch (error) {
      console.error('❌ Error loading acceptances:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSorted = acceptances
    .filter((acc) => filterRole === 'all' || acc.role === filterRole)
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        comparison = new Date(a.accepted_at).getTime() - new Date(b.accepted_at).getTime();
      } else if (sortBy === 'user') {
        comparison = (a.user_name || '').localeCompare(b.user_name || '');
      } else if (sortBy === 'role') {
        comparison = a.role.localeCompare(b.role);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const stats = {
    total: acceptances.length,
    byRole: {
      'Chief Examiner': acceptances.filter((a) => a.role === 'Chief Examiner').length,
      'Team Lead': acceptances.filter((a) => a.role === 'Team Lead').length,
      Vetter: acceptances.filter((a) => a.role === 'Vetter').length,
      Setter: acceptances.filter((a) => a.role === 'Setter').length,
    },
    uniqueUsers: new Set(acceptances.map((a) => a.user_id)).size,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 bg-white">
        <div className="text-blue-700">Loading report...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Compliance Report
          </p>
          <h2 className="text-xl font-bold text-blue-900">Role Consent Acceptances</h2>
          <p className="text-xs text-blue-600">
            Track all role consent agreement acceptances across the system
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { key: 'total', label: 'Total Acceptances', value: stats.total, colorClass: 'text-blue-600', icon: '📋' },
          { key: 'users', label: 'Unique Users', value: stats.uniqueUsers, colorClass: 'text-green-600', icon: '👥' },
          { key: 'chief', label: 'Chief Examiner', value: stats.byRole['Chief Examiner'], colorClass: 'text-purple-600', icon: '👑' },
          { key: 'team', label: 'Team Lead', value: stats.byRole['Team Lead'], colorClass: 'text-amber-600', icon: '👔' },
          { key: 'vetter', label: 'Vetter', value: stats.byRole['Vetter'], colorClass: 'text-red-600', icon: '✓' },
        ].map((stat) => (
          <motion.div
            key={stat.key}
            className="relative rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                {stat.label}
              </p>
              <span className="text-xl">{stat.icon}</span>
            </div>
            <p className={`mt-2 text-3xl font-bold ${stat.colorClass}`}>{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters and Sort */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-900">Filter by Role:</label>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as WorkflowRole | 'all')}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="Chief Examiner">Chief Examiner</option>
            <option value="Team Lead">Team Lead</option>
            <option value="Vetter">Vetter</option>
            <option value="Setter">Setter</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-900">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'user' | 'role')}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="date">Date</option>
            <option value="user">User</option>
            <option value="role">Role</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-900">Order:</label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
        <button
          onClick={loadAcceptances}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Acceptances Table */}
      <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-md">
        <h3 className="text-lg font-semibold text-blue-900 mb-4">
          Acceptance Records ({filteredAndSorted.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-blue-200">
                <th className="px-4 py-3 text-left text-sm font-semibold text-blue-900">User</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-blue-900">Email</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-blue-900">Role</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-blue-900">Accepted At</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-blue-600">
                    No acceptances found
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((acceptance, index) => (
                  <motion.tr
                    key={acceptance.id}
                    className="border-b border-blue-100 hover:bg-blue-50/50 transition-colors"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.02 }}
                  >
                    <td className="px-4 py-3 text-sm text-blue-900 font-medium">
                      {acceptance.user_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-blue-700">
                      {acceptance.user_email || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                          acceptance.role === 'Chief Examiner'
                            ? 'bg-purple-100 text-purple-700 border border-purple-300'
                            : acceptance.role === 'Team Lead'
                            ? 'bg-amber-100 text-amber-700 border border-amber-300'
                            : acceptance.role === 'Vetter'
                            ? 'bg-red-100 text-red-700 border border-red-300'
                            : 'bg-blue-100 text-blue-700 border border-blue-300'
                        }`}
                      >
                        {acceptance.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-blue-700">
                      {new Date(acceptance.accepted_at).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Option */}
      <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4">
        <button
          onClick={() => {
            const csv = [
              ['User Name', 'Email', 'Role', 'Accepted At'],
              ...filteredAndSorted.map((a) => [
                a.user_name || '',
                a.user_email || '',
                a.role,
                new Date(a.accepted_at).toLocaleString(),
              ]),
            ]
              .map((row) => row.map((cell) => `"${cell}"`).join(','))
              .join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `consent-acceptances-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="rounded-lg bg-green-600 px-6 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
        >
          Export to CSV
        </button>
      </div>
    </div>
  );
}
