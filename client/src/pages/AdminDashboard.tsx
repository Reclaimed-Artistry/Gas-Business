import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Store,
  Tag,
  Truck,
  Users,
  Landmark,
  Settings,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Star,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { apiRequest, subscribeToPlatformEvents } from '../lib/api';
import { formatDateTime, formatNaira } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { AdminRetailersPanel, type AdminRetailerRow } from './admin/AdminRetailersPanel';
import { AdminPricingPanel } from './admin/AdminPricingPanel';
import { AdminOrdersPanel, type AdminOrderRow } from './admin/AdminOrdersPanel';
import { AdminFinancePanel } from './admin/AdminFinancePanel';

type AdminTab = 'overview' | 'orders' | 'retailers' | 'pricing' | 'dispatchers' | 'customers' | 'finance' | 'platform';

interface OverviewResponse {
  kpis: {
    totalCustomers: number;
    totalRetailers: number;
    activeRetailers: number;
    pendingRetailers: number;
    totalDispatchers: number;
    activeDispatchers: number;
    totalOrders: number;
    awaitingAssignment: number;
    activeDeliveries: number;
    completedDeliveries: number;
    failedDeliveries: number;
    openComplaints: number;
    grossOrderVolumeKobo: number;
    platformRevenueKobo: number;
    pendingRetailerSettlementsKobo: number;
    pendingDispatcherPayoutsKobo: number;
    totalCustomerWalletLiabilityKobo: number;
  };
  coverageByState: {
    state: string;
    city: string;
    total_retailers: number;
    active_retailers: number;
    avg_radius_km: number;
  }[];
  retailerRevenueRank: {
    id: number;
    business_name: string;
    neighbourhood: string;
    orders_count: number;
    gmv_kobo: number;
    margin_kobo: number;
  }[];
  recentOrders: {
    id: number;
    order_reference: string;
    customer_name: string;
    retailer_name: string;
    dispatcher_name: string | null;
    status: string;
    total_amount_kobo: number;
    created_at: string;
  }[];
}

interface DispatcherRow {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  vehicle_type: string;
  plate_number: string;
  license_number: string;
  zone: string;
  availability_status: string;
  compensation_model: string;
  base_rate_kobo: number;
  per_km_rate_kobo: number;
  rating_avg: number;
  completed_deliveries_count: number;
  active_jobs_count: number;
  total_earned_kobo: number;
}

interface CustomerRow {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  wallet_balance_kobo: number;
  orders_count: number;
  total_spent_kobo: number;
  created_at: string;
}

interface PromoRow {
  id: number;
  code: string;
  title: string;
  discount_type: string;
  discount_value: number;
  min_order_kobo: number;
  used_count: number;
  usage_limit: number;
  valid_until: string;
  is_active: number;
}

interface ComplaintRow {
  id: number;
  ticket_number: string;
  customer_name: string;
  customer_phone: string;
  order_reference: string | null;
  category: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  admin_response: string;
  created_at: string;
}

interface ReviewRow {
  id: number;
  order_reference: string;
  customer_name: string;
  retailer_name: string;
  dispatcher_name: string | null;
  retailer_rating: number;
  dispatcher_rating: number | null;
  comment: string;
  is_visible: number;
  created_at: string;
}

export function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [retailers, setRetailers] = useState<AdminRetailerRow[]>([]);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [dispatchers, setDispatchers] = useState<DispatcherRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [promotions, setPromotions] = useState<PromoRow[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Create Dispatcher Form (Exclusive to Administrator)
  const [showDispForm, setShowDispForm] = useState(false);
  const [dispForm, setDispForm] = useState({
    fullName: '',
    email: '',
    phone: '+234 ',
    password: '',
    vehicleType: 'Heavy-Duty Delivery Motorcycle',
    plateNumber: '',
    licenseNumber: '',
    zone: 'Ewet Housing / Oron Road / Shelter Afrique',
    compensationModel: 'FIXED_PLUS_DISTANCE',
    baseRateNaira: '750',
    perKmRateNaira: '75',
  });

  // Create Customer Form
  const [showCustForm, setShowCustForm] = useState(false);
  const [custForm, setCustForm] = useState({ fullName: '', email: '', phone: '+234 ', password: '' });

  // Create Promo Form
  const [promoForm, setPromoForm] = useState({
    code: '',
    title: '',
    discountType: 'FIXED',
    discountValue: '500',
    minOrderNaira: '8000',
    maxDiscountNaira: '2000',
    validFrom: '2026-01-01',
    validUntil: '2027-12-31',
  });

  const flash = (msg: string) => {
    setNotice(msg);
    setError('');
    setTimeout(() => setNotice(''), 4500);
  };

  const loadAll = useCallback(async () => {
    try {
      const [ov, ret, ord, disp, cust, promo, comp, rev, cfg] = await Promise.all([
        apiRequest<OverviewResponse>('/api/admin/overview'),
        apiRequest<{ retailers: AdminRetailerRow[] }>('/api/admin/retailers'),
        apiRequest<{ orders: AdminOrderRow[] }>('/api/admin/orders'),
        apiRequest<{ dispatchers: DispatcherRow[] }>('/api/admin/dispatchers'),
        apiRequest<{ customers: CustomerRow[] }>('/api/admin/customers'),
        apiRequest<{ promotions: PromoRow[] }>('/api/admin/promotions'),
        apiRequest<{ complaints: ComplaintRow[] }>('/api/admin/complaints'),
        apiRequest<{ reviews: ReviewRow[] }>('/api/admin/reviews'),
        apiRequest<{ settings: Record<string, Record<string, unknown>> }>('/api/admin/settings'),
      ]);
      setOverview(ov);
      setRetailers(ret.retailers);
      setOrders(ord.orders);
      setDispatchers(disp.dispatchers);
      setCustomers(cust.customers);
      setPromotions(promo.promotions);
      setComplaints(comp.complaints);
      setReviews(rev.reviews);
      setSettings(cfg.settings);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return subscribeToPlatformEvents({
      onOrderUpdate: () => void loadAll(),
      onDispatcherUpdate: () => void loadAll(),
      onNotification: () => void loadAll(),
    });
  }, [loadAll]);

  const handleCreateDispatcher = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/dispatchers', {
        method: 'POST',
        body: {
          ...dispForm,
          baseRateNaira: Number(dispForm.baseRateNaira),
          perKmRateNaira: Number(dispForm.perKmRateNaira),
        },
      });
      setShowDispForm(false);
      setDispForm({
        fullName: '',
        email: '',
        phone: '+234 ',
        password: '',
        vehicleType: 'Heavy-Duty Delivery Motorcycle',
        plateNumber: '',
        licenseNumber: '',
        zone: 'Ewet Housing / Oron Road / Shelter Afrique',
        compensationModel: 'FIXED_PLUS_DISTANCE',
        baseRateNaira: '750',
        perKmRateNaira: '75',
      });
      flash('Dispatcher account provisioned with login credentials.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/customers', { method: 'POST', body: custForm });
      setShowCustForm(false);
      setCustForm({ fullName: '', email: '', phone: '+234 ', password: '' });
      flash('Customer account and digital wallet created.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/promotions', {
        method: 'POST',
        body: {
          ...promoForm,
          discountValue: Number(promoForm.discountValue),
          minOrderNaira: Number(promoForm.minOrderNaira),
          maxDiscountNaira: Number(promoForm.maxDiscountNaira),
        },
      });
      setPromoForm({ ...promoForm, code: '', title: '' });
      flash('Promotion created.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/settings', { method: 'PUT', body: settings });
      flash('Platform commercial settings and homepage CMS updated.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const tabs: { key: AdminTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'orders', label: 'Orders & Dispatch', icon: Package, badge: overview?.kpis.awaitingAssignment },
    { key: 'retailers', label: 'Retailers & Map', icon: Store, badge: overview?.kpis.pendingRetailers },
    { key: 'pricing', label: 'Products & Pricing', icon: Tag },
    { key: 'dispatchers', label: 'Dispatchers', icon: Truck },
    { key: 'customers', label: 'Customers', icon: Users },
    { key: 'finance', label: 'Finance & Ledger', icon: Landmark },
    { key: 'platform', label: 'Platform & CMS', icon: Settings, badge: overview?.kpis.openComplaints },
  ];

  const chartData = (overview?.retailerRevenueRank || []).map((r) => ({
    name: r.business_name.split(' ').slice(0, 2).join(' '),
    GMV: Math.round(r.gmv_kobo / 100),
    Margin: Math.round(r.margin_kobo / 100),
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="bg-[#06265B] text-white rounded-xl p-5 border border-[#073B8C] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#EAF3FF]/80">
            <ShieldCheck className="w-4 h-4" />
            Gasflo Operations Administrator Control Center
          </div>
          <h1 className="text-2xl font-extrabold mt-0.5">Central Marketplace & Logistics Command</h1>
          <p className="text-xs text-[#EAF3FF]/80 mt-0.5">
            Complete control over vetted retailers, independent pricing, field dispatchers, verified cashless payments,
            and financial settlements.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="bg-white/10 border border-white/15 rounded-lg px-3.5 py-2">
            <div className="text-[#EAF3FF]/75">Awaiting Dispatch</div>
            <div className="text-lg font-extrabold tabular-nums">{overview?.kpis.awaitingAssignment ?? 0}</div>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-lg px-3.5 py-2">
            <div className="text-[#EAF3FF]/75">Active Fleet</div>
            <div className="text-lg font-extrabold tabular-nums">
              {overview?.kpis.activeDispatchers ?? 0}/{overview?.kpis.totalDispatchers ?? 0}
            </div>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-lg px-3.5 py-2">
            <div className="text-[#EAF3FF]/75">Verified GMV</div>
            <div className="text-lg font-extrabold tabular-nums">
              {formatNaira(overview?.kpis.grossOrderVolumeKobo ?? 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto gap-1.5 pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
              tab === t.key
                ? 'bg-[#073B8C] text-white border-[#073B8C]'
                : 'bg-white text-[#172B4D] border-[#E2E8F0] hover:border-[#1769C2]'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.badge && t.badge > 0 ? (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-[#E99A25] text-white text-[10px] font-extrabold tabular-nums">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-[#ECFDF3] border border-[#BBF7D0] text-xs font-semibold text-[#16834A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#D64545] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {[
              {
                label: 'Total Customers',
                val: overview.kpis.totalCustomers,
                sub: `Wallet liabilities: ${formatNaira(overview.kpis.totalCustomerWalletLiabilityKobo)}`,
              },
              {
                label: 'Registered Retailers',
                val: `${overview.kpis.activeRetailers} / ${overview.kpis.totalRetailers}`,
                sub: `${overview.kpis.pendingRetailers} pending approval`,
              },
              {
                label: 'Active / Completed Orders',
                val: `${overview.kpis.activeDeliveries} / ${overview.kpis.completedDeliveries}`,
                sub: `${overview.kpis.failedDeliveries} failed · ${overview.kpis.awaitingAssignment} unassigned`,
              },
              {
                label: 'Platform Revenue (Margin+Del)',
                val: formatNaira(overview.kpis.platformRevenueKobo),
                sub: `Settlements due: ${formatNaira(overview.kpis.pendingRetailerSettlementsKobo)}`,
              },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                <div className="text-[#64748B] font-semibold">{card.label}</div>
                <div className="text-2xl font-extrabold text-[#06265B] tabular-nums mt-1">{card.val}</div>
                <div className="text-[11px] text-[#1769C2] font-medium mt-1">{card.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Revenue Analytics Chart */}
            <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-[#06265B]">Order Volume & Platform Margin by Retailer (₦)</h3>
                <p className="text-xs text-[#64748B]">Verified electronic transactions only</p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip formatter={(val: number) => `₦${val.toLocaleString()}`} />
                    <Bar dataKey="GMV" fill="#073B8C" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Margin" fill="#1769C2" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Geographical Coverage Summary */}
            <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#06265B]">Geographical Coverage Monitor</h3>
                <button
                  type="button"
                  onClick={() => setTab('retailers')}
                  className="text-xs font-bold text-[#1769C2] hover:underline"
                >
                  Open Map
                </button>
              </div>
              <div className="divide-y divide-[#E2E8F0] text-xs">
                {overview.coverageByState.map((row, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[#06265B]">
                        {row.city}, {row.state}
                      </div>
                      <div className="text-[11px] text-[#64748B]">
                        Avg coverage radius: {Number(row.avg_radius_km).toFixed(1)} km
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="px-2 py-0.5 rounded bg-[#EAF3FF] text-[#073B8C] font-bold">
                        {row.active_retailers}/{row.total_retailers} active
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] text-[11px] text-[#64748B]">
                Expansion readiness: Currently anchored across Uyo, Akwa Ibom. Add depots in Eket, Ikot Ekpene, Oron,
                Calabar, or other cities anytime from the <strong>Retailers &amp; Map</strong> tab.
              </div>
            </div>
          </div>

          {/* Recent Orders */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#06265B]">Latest Marketplace Orders</h3>
              <button type="button" onClick={() => setTab('orders')} className="text-xs font-bold text-[#1769C2]">
                Manage All Orders →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B]">
                    <th className="py-2.5 px-4 font-bold">Reference</th>
                    <th className="py-2.5 px-4 font-bold">Customer</th>
                    <th className="py-2.5 px-4 font-bold">Retailer</th>
                    <th className="py-2.5 px-4 font-bold">Dispatcher</th>
                    <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                    <th className="py-2.5 px-4 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {overview.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 px-4 font-mono font-bold text-[#073B8C]">{o.order_reference}</td>
                      <td className="py-2.5 px-4 font-semibold text-[#06265B]">{o.customer_name}</td>
                      <td className="py-2.5 px-4">{o.retailer_name}</td>
                      <td className="py-2.5 px-4 text-[#64748B]">{o.dispatcher_name || 'Unassigned'}</td>
                      <td className="py-2.5 px-4 text-right font-bold tabular-nums">{formatNaira(o.total_amount_kobo)}</td>
                      <td className="py-2.5 px-4">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ORDERS & DISPATCH */}
      {tab === 'orders' && (
        <AdminOrdersPanel orders={orders} onReload={() => void loadAll()} onFlash={flash} onError={setError} />
      )}

      {/* TAB 3: RETAILERS & ADMIN COVERAGE MAP */}
      {tab === 'retailers' && (
        <AdminRetailersPanel
          retailers={retailers}
          onReload={() => void loadAll()}
          onFlash={flash}
          onError={setError}
        />
      )}

      {/* TAB 4: PRODUCTS & INDEPENDENT PRICING */}
      {tab === 'pricing' && <AdminPricingPanel retailers={retailers} onFlash={flash} onError={setError} />}

      {/* TAB 5: DISPATCHER MANAGEMENT (EXCLUSIVE CREATION BY ADMIN) */}
      {tab === 'dispatchers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-[#06265B]">Dispatcher Fleet & Account Provisioning</h2>
              <p className="text-xs text-[#64748B]">
                Dispatcher accounts are created exclusively by Administrator. Configure login credentials, zones, and
                delivery compensation rates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDispForm((s) => !s)}
              className="px-3.5 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Create Dispatcher Account
            </button>
          </div>

          {showDispForm && (
            <form
              onSubmit={handleCreateDispatcher}
              className="bg-white border-2 border-[#073B8C] rounded-xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"
            >
              <div className="sm:col-span-3 font-extrabold text-sm text-[#06265B]">
                Provision New Dispatcher Credentials
              </div>
              <input
                required
                value={dispForm.fullName}
                onChange={(e) => setDispForm({ ...dispForm, fullName: e.target.value })}
                placeholder="Full Name *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                type="email"
                required
                value={dispForm.email}
                onChange={(e) => setDispForm({ ...dispForm, email: e.target.value })}
                placeholder="Dispatcher Login Email *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                required
                value={dispForm.phone}
                onChange={(e) => setDispForm({ ...dispForm, phone: e.target.value })}
                placeholder="Phone (+234...)"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                type="password"
                required
                minLength={8}
                value={dispForm.password}
                onChange={(e) => setDispForm({ ...dispForm, password: e.target.value })}
                placeholder="Assigned Password (min 8 chars) *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                required
                value={dispForm.vehicleType}
                onChange={(e) => setDispForm({ ...dispForm, vehicleType: e.target.value })}
                placeholder="Vehicle Type"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                required
                value={dispForm.plateNumber}
                onChange={(e) => setDispForm({ ...dispForm, plateNumber: e.target.value })}
                placeholder="Plate Number (e.g. LND-550-XY)"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg uppercase"
              />
              <input
                required
                value={dispForm.licenseNumber}
                onChange={(e) => setDispForm({ ...dispForm, licenseNumber: e.target.value })}
                placeholder="Driver License Number"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg uppercase"
              />
              <input
                required
                value={dispForm.zone}
                onChange={(e) => setDispForm({ ...dispForm, zone: e.target.value })}
                placeholder="Assigned Operating Zone"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <select
                value={dispForm.compensationModel}
                onChange={(e) => setDispForm({ ...dispForm, compensationModel: e.target.value })}
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
              >
                <option value="FIXED_PLUS_DISTANCE">Fixed + Distance Bonus</option>
                <option value="FIXED">Fixed Amount per Delivery</option>
                <option value="DISTANCE">Distance-Based Only</option>
                <option value="ZONE">Zone-Based Rate</option>
              </select>
              <input
                type="number"
                required
                value={dispForm.baseRateNaira}
                onChange={(e) => setDispForm({ ...dispForm, baseRateNaira: e.target.value })}
                placeholder="Base Rate (₦)"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                type="number"
                required
                value={dispForm.perKmRateNaira}
                onChange={(e) => setDispForm({ ...dispForm, perKmRateNaira: e.target.value })}
                placeholder="Per-km Bonus (₦)"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDispForm(false)}
                  className="px-3 py-2 rounded-lg border border-[#E2E8F0] font-bold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#073B8C] text-white font-bold">
                  Create Dispatcher
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                  <th className="py-3 px-4 font-bold">Dispatcher & Credentials</th>
                  <th className="py-3 px-4 font-bold">Vehicle & Zone</th>
                  <th className="py-3 px-4 font-bold">Availability</th>
                  <th className="py-3 px-4 font-bold">Compensation Model</th>
                  <th className="py-3 px-4 font-bold text-center">Performance</th>
                  <th className="py-3 px-4 font-bold text-right">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {dispatchers.map((d) => (
                  <tr key={d.id}>
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#06265B]">{d.full_name}</div>
                      <div className="text-[11px] text-[#64748B]">
                        {d.email} · {d.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#172B4D]">
                        {d.vehicle_type} ({d.plate_number})
                      </div>
                      <div className="text-[11px] text-[#64748B]">Zone: {d.zone}</div>
                    </td>
                    <td className="py-3 px-4 space-y-1">
                      <StatusBadge status={d.availability_status} />
                      <div className="text-[10px] text-[#64748B]">{d.active_jobs_count} active job(s)</div>
                    </td>
                    <td className="py-3 px-4 tabular-nums">
                      <div className="font-semibold">{d.compensation_model.replace(/_/g, ' ')}</div>
                      <div className="text-[11px] text-[#64748B]">
                        {formatNaira(d.base_rate_kobo)} base + {formatNaira(d.per_km_rate_kobo)}/km
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="font-bold text-[#06265B]">
                        ★ {d.rating_avg.toFixed(1)} · {d.completed_deliveries_count} done
                      </div>
                      <div className="text-[11px] text-[#16834A] font-semibold tabular-nums">
                        Earned: {formatNaira(d.total_earned_kobo)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      <StatusBadge status={d.status} />
                      <button
                        type="button"
                        onClick={async () => {
                          const next = d.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                          await apiRequest(`/api/admin/dispatchers/${d.id}`, {
                            method: 'PATCH',
                            body: { status: next },
                          });
                          flash(`Dispatcher ${d.full_name} set to ${next}.`);
                          void loadAll();
                        }}
                        className="ml-1 px-2 py-1 rounded border border-[#E2E8F0] hover:border-[#073B8C] font-bold text-[#073B8C]"
                      >
                        {d.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: CUSTOMER MANAGEMENT */}
      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-[#06265B]">Customer Accounts & Wallets</h2>
              <p className="text-xs text-[#64748B]">
                Manage registered customers, monitor wallet balances, order totals, and account status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCustForm((s) => !s)}
              className="px-3.5 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Create Customer Account
            </button>
          </div>

          {showCustForm && (
            <form
              onSubmit={handleCreateCustomer}
              className="bg-white border-2 border-[#073B8C] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs"
            >
              <input
                required
                value={custForm.fullName}
                onChange={(e) => setCustForm({ ...custForm, fullName: e.target.value })}
                placeholder="Customer Full Name *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                type="email"
                required
                value={custForm.email}
                onChange={(e) => setCustForm({ ...custForm, email: e.target.value })}
                placeholder="Email *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <input
                required
                value={custForm.phone}
                onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
                placeholder="Phone *"
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={custForm.password}
                  onChange={(e) => setCustForm({ ...custForm, password: e.target.value })}
                  placeholder="Password *"
                  className="flex-1 px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
                <button type="submit" className="px-3.5 py-2 rounded-lg bg-[#073B8C] text-white font-bold">
                  Save
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                  <th className="py-3 px-4 font-bold">Customer</th>
                  <th className="py-3 px-4 font-bold text-right">Wallet Balance</th>
                  <th className="py-3 px-4 font-bold text-center">Orders</th>
                  <th className="py-3 px-4 font-bold text-right">Total Paid</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#06265B]">{c.full_name}</div>
                      <div className="text-[11px] text-[#64748B]">
                        {c.email} · {c.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-[#073B8C] tabular-nums">
                      {formatNaira(c.wallet_balance_kobo)}
                    </td>
                    <td className="py-3 px-4 text-center font-bold tabular-nums">{c.orders_count}</td>
                    <td className="py-3 px-4 text-right font-semibold tabular-nums">
                      {formatNaira(c.total_spent_kobo)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          const next = c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                          await apiRequest(`/api/admin/customers/${c.id}`, {
                            method: 'PATCH',
                            body: { status: next },
                          });
                          flash(`Customer ${c.full_name} marked ${next}.`);
                          void loadAll();
                        }}
                        className="px-2.5 py-1 rounded border border-[#E2E8F0] hover:border-[#073B8C] text-[#073B8C] font-bold"
                      >
                        {c.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: FINANCE, SETTLEMENTS & AUDIT */}
      {tab === 'finance' && <AdminFinancePanel onFlash={flash} onError={setError} />}

      {/* TAB 8: PLATFORM MANAGEMENT (COMPLAINTS, PROMOS, REVIEWS, CMS & SETTINGS) */}
      {tab === 'platform' && (
        <div className="space-y-6">
          {/* Customer Complaints */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
            <h3 className="text-base font-extrabold text-[#06265B] inline-flex items-center gap-2">
              <MessageSquareWarning className="w-4 h-4 text-[#D64545]" />
              Customer Support Tickets & Complaints ({complaints.length})
            </h3>
            <div className="space-y-3 text-xs">
              {complaints.map((c) => (
                <div key={c.id} className="p-4 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-[#1769C2]">{c.ticket_number}</span>
                      {c.order_reference && <span className="text-[#64748B]"> · {c.order_reference}</span>}
                      <div className="font-bold text-[#06265B] text-sm">{c.subject}</div>
                      <div className="text-[11px] text-[#64748B]">
                        {c.customer_name} ({c.customer_phone}) · {formatDateTime(c.created_at)}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-[#172B4D]">{c.description}</p>
                  {c.admin_response && (
                    <div className="p-2 rounded bg-[#EAF3FF] text-[#073B8C]">
                      <strong>Response:</strong> {c.admin_response}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        const resp = window.prompt(
                          `Resolve ticket ${c.ticket_number}. Enter response to customer:`,
                          c.admin_response || 'We have reviewed your delivery issue and resolved it promptly.'
                        );
                        if (!resp) return;
                        await apiRequest(`/api/admin/complaints/${c.id}`, {
                          method: 'PATCH',
                          body: { status: 'RESOLVED', adminResponse: resp },
                        });
                        flash(`Complaint ${c.ticket_number} resolved & customer notified.`);
                        void loadAll();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#073B8C] text-white font-bold"
                    >
                      Respond & Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Promotions Management */}
            <div className="lg:col-span-6 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4 text-xs">
              <h3 className="text-base font-extrabold text-[#06265B]">Promotions & Discount Codes</h3>
              <form onSubmit={handleCreatePromo} className="grid grid-cols-2 gap-2.5">
                <input
                  required
                  value={promoForm.code}
                  onChange={(e) => setPromoForm({ ...promoForm, code: e.target.value.toUpperCase() })}
                  placeholder="Code (e.g. LAGOS10)"
                  className="px-3 py-2 border border-[#E2E8F0] rounded-lg uppercase font-mono"
                />
                <input
                  required
                  value={promoForm.title}
                  onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })}
                  placeholder="Campaign Title"
                  className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
                <select
                  value={promoForm.discountType}
                  onChange={(e) => setPromoForm({ ...promoForm, discountType: e.target.value })}
                  className="px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  <option value="FIXED">Fixed Amount (₦)</option>
                  <option value="PERCENT">Percentage (%)</option>
                </select>
                <input
                  type="number"
                  required
                  value={promoForm.discountValue}
                  onChange={(e) => setPromoForm({ ...promoForm, discountValue: e.target.value })}
                  placeholder="Value (₦ or %)"
                  className="px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
                <button
                  type="submit"
                  className="col-span-2 py-2 rounded-lg bg-[#073B8C] text-white font-bold hover:bg-[#06265B]"
                >
                  Create Promo Code
                </button>
              </form>
              <div className="divide-y divide-[#E2E8F0]">
                {promotions.map((p) => (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-[#073B8C]">{p.code}</span> —{' '}
                      <span className="font-semibold text-[#06265B]">{p.title}</span>
                      <div className="text-[11px] text-[#64748B]">
                        Used {p.used_count}/{p.usage_limit} · Valid until {p.valid_until}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/admin/promotions/${p.id}`, {
                          method: 'PATCH',
                          body: { isActive: p.is_active !== 1 },
                        });
                        void loadAll();
                      }}
                      className={`px-2.5 py-1 rounded font-bold ${
                        p.is_active === 1 ? 'bg-[#ECFDF3] text-[#16834A]' : 'bg-[#F1F5F9] text-[#64748B]'
                      }`}
                    >
                      {p.is_active === 1 ? 'Active' : 'Paused'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Reviews Moderation */}
            <div className="lg:col-span-6 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3 text-xs">
              <h3 className="text-base font-extrabold text-[#06265B]">Customer Ratings & Reviews ({reviews.length})</h3>
              <div className="divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
                {reviews.map((rv) => (
                  <div key={rv.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-[#06265B]">
                        {rv.customer_name} → {rv.retailer_name}
                      </div>
                      <div className="inline-flex items-center gap-1 text-[#E99A25] font-bold">
                        <Star className="w-3 h-3 fill-[#E99A25]" /> Retailer {rv.retailer_rating}/5 · Dispatcher{' '}
                        {rv.dispatcher_rating || '—'}/5
                      </div>
                      <p className="text-[#64748B] mt-0.5">{rv.comment}</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/admin/reviews/${rv.id}`, {
                          method: 'PATCH',
                          body: { isVisible: rv.is_visible !== 1 },
                        });
                        void loadAll();
                      }}
                      className="px-2 py-1 rounded border border-[#E2E8F0] font-bold shrink-0"
                    >
                      {rv.is_visible === 1 ? 'Hide' : 'Publish'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Commercial Settings & Homepage CMS */}
          <form onSubmit={handleSaveSettings} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4 text-xs">
            <h3 className="text-base font-extrabold text-[#06265B]">
              Platform Commercial Settings & Homepage CMS Content
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold mb-1">Homepage Announcement Banner</label>
                <input
                  value={String(settings.homepage_cms?.announcementBanner || '')}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      homepage_cms: { ...(settings.homepage_cms || {}), announcementBanner: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Platform Service Fee (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={Number(settings.commercial_fees?.serviceFeePercent ?? 2)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      commercial_fees: {
                        ...(settings.commercial_fees || {}),
                        serviceFeePercent: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold mb-1">Homepage Hero Headline</label>
                <input
                  value={String(settings.homepage_cms?.heroTitle || '')}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      homepage_cms: { ...(settings.homepage_cms || {}), heroTitle: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold mb-1">Cancellation & Refund Policy Summary</label>
                <textarea
                  rows={2}
                  value={String(settings.cancellation_policy?.policySummary || '')}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      cancellation_policy: {
                        ...(settings.cancellation_policy || {}),
                        policySummary: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white font-bold"
            >
              Save Platform Settings & CMS
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
