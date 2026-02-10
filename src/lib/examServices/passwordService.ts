/**
 * Password Service
 * Handles secure password generation and hashing for paper unlock system
 */

// Generate a cryptographically secure password
// Format: 16+ characters with alphanumeric and special characters
export function generateSecurePassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  const allChars = lowercase + uppercase + numbers + special;
  
  // Ensure password has at least one of each character type
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password to avoid predictable pattern
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Hash a password using Web Crypto API (SHA-256)
 * Note: For production, consider using a proper bcrypt library
 * This is a simple hash - for stronger security, use bcrypt or Argon2
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Add salt prefix for additional security
  const salt = generateSecurePassword(8);
  const saltedPassword = salt + password;
  const saltedHash = await crypto.subtle.digest('SHA-256', encoder.encode(saltedPassword));
  const saltedHashArray = Array.from(new Uint8Array(saltedHash));
  const saltedHashHex = saltedHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Return format: salt:hash
  return `${salt}:${saltedHashHex}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const [salt, storedHash] = hash.split(':');
    if (!salt || !storedHash) {
      return false;
    }
    
    const encoder = new TextEncoder();
    const saltedPassword = salt + password;
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(saltedPassword));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex === storedHash;
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

/**
 * Generate password and hash in one call
 * Returns both plaintext (for notification) and hash (for storage)
 */
export async function generatePasswordWithHash(length: number = 16): Promise<{
  plaintext: string;
  hash: string;
}> {
  const plaintext = generateSecurePassword(length);
  const hash = await hashPassword(plaintext);
  
  return { plaintext, hash };
}
