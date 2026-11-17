import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Wallet,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Plus,
  Minus,
  Tag,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useLocationContext } from '../context/LocationContext';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';
import { formatNaira } from '../lib/format';
import { PaymentGatewayModal, type GatewaySession } from '../components/PaymentGatewayModal';
import type { RetailerCoverage } from '../types';

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
}

export function CheckoutPage() {
  const { items, retailerId, retailerName, subtotalKobo, updateQuantity, removeItem, clearCart } = useCart();
  const { user, walletBalanceKobo, setWalletBalanceKobo, refreshAuth } = useAuth();
  const { location, setLocation } = useLocationContext();
  const navigate = useNavigate();

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressLine, setAddressLine] = useState(location.addressLine);
  const [deliveryInstructions, setDeliveryInstructions] = useState(location.deliveryInstructions || '');
  const [coverage, setCoverage] = useState<RetailerCoverage | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);

  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; title: string; discountKobo: number } | null>(null);
  const [promoMsg, setPromoMsg] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<'WALLET' | 'DIRECT_ONLINE'>('WALLET');
  const [gatewayProvider, setGatewayProvider] = useState<'PAYSTACK' | 'FLUTTERWAVE'>('PAYSTACK');
  const [gatewayChannel, setGatewayChannel] = useState<'CARD' | 'BANK_TRANSFER' | 'USSD'>('CARD');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [shortfallKobo, setShortfallKobo] = useState<number | null>(null);
  const [gatewaySession, setGatewaySession] = useState<GatewaySession | null>(null);

  useEffect(() => {
    setAddressLine(location.addressLine);
  }, [location.addressLine]);

  useEffect(() => {
    if (user?.role === 'CUSTOMER') {
      apiRequest<{ addresses: SavedAddress[] }>('/api/customer/addresses')
        .then((res) => setSavedAddresses(res.addresses))
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!retailerId) {
      setCoverage(null);
      return;
    }
    setCheckingCoverage(true);
    apiRequest<{ coverage: RetailerCoverage }>('/api/public/coverage-check', {
      method: 'POST',
      body: {
        retailerId,
        lat: location.lat,
        lng: location.lng,
        neighbourhood: location.neighbourhood,
        city: location.city,
        state: location.state,
      },
    })
      .then((res) => setCoverage(res.coverage))
      .catch(() => setCoverage(null))
      .finally(() => setCheckingCoverage(false));
  }, [retailerId, location.lat, location.lng, location.neighbourhood, location.city, location.state]);

  const deliveryFeeKobo = coverage?.deliveryFeeKobo ?? 100000;
  const rawSvc = Math.round(subtotalKobo * 0.02);
  const serviceFeeKobo = Math.round(Math.max(20000, Math.min(150000, rawSvc)) / 500) * 500;
  const discountKobo = appliedPromo?.discountKobo ?? 0;
  const totalAmountKobo = Math.max(0, subtotalKobo + deliveryFeeKobo + serviceFeeKobo - discountKobo);
  const walletSufficient = walletBalanceKobo >= totalAmountKobo;

  const handleApplyPromo = async () => {
    setPromoMsg('');
    if (!promoInput.trim()) return;
    try {
      const res = await apiRequest<{ valid: boolean; code: string; title: string; discountKobo: number }>(
        '/api/public/promo/validate',
        {
          method: 'POST',
          body: { code: promoInput.trim(), subtotalKobo },
        }
      );
      setAppliedPromo({ code: res.code, title: res.title, discountKobo: res.discountKobo });
      setPromoMsg(`Applied ${res.code} (-${formatNaira(res.discountKobo)})`);
    } catch (err) {
      setAppliedPromo(null);
      setPromoMsg((err as Error).message);
    }
  };

  const handleInlineFundWallet = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const neededNaira = Math.max(1000, Math.ceil(((shortfallKobo || totalAmountKobo - walletBalanceKobo) + 50000) / 10000) * 100);
    setErrorMsg('');
    try {
      const res = await apiRequest<{ gateway: GatewaySession }>('/api/payments/wallet/fund/init', {
        method: 'POST',
        body: {
          amountNaira: neededNaira,
          provider: gatewayProvider,
          channel: gatewayChannel,
        },
      });
      setGatewaySession({
        ...res.gateway,
        purpose: 'WALLET_FUNDING',
      });
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handlePlaceOrder = async () => {
    setErrorMsg('');
    setShortfallKobo(null);

    if (!user) {
      navigate('/login?redirect=/checkout');
      return;
    }
    if (user.role !== 'CUSTOMER') {
      setErrorMsg('Please sign in with a Customer account to place cooking gas orders.');
      return;
    }
    if (!retailerId || items.length === 0) return;
    if (!coverage?.canDeliver) {
      setErrorMsg('Selected retailer cannot deliver to this address. Choose a covered delivery area or another retailer.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{
        orderId: number;
        orderReference: string;
        requiresGatewayVerification: boolean;
        newWalletBalanceKobo?: number;
        gateway?: GatewaySession;
      }>('/api/customer/orders', {
        method: 'POST',
        body: {
          retailerId,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          deliveryAddress: addressLine.trim() || location.addressLine,
          deliveryNeighbourhood: location.neighbourhood,
          deliveryCity: location.city,
          deliveryState: location.state,
          deliveryLat: location.lat,
          deliveryLng: location.lng,
          deliveryInstructions: deliveryInstructions.trim(),
          paymentMethod,
          gatewayProvider: paymentMethod === 'DIRECT_ONLINE' ? gatewayProvider : undefined,
          gatewayChannel: paymentMethod === 'DIRECT_ONLINE' ? gatewayChannel : undefined,
          promoCode: appliedPromo?.code,
        },
      });

      if (!res.requiresGatewayVerification) {
        if (res.newWalletBalanceKobo !== undefined) {
          setWalletBalanceKobo(res.newWalletBalanceKobo);
        }
        clearCart();
        void refreshAuth();
        navigate(`/dashboard?tab=orders&highlight=${res.orderId}`);
      } else if (res.gateway) {
        setGatewaySession({
          ...res.gateway,
          purpose: 'ORDER_PAYMENT',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.data?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        setShortfallKobo(Number(err.data.shortfallKobo || 0));
      }
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-14 h-14 rounded-xl bg-[#EAF3FF] text-[#073B8C] mx-auto flex items-center justify-center">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#06265B]">Your Cart is Empty</h1>
        <p className="text-sm text-[#64748B]">
          Discover verified cooking gas retailers around your address, compare prices, and add gas refills or
          accessories to checkout securely.
        </p>
        <Link
          to="/explore"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold"
        >
          Explore Nearby Retailers <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">Cashless Verified Checkout</span>
        <h1 className="text-2xl font-extrabold text-[#06265B] mt-0.5">Complete Your Cooking Gas Order</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Fulfilling retailer: <strong className="text-[#073B8C]">{retailerName}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Items, Delivery Address & Payment Method */}
        <div className="lg:col-span-7 space-y-5">
          {/* Cart Items */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#06265B]">Selected Products ({items.length})</h2>
              <button
                type="button"
                onClick={clearCart}
                className="text-xs font-semibold text-[#64748B] hover:text-[#D64545]"
              >
                Clear Cart
              </button>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {items.map((item) => (
                <div key={item.productId} className="p-4 flex items-center gap-3.5">
                  <img
                    src={item.imageUrl}
                    alt={item.productName}
                    className="w-16 h-16 rounded-lg object-contain bg-[#F7F9FC] border border-[#E2E8F0] p-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#06265B]">{item.productName}</div>
                    <div className="text-xs text-[#64748B] tabular-nums">
                      {formatNaira(item.sellingPriceKobo)} each
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 border border-[#E2E8F0] rounded-lg p-1">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      className="p-1 text-[#073B8C] hover:bg-[#EAF3FF] rounded"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2 text-xs font-bold tabular-nums">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      className="p-1 text-[#073B8C] hover:bg-[#EAF3FF] rounded"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-sm font-extrabold text-[#06265B] tabular-nums min-w-[78px] text-right">
                    {formatNaira(item.sellingPriceKobo * item.quantity)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="p-1.5 text-[#64748B] hover:text-[#D64545]"
                    aria-label="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery Location & Live Coverage Verification */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#06265B] inline-flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#073B8C]" />
              Delivery Location & Coverage Verification
            </h2>

            {savedAddresses.length > 0 && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Saved Customer Addresses
                </label>
                <div className="flex flex-wrap gap-2">
                  {savedAddresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => {
                        setLocation({
                          label: `${addr.neighbourhood}, ${addr.city}`,
                          addressLine: addr.address_line,
                          neighbourhood: addr.neighbourhood,
                          city: addr.city,
                          state: addr.state,
                          lat: addr.lat,
                          lng: addr.lng,
                          deliveryInstructions: addr.delivery_instructions,
                        });
                        setAddressLine(addr.address_line);
                        setDeliveryInstructions(addr.delivery_instructions || '');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F7F9FC] hover:border-[#073B8C] text-xs font-semibold text-[#06265B]"
                    >
                      {addr.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Neighbourhood / Area</label>
                <select
                  value={
                    NIGERIAN_PRESET_LOCATIONS.some((p) => p.label === location.label) ? location.label : '__custom__'
                  }
                  onChange={(e) => {
                    const f = NIGERIAN_PRESET_LOCATIONS.find((p) => p.label === e.target.value);
                    if (f) {
                      setLocation(f);
                      setAddressLine(f.addressLine);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  {!NIGERIAN_PRESET_LOCATIONS.some((p) => p.label === location.label) && (
                    <option value="__custom__">{location.label}</option>
                  )}
                  {NIGERIAN_PRESET_LOCATIONS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Street Address / House Number</label>
                <input
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                Estate Gate / Delivery Instructions (for Dispatcher)
              </label>
              <input
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                placeholder="e.g. Call at estate gate 2, flat 4B on first floor..."
                className="w-full px-3 py-2 text-xs border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
              />
            </div>

            {checkingCoverage ? (
              <div className="text-xs text-[#64748B]">Verifying retailer delivery coverage...</div>
            ) : coverage ? (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                  coverage.canDeliver
                    ? 'bg-[#ECFDF3] border-[#BBF7D0] text-[#16834A]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#D64545]'
                }`}
              >
                {coverage.canDeliver ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {coverage.canDeliver
                      ? `Delivery Coverage Confirmed (~${coverage.estimatedDeliveryMins} mins)`
                      : 'Delivery Coverage Not Supported for This Area'}
                  </div>
                  <div className="text-[11px] mt-0.5">{coverage.reason}</div>
                </div>
              </div>
            ) : null}
          </div>

          {/* STRICT CASHLESS PAYMENT OPTIONS */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#06265B] inline-flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#073B8C]" />
                Payment temporarily unavailable
              </h2>
              <span className="px-2 py-0.5 rounded bg-[#EAF3FF] text-[#073B8C] text-[10px] font-bold">
                NO CASH ON DELIVERY
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option A: Customer Digital Wallet */}
              <button
                type="button"
                onClick={() => setPaymentMethod('WALLET')}
                className={`p-4 rounded-xl border text-left transition-colors ${
                  paymentMethod === 'WALLET'
                    ? 'border-[#073B8C] bg-[#EAF3FF]/60 ring-1 ring-[#073B8C]'
                    : 'border-[#E2E8F0] hover:border-[#1769C2]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Wallet className="w-5 h-5 text-[#073B8C]" />
                  <span className="text-[10px] font-bold uppercase text-[#1769C2]">Option A</span>
                </div>
                <div className="text-sm font-bold text-[#06265B] mt-2">Pay with Digital Wallet</div>
                <div className="text-xs text-[#64748B] mt-0.5 tabular-nums">
                  {user?.role === 'CUSTOMER'
                    ? `Available: ${formatNaira(walletBalanceKobo)}`
                    : 'Sign in to use wallet balance'}
                </div>
              </button>

              {/* Option B: Direct Online Payment */}
              <button
                type="button"
                disabled
                title="Online payments are not available yet"
                className={`p-4 rounded-xl border text-left transition-colors ${
                  paymentMethod === 'DIRECT_ONLINE'
                    ? 'border-[#073B8C] bg-[#EAF3FF]/60 ring-1 ring-[#073B8C]'
                    : 'border-[#E2E8F0] hover:border-[#1769C2]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <CreditCard className="w-5 h-5 text-[#073B8C]" />
                  <span className="text-[10px] font-bold uppercase text-[#1769C2]">Option B</span>
                </div>
                <div className="text-sm font-bold text-[#06265B] mt-2">Direct Online Payment</div>
                <div className="text-xs text-[#64748B] mt-0.5">Unavailable until a real payment gateway is connected</div>
              </button>
            </div>

            {paymentMethod === 'WALLET' && user?.role === 'CUSTOMER' && !walletSufficient && (
              <div className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs space-y-2">
                <div className="font-bold text-[#B45309]">
                  Insufficient Wallet Balance ({formatNaira(walletBalanceKobo)} available · need{' '}
                  {formatNaira(totalAmountKobo)})
                </div>
                <p className="text-[#92400E]">
                  Wallet funding and ordering are temporarily unavailable while payments are being set up. Please do not send money.
                </p>
                <button
                  type="button"
                  disabled
                  title="Wallet funding is unavailable"
                  className="px-3.5 py-1.5 rounded-lg bg-[#073B8C] text-white font-bold hover:bg-[#06265B]"
                >
                  Fund Wallet via {gatewayProvider} Now
                </button>
              </div>
            )}

            {paymentMethod === 'DIRECT_ONLINE' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Payment Gateway</label>
                  <select
                    value={gatewayProvider}
                    onChange={(e) => setGatewayProvider(e.target.value as 'PAYSTACK' | 'FLUTTERWAVE')}
                    className="w-full px-3 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                  >
                    <option value="PAYSTACK">Paystack Nigeria</option>
                    <option value="FLUTTERWAVE">Flutterwave</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Payment Channel</label>
                  <select
                    value={gatewayChannel}
                    onChange={(e) => setGatewayChannel(e.target.value as 'CARD' | 'BANK_TRANSFER' | 'USSD')}
                    className="w-full px-3 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                  >
                    <option value="CARD">Debit / Credit Card</option>
                    <option value="BANK_TRANSFER">Instant Bank Transfer</option>
                    <option value="USSD">Bank USSD Code</option>
                  </select>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] text-[11px] text-[#64748B] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[#073B8C] shrink-0 mt-0.5" />
              <span>
                <strong>Strict Cashless Policy:</strong> Orders are confirmed and assigned to dispatchers{' '}
                <strong>only after</strong> backend electronic payment verification. Dispatchers are prohibited from
                collecting cash.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Order Totals & Confirm Button */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <h2 className="text-base font-extrabold text-[#06265B]">Complete Order Cost Breakdown</h2>

            {/* Promo Code */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#172B4D]">Promotion Code</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="Try WELCOME500 or UYO5"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-[#E2E8F0] rounded-lg uppercase focus:outline-none focus:border-[#073B8C]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleApplyPromo()}
                  className="px-3.5 py-2 rounded-lg bg-[#EAF3FF] text-[#073B8C] text-xs font-bold hover:bg-[#dbeafe]"
                >
                  Apply
                </button>
              </div>
              {promoMsg && (
                <div className={`text-[11px] font-semibold ${appliedPromo ? 'text-[#16834A]' : 'text-[#D64545]'}`}>
                  {promoMsg}
                </div>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] pt-3.5 space-y-2 text-xs">
              <div className="flex justify-between text-[#64748B]">
                <span>Gas & Products Subtotal</span>
                <span className="font-semibold text-[#172B4D] tabular-nums">{formatNaira(subtotalKobo)}</span>
              </div>
              <div className="flex justify-between text-[#64748B]">
                <span>Delivery Fee ({coverage ? `${coverage.distanceKm.toFixed(1)} km` : 'est.'})</span>
                <span className="font-semibold text-[#172B4D] tabular-nums">{formatNaira(deliveryFeeKobo)}</span>
              </div>
              <div className="flex justify-between text-[#64748B]">
                <span>Platform Service Fee (2%)</span>
                <span className="font-semibold text-[#172B4D] tabular-nums">{formatNaira(serviceFeeKobo)}</span>
              </div>
              {discountKobo > 0 && (
                <div className="flex justify-between text-[#16834A]">
                  <span>Promo Discount ({appliedPromo?.code})</span>
                  <span className="font-bold tabular-nums">-{formatNaira(discountKobo)}</span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t border-[#E2E8F0] text-base font-extrabold text-[#06265B]">
                <span>Total Due Electronically</span>
                <span className="tabular-nums">{formatNaira(totalAmountKobo)}</span>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#D64545] font-medium space-y-2">
                <div>{errorMsg}</div>
                {shortfallKobo !== null && (
                  <button
                    type="button"
                    disabled
                  title="Wallet funding is unavailable"
                    className="px-3 py-1.5 rounded-md bg-[#073B8C] text-white font-bold text-xs"
                  >
                    Fund Wallet Now (+{formatNaira(shortfallKobo)})
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              disabled
              onClick={() => void handlePlaceOrder()}
              className="w-full py-3 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-sm font-extrabold transition-colors disabled:opacity-50"
            >
              {true
                ? 'Ordering temporarily unavailable'
                : submitting
                  ? 'Processing Secure Order...'
                  : paymentMethod === 'WALLET'
                    ? `Pay ${formatNaira(totalAmountKobo)} from Wallet`
                    : `Proceed to ${gatewayProvider} (${formatNaira(totalAmountKobo)})`}
            </button>
          </div>
        </div>
      </div>

      {/* Electronic Payment Verification Modal */}
      {gatewaySession && user && (
        <PaymentGatewayModal
          session={gatewaySession}
          customerEmail={user.email}
          onClose={() => setGatewaySession(null)}
          onSuccess={(result) => {
            setGatewaySession(null);
            if (gatewaySession.purpose === 'WALLET_FUNDING') {
              if (result.walletBalanceKobo !== undefined) {
                setWalletBalanceKobo(result.walletBalanceKobo);
              }
              setShortfallKobo(null);
              setErrorMsg('');
            } else {
              clearCart();
              void refreshAuth();
              navigate(`/dashboard?tab=orders&highlight=${result.orderId || ''}`);
            }
          }}
          onFailure={(msg) => {
            setErrorMsg(msg);
          }}
        />
      )}
    </div>
  );
}
