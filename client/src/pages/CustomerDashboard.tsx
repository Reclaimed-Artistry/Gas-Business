import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Wallet,
  MapPin,
  Heart,
  LifeBuoy,
  User as UserIcon,
  Plus,
  Receipt,
  Star,
  Truck,
  ShieldCheck,
  Trash2,
  CreditCard,
  CheckCircle2,
  XCircle,
  KeyRound,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest, subscribeToPlatformEvents } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLocationContext } from '../context/LocationContext';
import { formatDateTime, formatNaira, getOrderStepIndex, ORDER_PROGRESS_STEPS } from '../lib/format';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';
import { StatusBadge } from '../components/StatusBadge';
import { DeliveryTrackingMap } from '../components/DeliveryTrackingMap';
import { PaymentGatewayModal, type GatewaySession } from '../components/PaymentGatewayModal';
import { ReceiptModal, type ElectronicReceipt } from '../components/ReceiptModal';
import type { CustomerOrder } from '../types';

interface WalletTx {
  id: number;
  reference: string;
  type: string;
  direction: 'CREDIT' | 'DEBIT';
  amount_kobo: number;
  balance_before_kobo: number;
  balance_after_kobo: number;
  status: string;
  payment_method: string;
  gateway_provider?: string | null;
  description: string;
  created_at: string;
}

interface SavedAddress {
  id: number;
  label: string;
  address_line: string;
  neighbourhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  delivery_instructions: string;
  is_default: number;
}

interface FavRetailer {
  id: number;
  business_name: string;
  slug: string;
  address: string;
  neighbourhood: string;
  city: string;
  rating_avg: number;
  is_open_now: number;
}

interface ComplaintRow {
  id: number;
  ticket_number: string;
  order_reference?: string | null;
  category: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  admin_response: string;
  created_at: string;
}

type TabKey = 'overview' | 'orders' | 'wallet' | 'saved' | 'support' | 'profile';

export function CustomerDashboard() {
  const { user, walletBalanceKobo, setWalletBalanceKobo, refreshAuth } = useAuth();
  const { setLocation } = useLocationContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const activeTab = (searchParams.get('tab') as TabKey) || 'overview';
  const setTab = (tab: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(
    searchParams.get('highlight') ? Number(searchParams.get('highlight')) : null
  );
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [txStatusFilter, setTxStatusFilter] = useState<'ALL' | 'SUCCESS' | 'PENDING' | 'FAILED'>('ALL');
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [favourites, setFavourites] = useState<FavRetailer[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);

  // Wallet funding state
  const [fundAmount, setFundAmount] = useState('15000');
  const [fundProvider, setFundProvider] = useState<'PAYSTACK' | 'FLUTTERWAVE'>('PAYSTACK');
  const [fundChannel, setFundChannel] = useState<'CARD' | 'BANK_TRANSFER' | 'USSD'>('CARD');
  const [gatewaySession, setGatewaySession] = useState<GatewaySession | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<ElectronicReceipt | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Review modal state
  const [reviewOrderId, setReviewOrderId] = useState<number | null>(null);
  const [retailerRating, setRetailerRating] = useState(5);
  const [dispatcherRating, setDispatcherRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  // New Address form
  const [addrLabel, setAddrLabel] = useState('Home');
  const [addrPreset, setAddrPreset] = useState(NIGERIAN_PRESET_LOCATIONS[0].label);
  const [addrLine, setAddrLine] = useState('');
  const [addrNote, setAddrNote] = useState('');

  // New Complaint form
  const [compOrderId, setCompOrderId] = useState('');
  const [compCategory, setCompCategory] = useState('DELIVERY_ISSUE');
  const [compSubject, setCompSubject] = useState('');
  const [compDescription, setCompDescription] = useState('');

  // Profile form
  const [profileName, setProfileName] = useState(user?.full_name || '');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [ordRes, walRes, addrRes, favRes, compRes] = await Promise.all([
        apiRequest<{ orders: CustomerOrder[] }>('/api/customer/orders'),
        apiRequest<{ wallet: { balanceKobo: number }; transactions: WalletTx[] }>(
          `/api/customer/wallet?status=${txStatusFilter}`
        ),
        apiRequest<{ addresses: SavedAddress[] }>('/api/customer/addresses'),
        apiRequest<{ favourites: FavRetailer[] }>('/api/customer/favourites'),
        apiRequest<{ complaints: ComplaintRow[] }>('/api/customer/complaints'),
      ]);
      setOrders(ordRes.orders);
      if (!selectedOrderId && ordRes.orders.length > 0) {
        setSelectedOrderId(ordRes.orders[0].id);
      }
      setWalletBalanceKobo(walRes.wallet.balanceKobo);
      setWalletTxs(walRes.transactions);
      setAddresses(addrRes.addresses);
      setFavourites(favRes.favourites);
      setComplaints(compRes.complaints);
    } catch {
      // ignore if redirected
    }
  }, [txStatusFilter, selectedOrderId, setWalletBalanceKobo]);

  useEffect(() => {
    if (!user) return;
    setProfileName(user.full_name);
    setProfilePhone(user.phone);
    void loadData();
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;
    return subscribeToPlatformEvents({
      onOrderUpdate: () => void loadData(),
      onDispatcherLocation: (payload) => {
        const oid = Number(payload.orderId);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === oid
              ? {
                  ...o,
                  dispatcher_lat: payload.lat == null ? null : Number(payload.lat),
                  dispatcher_lng: payload.lng == null ? null : Number(payload.lng),
                  liveTrackingActive: Boolean(payload.trackingEnabled),
                  dispatcher_location_updated_at: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
                }
              : o
          )
        );
      },
    });
  }, [user, loadData]);

  // Serverless instances do not share in-memory events; poll persisted order data as well.
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void apiRequest<{ orders: CustomerOrder[] }>('/api/customer/orders')
        .then(result => setOrders(result.orders)).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [user]);

  const showNotice = (msg: string) => {
    setFeedbackMsg(msg);
    setErrorMsg('');
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  const handleInitWalletFunding = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await apiRequest<{ gateway: GatewaySession }>('/api/payments/wallet/fund/init', {
        method: 'POST',
        body: {
          amountNaira: Number(fundAmount),
          provider: fundProvider,
          channel: fundChannel,
        },
      });
      setGatewaySession({ ...res.gateway, purpose: 'WALLET_FUNDING' });
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRetryOnlineOrderPayment = async (orderId: number) => {
    setErrorMsg('');
    try {
      const res = await apiRequest<{ gateway: GatewaySession }>(`/api/payments/order/${orderId}/init`, {
        method: 'POST',
        body: { provider: 'PAYSTACK', channel: 'CARD' },
      });
      setGatewaySession({ ...res.gateway, purpose: 'ORDER_PAYMENT' });
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleOpenReceipt = async (orderId: number) => {
    try {
      const res = await apiRequest<{ receipt: ElectronicReceipt }>(`/api/customer/orders/${orderId}/receipt`);
      setActiveReceipt(res.receipt);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    const reason = window.prompt('Enter reason for cancelling this order:', 'Change of schedule');
    if (reason === null) return;
    try {
      const res = await apiRequest<{ message: string }>(`/api/customer/orders/${orderId}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      showNotice(res.message);
      void loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewOrderId) return;
    try {
      await apiRequest(`/api/customer/orders/${reviewOrderId}/review`, {
        method: 'POST',
        body: { retailerRating, dispatcherRating, comment: reviewComment },
      });
      setReviewOrderId(null);
      setReviewComment('');
      showNotice('Thank you! Your delivery rating and review have been published.');
      void loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const base = NIGERIAN_PRESET_LOCATIONS.find((p) => p.label === addrPreset) || NIGERIAN_PRESET_LOCATIONS[0];
    try {
      await apiRequest('/api/customer/addresses', {
        method: 'POST',
        body: {
          label: addrLabel,
          addressLine: addrLine.trim() || base.addressLine,
          neighbourhood: base.neighbourhood,
          city: base.city,
          state: base.state,
          lat: base.lat,
          lng: base.lng,
          deliveryInstructions: addrNote,
          isDefault: addresses.length === 0,
        },
      });
      setAddrLine('');
      setAddrNote('');
      showNotice('Delivery address saved.');
      void loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/customer/complaints', {
        method: 'POST',
        body: {
          orderId: compOrderId ? Number(compOrderId) : null,
          category: compCategory,
          subject: compSubject,
          description: compDescription,
        },
      });
      setCompSubject('');
      setCompDescription('');
      setCompOrderId('');
      showNotice('Support ticket submitted. Operations will respond shortly.');
      void loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: {
          fullName: profileName,
          phone: profilePhone,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        },
      });
      setCurrentPassword('');
      setNewPassword('');
      await refreshAuth();
      showNotice('Account profile updated.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const activeOrder = orders.find((o) =>
    [
      'AWAITING_DISPATCHER_ASSIGNMENT',
      'ASSIGNED_TO_DISPATCHER',
      'ACCEPTED_BY_DISPATCHER',
      'AWAITING_COLLECTION',
      'COLLECTED_FROM_RETAILER',
      'IN_TRANSIT',
    ].includes(o.status)
  );
  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || orders[0] || null;

  const navItems: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'orders', label: `Orders & Tracking (${orders.length})`, icon: Package },
    { key: 'wallet', label: 'Digital Wallet', icon: Wallet },
    { key: 'saved', label: 'Addresses & Favourites', icon: Heart },
    { key: 'support', label: 'Support & Complaints', icon: LifeBuoy },
    { key: 'profile', label: 'Account Settings', icon: UserIcon },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#E2E8F0] rounded-xl p-5">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#1769C2]">Customer Dashboard</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#06265B]">
            Welcome back, {user?.full_name}
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">{user?.email} · {user?.phone}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-[#EAF3FF] border border-[#BFDBFE] rounded-xl px-4 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#1769C2]">Wallet Balance</div>
            <div className="text-lg font-extrabold text-[#073B8C] tabular-nums">{formatNaira(walletBalanceKobo)}</div>
          </div>
          <button
            type="button"
            onClick={() => setTab('wallet')}
            className="px-4 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Fund Wallet
          </button>
          <Link
            to="/explore"
            className="px-4 py-2.5 rounded-lg border border-[#073B8C] text-[#073B8C] hover:bg-[#EAF3FF] text-xs font-bold"
          >
            Order Gas
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1.5 pb-1">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
              activeTab === item.key
                ? 'bg-[#073B8C] text-white border-[#073B8C]'
                : 'bg-white text-[#172B4D] border-[#E2E8F0] hover:border-[#1769C2]'
            }`}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {feedbackMsg && (
        <div className="p-3 rounded-lg bg-[#ECFDF3] border border-[#BBF7D0] text-xs font-semibold text-[#16834A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#D64545] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* TAB: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-5">
            {activeOrder ? (
              <div className="bg-white border border-[#BFDBFE] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1769C2]">
                      Active Delivery in Progress
                    </span>
                    <h2 className="text-base font-extrabold text-[#06265B] mt-0.5">
                      {activeOrder.order_reference} · {activeOrder.retailer_name}
                    </h2>
                  </div>
                  <StatusBadge status={activeOrder.status} />
                </div>

                {/* Delivery Confirmation PIN */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#EAF3FF] border border-[#BFDBFE] rounded-lg px-4 py-3 text-xs">
                  <div className="inline-flex items-center gap-2 text-[#073B8C] font-semibold">
                    <KeyRound className="w-4 h-4" />
                    <span>Share this 4-digit PIN with your dispatcher upon gas handover:</span>
                  </div>
                  <span className="font-mono text-base font-extrabold tracking-widest bg-white px-3 py-1 rounded border border-[#BFDBFE] text-[#06265B]">
                    {activeOrder.delivery_confirmation_code}
                  </span>
                </div>

                <DeliveryTrackingMap
                  retailer={{
                    name: activeOrder.retailer_name,
                    address: activeOrder.retailer_address,
                    lat: activeOrder.retailer_lat,
                    lng: activeOrder.retailer_lng,
                  }}
                  customer={{
                    address: activeOrder.delivery_address,
                    lat: activeOrder.delivery_lat,
                    lng: activeOrder.delivery_lng,
                  }}
                  dispatcher={
                    activeOrder.dispatcher_name
                      ? {
                          name: activeOrder.dispatcher_name,
                          lat: activeOrder.dispatcher_lat,
                          lng: activeOrder.dispatcher_lng,
                          active: activeOrder.liveTrackingActive,
                          updatedAt: activeOrder.dispatcher_location_updated_at,
                        }
                      : null
                  }
                  status={activeOrder.status}
                  heightClass="h-[260px]"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-[#64748B]">
                    {activeOrder.dispatcher_name ? (
                      <span>
                        Dispatcher: <strong className="text-[#06265B]">{activeOrder.dispatcher_name}</strong> (
                        {activeOrder.dispatcher_vehicle} · {activeOrder.dispatcher_plate}) ·{' '}
                        {activeOrder.dispatcher_phone}
                      </span>
                    ) : (
                      <span>Operations Admin is assigning the nearest dispatcher.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(activeOrder.id);
                      setTab('orders');
                    }}
                    className="font-bold text-[#073B8C] hover:underline"
                  >
                    Full Tracking Details →
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 text-center space-y-3">
                <Truck className="w-8 h-8 text-[#073B8C] mx-auto" />
                <h2 className="text-base font-bold text-[#06265B]">No Active Deliveries Right Now</h2>
                <p className="text-xs text-[#64748B]">
                  Compare verified gas prices across nearby stations and get cooking gas delivered to your doorstep.
                </p>
                <Link
                  to="/explore"
                  className="inline-block px-4 py-2 rounded-lg bg-[#073B8C] text-white text-xs font-bold"
                >
                  Explore Nearby Gas Retailers
                </Link>
              </div>
            )}

            {/* Recent Wallet Transactions */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#06265B]">Recent Wallet Activity</h3>
                <button type="button" onClick={() => setTab('wallet')} className="text-xs font-bold text-[#1769C2]">
                  View All
                </button>
              </div>
              <div className="divide-y divide-[#E2E8F0] text-xs">
                {walletTxs.slice(0, 5).map((tx) => (
                  <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-[#06265B]">{tx.description}</div>
                      <div className="text-[11px] text-[#64748B] font-mono">
                        {tx.reference} · {formatDateTime(tx.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-extrabold tabular-nums ${
                          tx.direction === 'CREDIT' ? 'text-[#16834A]' : 'text-[#06265B]'
                        }`}
                      >
                        {tx.direction === 'CREDIT' ? '+' : '-'}
                        {formatNaira(tx.amount_kobo)}
                      </div>
                      <StatusBadge status={tx.status} className="mt-0.5 text-[10px]" />
                    </div>
                  </div>
                ))}
                {walletTxs.length === 0 && (
                  <div className="p-6 text-center text-[#64748B]">No wallet transactions yet.</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Overview Sidebar */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#06265B]">Saved Retailers ({favourites.length})</h3>
                <button type="button" onClick={() => setTab('saved')} className="text-xs font-bold text-[#1769C2]">
                  Manage
                </button>
              </div>
              {favourites.length === 0 ? (
                <p className="text-xs text-[#64748B]">Save your preferred gas depots for 1-click reordering.</p>
              ) : (
                <div className="space-y-2.5">
                  {favourites.map((f) => (
                    <Link
                      key={f.id}
                      to={`/retailers/${f.slug}`}
                      className="block p-3 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] hover:border-[#1769C2]"
                    >
                      <div className="text-xs font-bold text-[#06265B]">{f.business_name}</div>
                      <div className="text-[11px] text-[#64748B]">{f.neighbourhood}, {f.city}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#06265B]">Saved Delivery Addresses</h3>
                <button type="button" onClick={() => setTab('saved')} className="text-xs font-bold text-[#1769C2]">
                  Add New
                </button>
              </div>
              {addresses.map((a) => (
                <div key={a.id} className="p-3 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#06265B]">{a.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setLocation({
                          label: `${a.neighbourhood}, ${a.city}`,
                          addressLine: a.address_line,
                          neighbourhood: a.neighbourhood,
                          city: a.city,
                          state: a.state,
                          lat: a.lat,
                          lng: a.lng,
                          deliveryInstructions: a.delivery_instructions,
                        });
                        navigate('/explore');
                      }}
                      className="text-[11px] font-bold text-[#073B8C] hover:underline"
                    >
                      Shop Here
                    </button>
                  </div>
                  <div className="text-[#64748B]">{a.address_line}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: ORDERS & LIVE TRACKING */}
      {activeTab === 'orders' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Order List */}
          <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] text-xs font-bold text-[#06265B]">
              Order History ({orders.length})
            </div>
            <div className="divide-y divide-[#E2E8F0] max-h-[680px] overflow-y-auto">
              {orders.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#64748B]">You have not placed any orders yet.</div>
              ) : (
                orders.map((ord) => (
                  <button
                    key={ord.id}
                    type="button"
                    onClick={() => setSelectedOrderId(ord.id)}
                    className={`w-full text-left p-4 transition-colors ${
                      selectedOrder?.id === ord.id ? 'bg-[#EAF3FF]/60' : 'hover:bg-[#F7F9FC]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono font-bold text-[#073B8C]">{ord.order_reference}</div>
                        <div className="text-sm font-bold text-[#06265B] mt-0.5">{ord.retailer_name}</div>
                      </div>
                      <StatusBadge status={ord.status} />
                    </div>
                    <div className="text-xs text-[#64748B] mt-1.5">
                      {ord.items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ')}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="font-extrabold text-[#06265B] tabular-nums">
                        {formatNaira(ord.total_amount_kobo)}
                      </span>
                      <span className="text-[11px] text-[#64748B]">{formatDateTime(ord.created_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Selected Order Detail & Live Tracking */}
          <div className="lg:col-span-7 space-y-4">
            {selectedOrder ? (
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                  <div>
                    <div className="text-xs font-mono font-bold text-[#1769C2]">{selectedOrder.order_reference}</div>
                    <h2 className="text-lg font-extrabold text-[#06265B]">{selectedOrder.retailer_name}</h2>
                    <div className="text-xs text-[#64748B] mt-0.5">
                      Delivered to: {selectedOrder.delivery_address}, {selectedOrder.delivery_neighbourhood}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedOrder.status} />
                    {selectedOrder.payment_status === 'PAID' && (
                      <button
                        type="button"
                        onClick={() => void handleOpenReceipt(selectedOrder.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E2E8F0] text-xs font-bold text-[#073B8C] hover:bg-[#EAF3FF]"
                      >
                        <Receipt className="w-3.5 h-3.5" /> Receipt
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Stepper */}
                {!['CANCELLED', 'DELIVERY_FAILED', 'REFUND_PROCESSING', 'REFUNDED', 'AWAITING_PAYMENT'].includes(
                  selectedOrder.status
                ) && (
                  <div className="grid grid-cols-6 gap-1">
                    {ORDER_PROGRESS_STEPS.map((st, idx) => {
                      const currentIdx = getOrderStepIndex(selectedOrder.status);
                      const done = idx <= currentIdx;
                      return (
                        <div key={st.key} className="text-center">
                          <div
                            className={`h-2 rounded-full mb-1.5 ${
                              done ? 'bg-[#073B8C]' : 'bg-[#E2E8F0]'
                            }`}
                          />
                          <div className={`text-[10px] font-bold ${done ? 'text-[#06265B]' : 'text-[#94A3B8]'}`}>
                            {st.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedOrder.status === 'AWAITING_PAYMENT' && (
                  <div className="p-4 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-[#B45309]">Awaiting Electronic Payment Verification</div>
                      <p className="text-[#92400E] mt-0.5">
                        Orders are not dispatched until electronic payment is confirmed by the server.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRetryOnlineOrderPayment(selectedOrder.id)}
                      className="px-3.5 py-2 rounded-lg bg-[#073B8C] text-white font-bold"
                    >
                      Complete Payment ({formatNaira(selectedOrder.total_amount_kobo)})
                    </button>
                  </div>
                )}

                {selectedOrder.status === 'DELIVERY_FAILED' && (
                  <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#D64545]">
                    <div className="font-bold">Delivery Issue: {selectedOrder.failure_reason.replace(/_/g, ' ')}</div>
                    <p className="mt-0.5">{selectedOrder.failure_notes}</p>
                  </div>
                )}

                {/* Live Tracking Map */}
                <DeliveryTrackingMap
                  retailer={{
                    name: selectedOrder.retailer_name,
                    address: selectedOrder.retailer_address,
                    lat: selectedOrder.retailer_lat,
                    lng: selectedOrder.retailer_lng,
                  }}
                  customer={{
                    address: selectedOrder.delivery_address,
                    lat: selectedOrder.delivery_lat,
                    lng: selectedOrder.delivery_lng,
                  }}
                  dispatcher={
                    selectedOrder.dispatcher_name
                      ? {
                          name: selectedOrder.dispatcher_name,
                          lat: selectedOrder.dispatcher_lat,
                          lng: selectedOrder.dispatcher_lng,
                          active: selectedOrder.liveTrackingActive,
                          updatedAt: selectedOrder.dispatcher_location_updated_at,
                        }
                      : null
                  }
                  status={selectedOrder.status}
                  heightClass="h-[270px]"
                />

                {/* Assigned Dispatcher & PIN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                      Assigned Dispatcher
                    </div>
                    {selectedOrder.dispatcher_name ? (
                      <>
                        <div className="font-bold text-[#06265B]">{selectedOrder.dispatcher_name}</div>
                        <div className="text-[#64748B]">
                          {selectedOrder.dispatcher_vehicle} ({selectedOrder.dispatcher_plate})
                        </div>
                        <div className="text-[#073B8C] font-semibold">{selectedOrder.dispatcher_phone}</div>
                        <div className="text-[11px] font-semibold text-[#16834A]">
                          {selectedOrder.liveTrackingActive
                            ? '● Live GPS Tracking Active'
                            : 'Live GPS shares only during active transit'}
                        </div>
                      </>
                    ) : (
                      <div className="text-[#64748B]">Awaiting assignment by Operations Admin</div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#1769C2]">
                      Handover Confirmation PIN & Cashless Notice
                    </div>
                    <div className="font-mono text-xl font-extrabold text-[#06265B] tracking-widest">
                      {selectedOrder.delivery_confirmation_code}
                    </div>
                    <div className="text-[11px] text-[#073B8C] font-medium">
                      Order is prepaid electronically ({selectedOrder.payment_method}). Never hand cash to dispatcher.
                    </div>
                  </div>
                </div>

                {/* Items & Totals */}
                <div className="border-t border-[#E2E8F0] pt-4 text-xs space-y-2">
                  {selectedOrder.items.map((it) => (
                    <div key={it.id} className="flex justify-between">
                      <span className="font-semibold text-[#172B4D]">
                        {it.quantity} × {it.product_name}
                      </span>
                      <span className="font-bold tabular-nums">{formatNaira(it.line_total_kobo)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-[#64748B] pt-1 border-t border-[#F1F5F9]">
                    <span>Delivery Fee + Service Fee</span>
                    <span className="tabular-nums">
                      {formatNaira(selectedOrder.delivery_fee_kobo + selectedOrder.service_fee_kobo)}
                    </span>
                  </div>
                  <div className="flex justify-between font-extrabold text-sm text-[#06265B]">
                    <span>Total Paid</span>
                    <span className="tabular-nums">{formatNaira(selectedOrder.total_amount_kobo)}</span>
                  </div>
                </div>

                {/* Order Actions */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {['AWAITING_PAYMENT', 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER'].includes(
                    selectedOrder.status
                  ) && (
                    <button
                      type="button"
                      onClick={() => void handleCancelOrder(selectedOrder.id)}
                      className="px-3.5 py-2 rounded-lg border border-[#FECACA] text-[#D64545] hover:bg-[#FEF2F2] text-xs font-bold"
                    >
                      Cancel Order
                    </button>
                  )}
                  {selectedOrder.status === 'DELIVERED' && !selectedOrder.has_review && (
                    <button
                      type="button"
                      onClick={() => setReviewOrderId(selectedOrder.id)}
                      className="px-3.5 py-2 rounded-lg bg-[#073B8C] text-white hover:bg-[#06265B] text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Star className="w-3.5 h-3.5" /> Rate & Review Delivery
                    </button>
                  )}
                </div>

                {/* Status Audit Timeline */}
                <div className="border-t border-[#E2E8F0] pt-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64748B] mb-2.5">
                    Delivery Timeline
                  </h4>
                  <div className="space-y-2 text-xs">
                    {selectedOrder.timeline.map((ev) => (
                      <div key={ev.id} className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-bold text-[#06265B]">{ev.to_status.replace(/_/g, ' ')}</span>
                          <span className="text-[#64748B]"> — {ev.note}</span>
                        </div>
                        <span className="text-[11px] text-[#94A3B8] shrink-0">{formatDateTime(ev.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 text-center text-xs text-[#64748B]">
                Select an order to view live tracking and receipt details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: DIGITAL WALLET */}
      {activeTab === 'wallet' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Fund Wallet Form */}
          <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <div className="bg-[#06265B] text-white rounded-xl p-5 space-y-1">
              <div className="text-xs text-[#EAF3FF]/80 font-semibold">Available Wallet Balance</div>
              <div className="text-3xl font-extrabold tabular-nums">{formatNaira(walletBalanceKobo)}</div>
              <div className="text-[11px] text-[#EAF3FF]/75 pt-1 inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Server-Verified Ledger · Duplicate Prevention Enabled
              </div>
            </div>

            <form onSubmit={handleInitWalletFunding} className="space-y-3.5">
              <h3 className="text-sm font-bold text-[#06265B]">Wallet funding temporarily unavailable</h3>
              <p className="text-xs text-red-700">Online payments are not yet set up. Please do not send money or enter card details.</p>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Amount (₦ NGN)</label>
                <input
                  type="number"
                  min={500}
                  max={2000000}
                  step={500}
                  required
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold tabular-nums border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[5000, 10000, 15000, 25000, 50000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setFundAmount(String(amt))}
                      className="px-2.5 py-1 rounded-md border border-[#E2E8F0] bg-[#F7F9FC] hover:border-[#073B8C] text-[11px] font-bold text-[#06265B] tabular-nums"
                    >
                      ₦{amt.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Gateway</label>
                  <select
                    value={fundProvider}
                    onChange={(e) => setFundProvider(e.target.value as 'PAYSTACK' | 'FLUTTERWAVE')}
                    className="w-full px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                  >
                    <option value="PAYSTACK">Paystack</option>
                    <option value="FLUTTERWAVE">Flutterwave</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Method</label>
                  <select
                    value={fundChannel}
                    onChange={(e) => setFundChannel(e.target.value as 'CARD' | 'BANK_TRANSFER' | 'USSD')}
                    className="w-full px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                  >
                    <option value="CARD">Debit / Credit Card</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="USSD">USSD</option>
                  </select>
                </div>
              </div>

              <button
                type="submit" disabled
                className="w-full py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold inline-flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                Fund Wallet via {fundProvider}
              </button>
            </form>
          </div>

          {/* Wallet Ledger Table */}
          <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F7F9FC] flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#06265B]">Wallet Transaction Ledger</h3>
              <div className="flex gap-1">
                {(['ALL', 'SUCCESS', 'PENDING', 'FAILED'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setTxStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                      txStatusFilter === st
                        ? 'bg-[#073B8C] text-white'
                        : 'bg-white border border-[#E2E8F0] text-[#64748B]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B] bg-[#F7F9FC]">
                    <th className="py-2.5 px-4 font-bold">Reference & Details</th>
                    <th className="py-2.5 px-4 font-bold">Status</th>
                    <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                    <th className="py-2.5 px-4 font-bold text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {walletTxs.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#06265B]">{tx.description}</div>
                        <div className="text-[11px] font-mono text-[#64748B]">
                          {tx.reference} · {formatDateTime(tx.created_at)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-extrabold tabular-nums ${
                          tx.status === 'FAILED'
                            ? 'text-[#D64545] line-through'
                            : tx.direction === 'CREDIT'
                              ? 'text-[#16834A]'
                              : 'text-[#06265B]'
                        }`}
                      >
                        {tx.direction === 'CREDIT' ? '+' : '-'}
                        {formatNaira(tx.amount_kobo)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#172B4D] tabular-nums">
                        {formatNaira(tx.balance_after_kobo)}
                      </td>
                    </tr>
                  ))}
                  {walletTxs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-[#64748B]">
                        No wallet transactions found for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: SAVED ADDRESSES & FAVOURITES */}
      {activeTab === 'saved' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-5">
            <h3 className="text-base font-bold text-[#06265B] inline-flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#073B8C]" /> Saved Delivery Addresses
            </h3>

            <div className="space-y-2.5">
              {addresses.map((a) => (
                <div
                  key={a.id}
                  className="p-3.5 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-[#06265B]">{a.label}</div>
                    <div className="text-[#172B4D] mt-0.5">
                      {a.address_line}, {a.neighbourhood}, {a.city}, {a.state}
                    </div>
                    {a.delivery_instructions && (
                      <div className="text-[#64748B] mt-0.5">Note: {a.delivery_instructions}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/api/customer/addresses/${a.id}`, { method: 'DELETE' });
                      void loadData();
                    }}
                    className="p-1.5 text-[#64748B] hover:text-[#D64545]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddAddress} className="border-t border-[#E2E8F0] pt-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">Add New Delivery Address</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  value={addrLabel}
                  onChange={(e) => setAddrLabel(e.target.value)}
                  placeholder="Label (e.g. Home, Office)"
                  className="px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg"
                />
                <select
                  value={addrPreset}
                  onChange={(e) => setAddrPreset(e.target.value)}
                  className="px-3 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  {NIGERIAN_PRESET_LOCATIONS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                required
                value={addrLine}
                onChange={(e) => setAddrLine(e.target.value)}
                placeholder="House number & street address"
                className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg"
              />
              <input
                value={addrNote}
                onChange={(e) => setAddrNote(e.target.value)}
                placeholder="Estate gate code or landmark instructions (optional)"
                className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold"
              >
                Save Delivery Address
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <h3 className="text-base font-bold text-[#06265B] inline-flex items-center gap-2">
              <Heart className="w-4 h-4 text-[#D64545]" /> Favourite Gas Retailers
            </h3>
            {favourites.length === 0 ? (
              <p className="text-xs text-[#64748B]">No favourite retailers saved yet.</p>
            ) : (
              <div className="space-y-3">
                {favourites.map((f) => (
                  <div
                    key={f.id}
                    className="p-3.5 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <Link to={`/retailers/${f.slug}`} className="font-bold text-[#06265B] hover:text-[#073B8C]">
                        {f.business_name}
                      </Link>
                      <div className="text-[#64748B]">{f.address}, {f.neighbourhood}</div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/customer/favourites/${f.id}`, { method: 'DELETE' });
                        void loadData();
                      }}
                      className="text-[#D64545] font-bold hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: SUPPORT & COMPLAINTS */}
      {activeTab === 'support' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-5">
            <form onSubmit={handleSubmitComplaint} className="space-y-3.5">
              <h3 className="text-base font-bold text-[#06265B]">Submit a Support Ticket or Complaint</h3>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Related Order (Optional)</label>
                <select
                  value={compOrderId}
                  onChange={(e) => setCompOrderId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  <option value="">General Inquiry / Wallet</option>
                  {orders.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.order_reference} ({o.retailer_name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Category</label>
                <select
                  value={compCategory}
                  onChange={(e) => setCompCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  <option value="DELIVERY_ISSUE">Delivery Issue</option>
                  <option value="WEIGHT_OR_QUALITY">Gas Weight or Seal Quality</option>
                  <option value="PAYMENT_OR_REFUND">Payment or Refund Inquiry</option>
                  <option value="DISPATCHER_CONDUCT">Dispatcher Conduct</option>
                  <option value="OTHER">Other Support</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Subject</label>
                <input
                  required
                  value={compSubject}
                  onChange={(e) => setCompSubject(e.target.value)}
                  placeholder="Brief summary of the issue"
                  className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Detailed Description</label>
                <textarea
                  required
                  rows={4}
                  value={compDescription}
                  onChange={(e) => setCompDescription(e.target.value)}
                  placeholder="Explain what happened so Operations can resolve or issue an audited refund..."
                  className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <button
                type="submit" disabled
                className="w-full py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold"
              >
                Submit Support Ticket
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
            <h3 className="text-base font-bold text-[#06265B]">Your Support Tickets ({complaints.length})</h3>
            {complaints.length === 0 ? (
              <p className="text-xs text-[#64748B]">No complaints or support tickets submitted.</p>
            ) : (
              complaints.map((c) => (
                <div key={c.id} className="p-4 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-[#1769C2]">{c.ticket_number}</span>
                      {c.order_reference && <span className="text-[#64748B]"> · {c.order_reference}</span>}
                      <div className="font-bold text-[#06265B] text-sm mt-0.5">{c.subject}</div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-[#172B4D]">{c.description}</p>
                  {c.admin_response && (
                    <div className="p-2.5 rounded bg-[#EAF3FF] border border-[#BFDBFE] text-[#073B8C]">
                      <strong>Operations Response:</strong> {c.admin_response}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: PROFILE SETTINGS */}
      {activeTab === 'profile' && (
        <div className="max-w-xl bg-white border border-[#E2E8F0] rounded-xl p-6">
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <h3 className="text-base font-bold text-[#06265B]">Personal Information & Security</h3>
            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">Full Name</label>
              <input
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">Phone Number</label>
              <input
                required
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div className="border-t border-[#E2E8F0] pt-4 space-y-3">
              <div className="text-xs font-bold text-[#64748B]">Change Password (Optional)</div>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 chars)"
                className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold"
            >
              Save Account Changes
            </button>
          </form>
        </div>
      )}

      {/* Review Modal */}
      {reviewOrderId && (
        <div className="fixed inset-0 z-50 bg-[#06265B]/60 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#06265B]">Rate & Review Completed Delivery</h3>
              <button type="button" onClick={() => setReviewOrderId(null)} className="text-[#64748B]">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitReview} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Retailer Gas Weight & Quality (1–5)</label>
                <select
                  value={retailerRating}
                  onChange={(e) => setRetailerRating(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} Star{n === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Dispatcher Service & Speed (1–5)</label>
                <select
                  value={dispatcherRating}
                  onChange={(e) => setDispatcherRating(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} Star{n === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Comment</label>
                <textarea
                  rows={3}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Share how your delivery went..."
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <button
                type="submit" disabled
                className="w-full py-2.5 rounded-lg bg-[#073B8C] text-white font-bold hover:bg-[#06265B]"
              >
                Submit Verified Review
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Payment Gateway Modal */}
      {gatewaySession && user && (
        <PaymentGatewayModal
          session={gatewaySession}
          customerEmail={user.email}
          onClose={() => setGatewaySession(null)}
          onSuccess={(result) => {
            setGatewaySession(null);
            if (result.walletBalanceKobo !== undefined) setWalletBalanceKobo(result.walletBalanceKobo);
            showNotice(
              gatewaySession.purpose === 'WALLET_FUNDING'
                ? `Wallet credited successfully (Ref: ${result.reference})`
                : `Order payment verified and confirmed (Ref: ${result.reference})`
            );
            void loadData();
          }}
          onFailure={(msg) => setErrorMsg(msg)}
        />
      )}

      {/* Electronic Receipt Modal */}
      {activeReceipt && <ReceiptModal receipt={activeReceipt} onClose={() => setActiveReceipt(null)} />}
    </div>
  );
}
