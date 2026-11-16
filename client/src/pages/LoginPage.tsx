import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, UserCheck, Truck, Lock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from '../components/BrandLogo';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, registerCustomer } = useAuth();

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
    const customRedirect = searchParams.get('redirect');
    if (customRedirect && role === 'CUSTOMER') {
      navigate(customRedirect);
      return;
    }
    if (role === 'ADMIN') navigate('/admin');
    else if (role === 'DISPATCHER') navigate('/dispatcher');
    else navigate('/dashboard');
  };

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

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Full Name</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ngozi Okafor"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Nigerian Phone Number</label>
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

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#D64545]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-sm font-bold transition-colors disabled:opacity-60"
            >
              {submitting
                ? 'Authenticating...'
                : mode === 'login'
                  ? 'Sign In to BlueFlame'
                  : 'Create Customer Account & Wallet'}
            </button>
          </form>

          <div className="p-3.5 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-xs text-[#073B8C] leading-relaxed">
            <strong>Platform Access Policy:</strong> Public self-registration is strictly for{' '}
            <strong>Customers</strong>. Dispatcher accounts are provisioned exclusively by the Administrator, and
            participating gas retailers are centrally managed without self-service logins.
          </div>
        </div>

        {/* Role-Based Quick Demo Access Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#06265B] text-white rounded-xl p-6 space-y-4 border border-[#073B8C]">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#EAF3FF]/80">
                Interactive Role Switching
              </span>
              <h2 className="text-lg font-extrabold mt-0.5">Explore All 3 Platform Portals</h2>
              <p className="text-xs text-[#EAF3FF]/80 mt-1">
                Sign in instantly to inspect connected live workflows across Customer, Dispatcher, and Administrator
                dashboards.
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleQuickDemo('amaka.nwosu@example.com', 'Customer@2026')}
                className="w-full text-left p-3.5 rounded-lg bg-white text-[#172B4D] hover:bg-[#EAF3FF] transition-colors flex items-start gap-3"
              >
                <div className="p-2 rounded-lg bg-[#EAF3FF] text-[#073B8C] shrink-0">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-[#06265B]">Customer Portal — Amaka Nwosu</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    ₦45,000 wallet · Active In-Transit order · Saved Lekki & VI addresses
                  </div>
                  <div className="text-[10px] font-mono text-[#1769C2] mt-1">amaka.nwosu@example.com</div>
                </div>
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleQuickDemo('emeka.dispatch@blueflame.ng', 'Dispatch@2026')}
                className="w-full text-left p-3.5 rounded-lg bg-white text-[#172B4D] hover:bg-[#EAF3FF] transition-colors flex items-start gap-3"
              >
                <div className="p-2 rounded-lg bg-[#EAF3FF] text-[#073B8C] shrink-0">
                  <Truck className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-[#06265B]">Dispatcher Field App — Emeka Obi</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    Assigned jobs · 8-stage workflow · Live GPS toggle · Earnings ledger
                  </div>
                  <div className="text-[10px] font-mono text-[#1769C2] mt-1">emeka.dispatch@blueflame.ng</div>
                </div>
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleQuickDemo('admin@blueflame.ng', 'Admin@BlueFlame2026')}
                className="w-full text-left p-3.5 rounded-lg bg-white text-[#172B4D] hover:bg-[#EAF3FF] transition-colors flex items-start gap-3"
              >
                <div className="p-2 rounded-lg bg-[#EAF3FF] text-[#073B8C] shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-[#06265B]">Administrator Console — Chinedu Okafor</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    Retailers & Map · Pricing · Auto-Dispatch · Settlements · Refunds
                  </div>
                  <div className="text-[10px] font-mono text-[#1769C2] mt-1">admin@blueflame.ng</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
