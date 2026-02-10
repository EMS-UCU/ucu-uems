import { useState, useEffect, type FormEvent } from 'react';
import { Mail, Lock, AlertCircle, CheckCircle2, Loader2, Eye, EyeOff } from 'lucide-react';
import ucuExamBg from './assets/ucu-exam.jpg';
import ucuLogo from './assets/ucu-logo.jpg';
import { testSupabaseConnection } from './lib/auth';

interface HomePageProps {
  users: Array<{
    id: string;
    name: string;
    baseRole: 'Admin' | 'Lecturer';
    roles: string[];
    password: string;
  }>;
  onLogin: (email: string, password: string) => Promise<boolean>;
  authError: string | null;
  onClearError: () => void;
}

type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | null;

export default function HomePage({
  users,
  onLogin,
  authError,
  onClearError,
}: HomePageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Test Supabase connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      setConnectionStatus('checking');
      const result = await testSupabaseConnection();
      setConnectionStatus(result.success ? 'connected' : 'disconnected');
      if (!result.success && result.error) {
        console.warn('Connection test:', result.error);
      }
    };
    checkConnection();
  }, []);

  const validateEmail = (emailValue: string): boolean => {
    setEmailError('');
    if (!emailValue.trim()) {
      setEmailError('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue.trim())) {
      setEmailError('Please enter a valid email address');
      return false;
    }
    return true;
  };

  const validatePassword = (passwordValue: string): boolean => {
    setPasswordError('');
    if (!passwordValue.trim()) {
      setPasswordError('Password is required');
      return false;
    }
    if (passwordValue.trim().length < 3) {
      setPasswordError('Password must be at least 3 characters');
      return false;
    }
    return true;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onClearError();
    setEmailError('');
    setPasswordError('');
    
    // Validate inputs
    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);
    
    if (!isEmailValid || !isPasswordValid) {
      return;
    }
    
    setIsLoading(true);
    try {
      // Login with email and password
      const success = await onLogin(email.trim().toLowerCase(), password.trim());
      if (!success) {
        // Error is already set by onLogin
        console.log('Login failed');
      }
    } catch (error: any) {
      console.error('Login error in HomePage:', error);
      // Error handling is done in App.tsx
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setEmailError('');
    onClearError();
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    setPasswordError('');
    onClearError();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 via-blue-800 to-blue-900 relative overflow-hidden w-full">
      {/* Background Image - University Buildings */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${ucuExamBg})`,
        }}
      />

      {/* Header Navigation */}
      <header className="relative z-20 bg-blue-950/90 backdrop-blur-sm border-b border-blue-800/50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-center">
            <div className="text-white font-semibold text-lg">
              Uganda Christian University E-Exam Manager
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Login Form */}
      <main className="relative z-20 flex items-center justify-center min-h-[calc(100vh-200px)] px-4 py-12">
        <div className="w-full max-w-md">
          {/* Login Card */}
          <div className="bg-gradient-to-b from-white via-white/95 to-blue-900/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-sm">
            {/* Top Section - White Background with Logo */}
            <div className="bg-white px-8 pt-8 pb-6">
              <div className="flex items-center gap-4 mb-4">
                {/* UCU Logo */}
                <div className="flex-shrink-0">
                  <img
                    src={ucuLogo}
                    alt="Uganda Christian University Logo"
                    className="w-20 h-20 object-contain drop-shadow-md"
                  />
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                    UGANDA CHRISTIAN UNIVERSITY
                  </h1>
                  <p className="text-sm text-red-600 font-medium mt-1">
                    A Centre of Excellence in the Heart of Africa
                  </p>
                </div>
              </div>
            </div>

            {/* Middle Section - Dark Blue/Purple Background with Login Form */}
            <div className="bg-gradient-to-b from-blue-900 via-blue-800 to-purple-900 px-8 py-6">
              {/* Connection Status */}
              {connectionStatus === 'checking' && (
                <div className="mb-4 rounded-lg border border-blue-400/40 bg-blue-500/10 px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-300" />
                  <p className="text-sm font-medium text-blue-200">Checking database connection...</p>
                </div>
              )}
              
              {connectionStatus === 'disconnected' && (
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-200">Database Connection Warning</p>
                    <p className="text-xs text-amber-200/80 mt-1">
                      Add your Supabase anon key to the <code className="bg-amber-900/50 px-1 rounded">.env</code> file (VITE_SUPABASE_ANON_KEY). Get it from Supabase Dashboard → Settings → API, then restart the dev server.
                    </p>
                  </div>
                </div>
              )}

              {connectionStatus === 'connected' && (
                <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  <p className="text-sm font-medium text-emerald-200">Database connected</p>
                </div>
              )}

              {/* Authentication Error */}
              {authError && (
                <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-rose-200">Login Failed</p>
                    <p className="text-xs text-rose-200/80 mt-1">{authError}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-3">
                  {/* Email Input */}
                  <div>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => handleEmailChange(e.target.value)}
                        onBlur={() => validateEmail(email)}
                        placeholder="Email address"
                        className={`w-full pl-12 pr-4 py-3 rounded-lg bg-gray-100 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:bg-white transition ${
                          emailError ? 'ring-2 ring-rose-500' : 'focus:ring-pink-500'
                        }`}
                        disabled={isLoading}
                        autoComplete="email"
                      />
                    </div>
                    {emailError && (
                      <p className="mt-1.5 text-xs text-rose-300 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {emailError}
                      </p>
                    )}
                  </div>

                  {/* Password Input */}
                  <div>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        onBlur={() => validatePassword(password)}
                        placeholder="Password"
                        className={`w-full pl-12 pr-12 py-3 rounded-lg bg-gray-100 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:bg-white transition ${
                          passwordError ? 'ring-2 ring-rose-500' : 'focus:ring-pink-500'
                        }`}
                        disabled={isLoading}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
                        disabled={isLoading}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                    {passwordError && (
                      <p className="mt-1.5 text-xs text-rose-300 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {passwordError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading || !email.trim() || !password.trim()}
                  className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-pink-500 to-pink-600 text-white font-semibold hover:from-pink-600 hover:to-pink-700 transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>NEXT</span>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </>
                  )}
                </button>

                <div className="pt-2 space-y-3">
                  <p className="text-sm text-blue-200">
                    By signing in, I agree to the{' '}
                    <a href="#" className="underline hover:text-blue-100">
                      Terms & Conditions
                    </a>
                  </p>
                  <p className="text-sm text-blue-200">
                    Forgot Password?{' '}
                    <a href="#" className="underline hover:text-blue-100">
                      Reset Here
                    </a>
                  </p>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-20 bg-transparent">
        <div className="container mx-auto px-6 py-4">
          <p className="text-white text-sm">
            © 2025 Uganda Christian University
          </p>
        </div>
      </footer>
    </div>
  );
}

