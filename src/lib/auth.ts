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
  };
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

    // Test connection by checking auth
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.log('Supabase connection test error:', {
        code: error.message,
        message: error.message
      });
      // Auth errors are OK for connection test - just means not logged in
      return { success: true, error: 'Connection OK (not authenticated)' };
    }
    
    return { success: true, data: { connected: true } };
  } catch (error: any) {
    return { success: false, error: error.message || 'Connection test failed' };
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

// Get all users (for admin purposes) - using user_profiles
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

    // Convert profiles to User format
    const users: User[] = profiles.map((profile: any) => ({
      id: profile.id,
      name: profile.name,
      baseRole: profile.base_role as 'Admin' | 'Lecturer',
      roles: profile.roles as any[],
      password: '',
      email: profile.email || '', // Email stored in profile
      isSuperAdmin: profile.is_super_admin || false,
      campus: profile.campus,
      department: profile.department,
    }));

    return users;
  } catch (error: any) {
    console.error('Error fetching users:', error);
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
            is_super_admin: false,
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

    const appUser = authUserToAppUser(authData.user, finalProfile || {
      id: authData.user.id,
      username: userData.username,
      name: userData.name,
      base_role: userData.baseRole,
      roles: userData.roles,
      is_super_admin: false,
    });

    return { user: appUser, error: null };
  } catch (error: any) {
    console.error('Error creating user:', error);
    return { user: null, error: error?.message || 'An error occurred while creating the user.' };
  }
}

