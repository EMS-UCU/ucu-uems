import { supabase } from './supabase';

const BUCKET_NAME = 'role_conscents';

/** Map role to file path in bucket. Adjust paths to match your uploaded files. */
const ROLE_TO_FILE_PATH: Record<string, string> = {
  'Chief Examiner': 'Chief Examiner Conscent.pdf',
  'Team Lead': 'Team Lead Conscent.pdf',
  Vetter: 'Vetter Conscent.pdf',
  Setter: 'Setter Conscent.pdf',
};

/** Alternative paths if files use different naming (e.g. with hyphens) */
const ROLE_TO_ALT_PATHS: Record<string, string[]> = {
  'Chief Examiner': ['Chief-Examiner-Conscent.pdf', 'Chief_Examiner_Conscent.pdf'],
  'Team Lead': ['Team-Lead-Conscent.pdf', 'Team_Lead_Conscent.pdf'],
  Vetter: ['Vetter-Conscent.pdf', 'Vetter_Conscent.pdf'],
  Setter: ['Setter-Conscent.pdf', 'Setter_Conscent.pdf'],
};

export interface RoleDocumentInfo {
  role: string;
  title: string;
  filePath: string | null;
  url: string | null;
  error?: string;
}

/**
 * Get view/download URL for a role's consent document from Supabase Storage.
 * Uses signed URL for private buckets; falls back to public URL.
 */
export async function getRoleConsentDocumentUrl(
  role: string,
  expiresIn = 3600
): Promise<{ url: string | null; error?: string }> {
  const primaryPath = ROLE_TO_FILE_PATH[role];
  const altPaths = ROLE_TO_ALT_PATHS[role] || [];
  const pathsToTry = primaryPath ? [primaryPath, ...altPaths] : altPaths;

  for (const filePath of pathsToTry) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, expiresIn);

    if (!error && data?.signedUrl) {
      return { url: data.signedUrl };
    }
  }

  // Fallback: try getPublicUrl (for public buckets)
  const path = primaryPath || pathsToTry[0];
  if (path) {
    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    return { url: data.publicUrl };
  }

  return {
    url: null,
    error: `No file path configured for role: ${role}`,
  };
}

/**
 * List available consent documents for the given roles.
 * Fetches URLs for each role the user has.
 */
export async function getRoleConsentDocuments(
  userRoles: string[]
): Promise<RoleDocumentInfo[]> {
  const workflowRoles = ['Chief Examiner', 'Team Lead', 'Vetter', 'Setter'];
  const relevantRoles = workflowRoles.filter((r) => userRoles.includes(r));

  const results: RoleDocumentInfo[] = await Promise.all(
    relevantRoles.map(async (role) => {
      const filePath = ROLE_TO_FILE_PATH[role];
      const { url, error } = await getRoleConsentDocumentUrl(role);
      return {
        role,
        title: `${role} Consent`,
        filePath: filePath || null,
        url: url || null,
        error,
      };
    })
  );

  return results;
}
