import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, UserCheck, Truck, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from '../components/BrandLogo';

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    user,
    login,
    loginWithGoogle,
    registerCustomer,
    oauthLoading,
    oauthError,
    googleAuthAvailable,
    consumeOAuthRedirect,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>(
    searchParams.get('mode') === 'register' ? 'register' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const redirectUser = (role: string) => {
    const storedOAuthRedirect = consumeOAuthRedirect();
    const customRedirect = searchParams.get('redirect') || storedOAuthRedirect;
    if (customRedirect && role === 'CUSTOMER') {
      navigate(customRedirect, { replace: true });
      return;
    }
    if (role === 'ADMIN') navigate('/admin', { replace: true });
    else if (role === 'DISPATCHER') navigate('/dispatcher', { replace: true });
    else navigate('/dashboard', { replace: true });
  };

  // Auto-redirect after Supabase Google OAuth exchange resolves
  useEffect(() => {
    if (user && !oauthLoading) {
      redirectUser(user.role);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, oauthLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const u = await login(email.trim(), password);
        redirectUser(u.role);
      } else {
        const u = await registerCustomer({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
        });
        redirectUser(u.role);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleClick = async () => {
    setError('');
    try {
      await loginWithGoogle(searchParams.get('redirect') || undefined);
    } catch (err) {
      setError((err as Error).message || 'Could not start Google sign-in.');
    }
  };

  const handleQuickDemo = async (demoEmail: string, demoPassword: string) => {
    setError('');
    setSubmitting(true);
    try {
      const u = await login(demoEmail, demoPassword);
      redirectUser(u.role);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = error || oauthError || '';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Auth Card */}
        <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <BrandLogo />
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#16834A] bg-[#ECFDF3] px-2.5 py-1 rounded-md border border-[#BBF7D0]">
              <Lock className="w-3 h-3" /> Encrypted Access
            </span>
          </div>

          <div className="grid grid-cols-2 p-1 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`py-2 text-xs font-bold rounded-md transition-colors ${
                mode === 'login' ? 'bg-[#073B8C] text-white' : 'text-[#64748B] hover:text-[#06265B]'
              }`}
            >
              Sign In (All Roles)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`py-2 text-xs font-bold rounded-md transition-colors ${
                mode === 'register' ? 'bg-[#073B8C] text-white' : 'text-[#64748B] hover:text-[#06265B]'
              }`}
            >
              New Customer Account
            </button>
          </div>

          {/* Google OAuth via Supabase */}
          {googleAuthAvailable && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={submitting || oauthLoading}
                onClick={() => void handleGoogleClick()}
                className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-[#F7F9FC] border border-[#CBD5E1] text-[#172B4D] text-sm font-bold transition-colors flex items-center justify-center gap-2.5 shadow-xs disabled:opacity-60"
              >
                {oauthLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#073B8C]" />
                    <span>Completing Google Sign-In...</span>
                  </>
                ) : (
                  <>
                    <GoogleIcon />
                    <span>
                      {mode === 'login' ? 'Continue with Google' : 'Sign Up with Google'}
                    </span>
                  </>
                )}
              </button>
              <div className="relative flex items-center justify-center">
                <div className="border-t border-[#E2E8F0] w-full" />
                <span className="bg-white px-3 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider shrink-0">
                  or continue with email
                </span>
                <div className="border-t border-[#E2E8F0] w-full" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Full Name</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Mfoniso Ekpe"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Phone Number (Nigeria)</label>
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 803 000 0000"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
              />
            </div>

            {displayError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#D64545]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{displayError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || oauthLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-sm font-bold transition-colors disabled:opacity-60"
            >
              {submitting
                ? 'Authenticating...'
                : mode === 'login'
                  ? 'Sign In to Gasflo'
                  : 'Create Customer Account & Wallet'}
            </button>
          </form>

          <div className="p-3.5 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-xs text-[#073B8C] leading-relaxed">
            <strong>Platform Access Policy:</strong> Public self-registration & Google Sign-In automatically provision{' '}
            <strong>Customer</strong> accounts with digital wallets. Dispatcher accounts are onboarded exclusively by
            Gasflo Operations, and Uyo gas retailers are centrally managed without self-service logins.
          </div>
        </div>

      </div>
    </div>
  );
}
