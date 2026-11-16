import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  MapPin,
  ShoppingCart,
  Wallet,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  Truck,
  LayoutDashboard,
  ChevronDown,
  LocateFixed,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '../context/AuthContext';
import { useLocationContext } from '../context/LocationContext';
import { useCart } from '../context/CartContext';
import { formatNaira } from '../lib/format';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';

export function Navbar() {
  const { user, walletBalanceKobo, logout } = useAuth();
  const { location, setLocation, detectGpsLocation, locating } = useLocationContext();
  const { totalItems } = useCart();
  const route = useLocation();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [locMenuOpen, setLocMenuOpen] = useState(false);

  const dashboardPath =
    user?.role === 'ADMIN'
      ? '/admin'
      : user?.role === 'DISPATCHER'
        ? '/dispatcher'
        : '/dashboard';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const navLinkClass = (path: string) =>
    `text-sm font-semibold px-3 py-2 rounded-lg transition-colors ${
      route.pathname === path
        ? 'bg-[#EAF3FF] text-[#073B8C]'
        : 'text-[#172B4D] hover:bg-[#F7F9FC] hover:text-[#073B8C]'
    }`;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[#E2E8F0] no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Brand */}
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/" className="shrink-0">
              <BrandLogo />
            </Link>

            {/* Quick Location Selector */}
            <div className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setLocMenuOpen((o) => !o)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F7F9FC] hover:border-[#1769C2] text-left max-w-[240px] transition-colors"
              >
                <MapPin className="w-4 h-4 text-[#073B8C] shrink-0" />
                <div className="truncate">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[#64748B] leading-none">
                    Delivering to
                  </div>
                  <div className="text-xs font-bold text-[#06265B] truncate mt-0.5">{location.label}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
              </button>

              {locMenuOpen && (
                <div className="absolute left-0 mt-2 w-72 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 p-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await detectGpsLocation();
                      setLocMenuOpen(false);
                    }}
                    disabled={locating}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-[#073B8C] bg-[#EAF3FF] hover:bg-[#dbeafe] mb-1.5 transition-colors"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    {locating ? 'Detecting GPS...' : 'Use My Current GPS Location'}
                  </button>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B] px-2 py-1">
                    Popular Service Areas (Nigeria)
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-[#F1F5F9]">
                    {NIGERIAN_PRESET_LOCATIONS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setLocation(preset);
                          setLocMenuOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-md text-xs hover:bg-[#F7F9FC] ${
                          location.label === preset.label ? 'bg-[#EAF3FF]/60 font-bold text-[#073B8C]' : 'text-[#172B4D]'
                        }`}
                      >
                        <div className="font-semibold">{preset.label}</div>
                        <div className="text-[11px] text-[#64748B] truncate">{preset.addressLine}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Primary Navigation (Strictly Customer Marketplace & Authenticated Role Portals — ZERO Retailer Signup!) */}
          <nav className="hidden lg:flex items-center gap-1">
            <Link to="/" className={navLinkClass('/')}>
              Home
            </Link>
            <Link to="/explore" className={navLinkClass('/explore')}>
              Explore Map & Compare
            </Link>
            {user && (
              <Link to={dashboardPath} className={navLinkClass(dashboardPath)}>
                <span className="inline-flex items-center gap-1.5">
                  {user.role === 'ADMIN' ? (
                    <ShieldCheck className="w-4 h-4" />
                  ) : user.role === 'DISPATCHER' ? (
                    <Truck className="w-4 h-4" />
                  ) : (
                    <LayoutDashboard className="w-4 h-4" />
                  )}
                  {user.role === 'ADMIN'
                    ? 'Admin Console'
                    : user.role === 'DISPATCHER'
                      ? 'Dispatcher Portal'
                      : 'My Dashboard'}
                </span>
              </Link>
            )}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            {user?.role === 'CUSTOMER' && (
              <Link
                to="/dashboard?tab=wallet"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-[#073B8C] text-xs font-bold tabular-nums hover:bg-[#dbeafe] transition-colors"
                title="Digital Wallet Balance"
              >
                <Wallet className="w-3.5 h-3.5" />
                {formatNaira(walletBalanceKobo)}
              </Link>
            )}

            {(!user || user.role === 'CUSTOMER') && (
              <Link
                to="/checkout"
                className="relative inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F0] bg-white text-[#172B4D] hover:border-[#1769C2] hover:text-[#073B8C] text-xs font-semibold transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Cart</span>
                {totalItems > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#073B8C] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {totalItems}
                  </span>
                )}
              </Link>
            )}

            {user ? (
              <>
                <NotificationBell />
                <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#E2E8F0]">
                  <Link to={dashboardPath} className="text-right leading-tight">
                    <div className="text-xs font-bold text-[#06265B] max-w-[130px] truncate">{user.full_name}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#1769C2]">{user.role}</div>
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="p-2 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#D64545] hover:border-[#FECACA] transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  to="/login"
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#073B8C] border border-[#E2E8F0] hover:bg-[#EAF3FF] transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/login?mode=register"
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#073B8C] hover:bg-[#06265B] transition-colors"
                >
                  Create Account
                </Link>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              className="lg:hidden p-2 rounded-lg border border-[#E2E8F0] text-[#172B4D]"
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-[#E2E8F0] bg-white px-4 py-3 space-y-2">
          <div className="pb-2 border-b border-[#E2E8F0]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
              Delivery Location
            </div>
            <select
              value={location.label}
              onChange={(e) => {
                const found = NIGERIAN_PRESET_LOCATIONS.find((p) => p.label === e.target.value);
                if (found) setLocation(found);
              }}
              className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-[#E2E8F0] bg-[#F7F9FC] text-[#06265B]"
            >
              {NIGERIAN_PRESET_LOCATIONS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Link to="/" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-semibold text-[#172B4D]">
            Home
          </Link>
          <Link
            to="/explore"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-semibold text-[#172B4D]"
          >
            Explore Nearby Retailers & Map
          </Link>
          {user ? (
            <>
              <Link
                to={dashboardPath}
                onClick={() => setMobileOpen(false)}
                className="block py-2 text-sm font-semibold text-[#073B8C]"
              >
                {user.role === 'ADMIN'
                  ? 'Administrator Console'
                  : user.role === 'DISPATCHER'
                    ? 'Dispatcher Field Dashboard'
                    : 'Customer Dashboard'}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  void handleLogout();
                }}
                className="w-full text-left py-2 text-sm font-semibold text-[#D64545]"
              >
                Sign Out ({user.full_name})
              </button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="text-center py-2.5 rounded-lg border border-[#073B8C] text-[#073B8C] text-xs font-bold"
              >
                Sign In
              </Link>
              <Link
                to="/login?mode=register"
                onClick={() => setMobileOpen(false)}
                className="text-center py-2.5 rounded-lg bg-[#073B8C] text-white text-xs font-bold"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
