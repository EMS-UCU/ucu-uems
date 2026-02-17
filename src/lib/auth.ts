import { supabase, type DatabaseUser, type UserProfile } from './supabase';
import type { User } from '../App';

// Convert auth user + profile to app user format
export function authUserToAppUser(authUser: any, profile: any): User {
  return {
    id: authUser.id,
    name: profile?.name || authUser.email?.split('@')[0] || 'User',
    baseRole: (profile?.base_role as 'Admin' | 'Lecturer') || 'Lecturer',
    roles: (profile?.roles as any[]) || [],
    password: '', // Don't expose password
    email: authUser.email,
    isSuperAdmin: profile?.is_super_admin || false,
    campus: profile?.campus,
    department: profile?.department,
    courseUnit: profile?.course_unit || undefined,
    lecturerCategory: profile?.lecturer_category as 'Undergraduate' | 'Postgraduate' | undefined,
  };
}

// Legacy: Convert database user to app user format (for backward compatibility)
export function dbUserToAppUser(dbUser: DatabaseUser): User {
  return {
    id: dbUser.id,
    name: dbUser.name,
    baseRole: dbUser.base_role,
    roles: dbUser.roles as any[],
    password: '', // Don't expose password
    email: dbUser.email,
    isSuperAdmin: dbUser.is_super_admin || false,
    campus: dbUser.campus,
    department: dbUser.department,
    courseUnit: dbUser.course_unit || undefined,
    lecturerCategory: dbUser.lecturer_category,
  };
}

/** Restore session from Supabase (e.g. on page load). Returns user if valid session exists. */
export async function restoreSession(): Promise<User | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) return null;
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    return authUserToAppUser(session.user, profile);
  } catch {
    return null;
  }
}

// Test function to verify Supabase connection
export async function testSupabaseConnection(): Promise<{ success: boolean; error?: string; data?: any }> {
  try {
    // First check if Supabase is configured
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return { success: false, error: 'Supabase credentials not configured' };
    }

    // Reject placeholder credentials
    if (supabaseKey === 'your-anon-key-here' || supabaseKey.length < 50 || supabaseUrl.includes('your-project-id')) {
      return { success: false, error: 'Replace placeholder credentials in .env with your real Supabase API key from Dashboard → Settings → API' };
    }

    // Test connection by checking auth
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      // Network errors (Failed to fetch, ERR_NAME_NOT_RESOLVED) mean connection failed
      const isNetworkError = error.message?.includes('fetch') || error.message?.includes('Failed to');
      if (isNetworkError) {
        return { success: false, error: 'Cannot reach Supabase. Check your URL and internet connection.' };
      }
      // Auth errors (invalid key, etc.) mean we reached the server but auth failed
      return { success: true, error: 'Connection OK (not authenticated)' };
    }
    
    return { success: true, data: { connected: true } };
  } catch (error: any) {
    const msg = error?.message || 'Connection test failed';
    const isNetworkError = msg.includes('fetch') || msg.includes('Failed to');
    return { success: false, error: isNetworkError ? 'Cannot reach Supabase. Check your URL and anon key.' : msg };
  }
}

// Authenticate user with Supabase Auth using email and password
export async function authenticateUser(
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> {
  try {
    // Check if Supabase is configured
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
      return { 
        user: null, 
        error: 'Database not configured. Please check your environment variables.' 
      };
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    
    console.log('🔐 Attempting to authenticate with Supabase Auth:', {
      email: trimmedEmail,
      passwordLength: trimmedPassword.length,
      supabaseUrl: supabaseUrl,
      hasKey: !!supabaseKey,
      keyPrefix: supabaseKey.substring(0, 20) + '...'
    });
    
    // Clear any existing session first to avoid conflicts
    await supabase.auth.signOut();
    
    // Use Supabase Auth to sign in
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: trimmedPassword,
    });

    if (authError) {
      console.error('❌ Supabase Auth error:', {
        message: authError.message,
        status: authError.status,
        name: authError.name,
        code: (authError as any).code,
        fullError: JSON.stringify(authError, null, 2)
      });
      
      // More specific error handling
      if (authError.message.includes('Invalid login credentials') || 
          authError.message.includes('Invalid email or password') ||
          authError.status === 400) {
        console.error('❌ Login failed: Invalid credentials.');
        console.error('💡 Solutions:');
        console.error('   1. Check password in Supabase Dashboard → Authentication → Users');
        console.error('   2. Reset password: Click user → Update password → Set to: admin123');
        console.error('   3. Verify email is confirmed (email_confirmed_at is not NULL)');
        return { 
          user: null, 
          error: 'Invalid email or password. Please check your credentials or reset your password in Supabase Dashboard.' 
        };
      }
      
      if (authError.message.includes('Email not confirmed') || 
          authError.message.includes('email_not_confirmed')) {
        console.error('❌ Login failed: Email not confirmed.');
        console.error('💡 Solution: Confirm email in Supabase Dashboard → Authentication → Users');
        return { 
          user: null, 
          error: 'Email not confirmed. Please confirm your email in Supabase Dashboard.' 
        };
      }
      
      if (authError.message.includes('Too many requests') || 
          authError.status === 429) {
        return { 
          user: null, 
          error: 'Too many login attempts. Please wait a moment and try again.' 
        };
      }
      
      return { 
        user: null, 
        error: `Authentication failed: ${authError.message || 'Unknown error'}. Check console for details.` 
      };
    }

    if (!authData.user) {
      console.error('❌ No user data returned from authentication');
      return { user: null, error: 'Authentication failed. No user data returned.' };
    }

    console.log('✅ Auth successful! User ID:', authData.user.id);
    console.log('📧 Email:', authData.user.email);
    console.log('✅ Email confirmed:', !!authData.user.email_confirmed_at);
    console.log('🔑 Session active:', !!authData.session);
    
    // Fetch user profile from user_profiles table
    console.log('🔍 Fetching user profile...');
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.warn('⚠️ Profile not found, creating default profile:', profileError.message);
      // If profile doesn't exist, create a basic one
      const defaultProfile = {
        id: authData.user.id,
        username: authData.user.email?.split('@')[0] || 'user',
        email: authData.user.email || '',
        name: authData.user.user_metadata?.name || authData.user.email?.split('@')[0] || 'User',
        base_role: 'Lecturer' as const,
        roles: [] as string[],
        is_super_admin: false,
      };
      
      // Try to create profile
      const { error: createError } = await supabase
        .from('user_profiles')
        .insert([defaultProfile]);
      
      if (createError) {
        console.error('❌ Failed to create profile:', createError);
        // Still return user even if profile creation fails
      } else {
        console.log('✅ Default profile created');
      }
      
      const appUser = authUserToAppUser(authData.user, defaultProfile);
      return { user: appUser, error: null };
    }

    console.log('✅ User profile found:', {
      username: profile.username,
      base_role: profile.base_role,
      is_super_admin: profile.is_super_admin
    });
    const appUser = authUserToAppUser(authData.user, profile);
    return { user: appUser, error: null };
  } catch (error: any) {
    console.error('Authentication error:', error);
    return { 
      user: null, 
      error: error?.message || 'An error occurred during authentication. Please check the console for details.' 
    };
  }
}

// Workflow roles that are assigned via privilege_elevations and require consent before being in user_profiles
const WORKFLOW_ELEVATION_ROLES = ['Team Lead', 'Vetter', 'Setter'];

// Get all users (for admin purposes) - using user_profiles, merged with assigned-but-pending roles from privilege_elevations
export async function getAllUsers(): Promise<User[]> {
  try {
    // Get all user profiles
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching user profiles:', error);
      return [];
    }

    if (!profiles || profiles.length === 0) {
      return [];
    }

    // Fetch active privilege_elevations for workflow roles so CE sees "assigned (pending consent)" users
    const { data: elevations } = await supabase
      .from('privilege_elevations')
      .select('user_id, role_granted')
      .eq('is_active', true)
      .in('role_granted', WORKFLOW_ELEVATION_ROLES);

    const assignedByUser = new Map<string, string[]>();
    for (const e of elevations || []) {
      const uid = (e as any).user_id;
      const role = (e as any).role_granted;
      if (!assignedByUser.has(uid)) assignedByUser.set(uid, []);
      const arr = assignedByUser.get(uid)!;
      if (!arr.includes(role)) arr.push(role);
    }

    // Convert profiles to User format; merge in assigned roles so pending assignments show on cards
    const users: User[] = profiles.map((profile: any) => {
      const profileRoles = (profile.roles as any[]) || [];
      const assigned = assignedByUser.get(profile.id) || [];
      const mergedRoles = [...new Set([...profileRoles, ...assigned])];
      return {
        id: profile.id,
        name: profile.name,
        baseRole: profile.base_role as 'Admin' | 'Lecturer',
        roles: mergedRoles,
        password: '',
        email: profile.email || '', // Email stored in profile
        isSuperAdmin: profile.is_super_admin || false,
        campus: profile.campus,
        department: profile.department,
        courseUnit: profile.course_unit || undefined,
        lecturerCategory: profile.lecturer_category as 'Undergraduate' | 'Postgraduate' | undefined,
      };
    });

    return users;
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return [];
  }
}

/** Returns true if roles array/string includes Vetter (case-insensitive). Handles Postgres TEXT[] or jsonb or single string. */
function hasVetterRole(roles: unknown): boolean {
  if (!roles) return false;
  let arr: unknown[] = [];
  if (Array.isArray(roles)) {
    arr = roles;
  } else if (typeof roles === 'string') {
    if (roles.startsWith('[')) {
      try { arr = JSON.parse(roles); } catch { arr = []; }
    } else {
      arr = [roles]; // single role string e.g. "Vetter"
    }
  }
  return arr.some((r: unknown) => String(r).toLowerCase() === 'vetter');
}

/** Returns true if roles array/string includes Chief Examiner (case-insensitive). Handles "Chief Examiner" or "ChiefExaminer". */
function hasChiefExaminerRole(roles: unknown): boolean {
  if (!roles) return false;
  let arr: unknown[] = [];
  if (Array.isArray(roles)) {
    arr = roles;
  } else if (typeof roles === 'string') {
    if (roles.startsWith('[')) {
      try { arr = JSON.parse(roles); } catch { arr = []; }
    } else {
      arr = [roles];
    }
  }
  return arr.some((r: unknown) => {
    const s = String(r).toLowerCase();
    return s.includes('chief examiner') || s.includes('chiefexaminer');
  });
}

/** Get user ids (and names) of all users who have the Chief Examiner role. Used to notify Chief when a vetter is deactivated. */
export async function getChiefExaminerUserIds(): Promise<{ id: string; name: string }[]> {
  try {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, name, roles')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching Chief Examiners from user_profiles:', error);
      return [];
    }
    if (!profiles || profiles.length === 0) return [];
    const chiefs = profiles.filter((p: any) => hasChiefExaminerRole(p.roles));
    return chiefs.map((p: any) => ({ id: p.id, name: p.name || 'Chief Examiner' }));
  } catch (error: any) {
    console.error('Error in getChiefExaminerUserIds:', error);
    return [];
  }
}

/** Get user ids (and names) of all users who have the Vetter role. Used when Chief starts vetting so vetters are always notified from DB source of truth. */
export async function getVetterUserIds(): Promise<{ id: string; name: string }[]> {
  try {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, name, roles')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching vetters from user_profiles:', error);
      return [];
    }
    if (!profiles || profiles.length === 0) return [];
    const vetters = profiles.filter((p: any) => hasVetterRole(p.roles));
    return vetters.map((p: any) => ({ id: p.id, name: p.name || 'Vetter' }));
  } catch (error: any) {
    console.error('Error in getVetterUserIds:', error);
    return [];
  }
}

/** Get user ids (and names) of all Super Admins. Used to alert every admin when any elevation/revoke happens. */
export async function getSuperAdminUserIds(): Promise<{ id: string; name: string }[]> {
  try {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, name, is_super_admin')
      .eq('is_super_admin', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching Super Admins from user_profiles:', error);
      return [];
    }
    if (!profiles || profiles.length === 0) return [];
    return profiles.map((p: any) => ({ id: p.id, name: p.name || 'Admin' }));
  } catch (error: any) {
    console.error('Error in getSuperAdminUserIds:', error);
    return [];
  }
}

// Create a new user (for admin) - using Supabase Auth
export async function createUser(userData: {
  username: string;
  name: string;
  email?: string;
  baseRole: 'Admin' | 'Lecturer';
  roles: string[];
  password: string;
  lecturerCategory?: 'Undergraduate' | 'Postgraduate';
  isSuperAdmin?: boolean;
  campus?: string;
  department?: string;
  courseUnit?: string;
}): Promise<{ user: User | null; error: string | null }> {
  try {
    if (!userData.email) {
      return { user: null, error: 'Email is required to create a user.' };
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: userData.email.trim().toLowerCase(),
      password: userData.password,
      options: {
        data: {
          username: userData.username,
          name: userData.name,
          base_role: userData.baseRole,
          roles: userData.roles,
          lecturer_category: userData.lecturerCategory || null,
          is_super_admin: userData.isSuperAdmin ?? false,
          campus: userData.campus || null,
          department: userData.department || null,
          course_unit: userData.courseUnit || null,
        },
        emailRedirectTo: undefined, // No email confirmation for admin-created users
      },
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return { user: null, error: authError.message };
    }

    if (!authData.user) {
      return { user: null, error: 'Failed to create user. No user data returned.' };
    }

    // The trigger should auto-create the profile, but let's verify/create it
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      // Create profile manually if trigger didn't work
      const { error: createError } = await supabase
        .from('user_profiles')
        .insert([
          {
            id: authData.user.id,
            username: userData.username,
            name: userData.name,
            base_role: userData.baseRole,
            roles: userData.roles,
            is_super_admin: userData.isSuperAdmin ?? false,
            lecturer_category: userData.lecturerCategory || null,
            campus: userData.campus || null,
            department: userData.department || null,
            course_unit: userData.courseUnit || null,
          },
        ]);

      if (createError) {
        console.error('Error creating profile:', createError);
        return { user: null, error: 'User created but profile creation failed.' };
      }
    }

    // Fetch the created profile
    const { data: finalProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    const appUser = authUserToAppUser(
      authData.user,
      finalProfile || {
        id: authData.user.id,
        username: userData.username,
        name: userData.name,
        base_role: userData.baseRole,
        roles: userData.roles,
        is_super_admin: userData.isSuperAdmin ?? false,
      }
    );

    return { user: appUser, error: null };
  } catch (error: any) {
    console.error('Error creating user:', error);
    return { user: null, error: error?.message || 'An error occurred while creating the user.' };
  }
}

