import React, { useCallback, useEffect, useState } from 'react';
import {
  Truck,
  MapPin,
  Phone,
  CheckCircle2,
  AlertTriangle,
  Navigation,
  Wallet,
  Clock,
  ShieldAlert,
  Radio,
  PackageCheck,
  History,
  XCircle,
} from 'lucide-react';
import { apiRequest, subscribeToPlatformEvents } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatNaira } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { DeliveryTrackingMap } from '../components/DeliveryTrackingMap';
import type { DispatcherProfile } from '../types';

interface DispatcherJob {
  id: number;
  order_reference: string;
  status: string;
  payment_status: string;
  paymentNotice: string;
  delivery_address: string;
  delivery_neighbourhood: string;
  delivery_city: string;
  delivery_state: string;
  delivery_lat: number;
  delivery_lng: number;
  delivery_instructions: string;
  distance_km: number;
  estimated_delivery_mins: number;
  proof_of_delivery_note: string;
  failure_reason: string;
  failure_notes: string;
  customer_name: string;
  customer_phone: string;
  retailer_name: string;
  retailer_contact: string;
  retailer_phone: string;
  retailer_address: string;
  retailer_neighbourhood: string;
  retailer_city: string;
  retailer_lat: number;
  retailer_lng: number;
  created_at: string;
  delivered_at: string | null;
  items: { id: number; product_name: string; size_kg: number | null; quantity: number }[];
}

interface EarningRow {
  id: number;
  order_reference: string;
  delivery_neighbourhood: string;
  delivery_city: string;
  distance_km: number;
  compensation_model: string;
  base_amount_kobo: number;
  distance_bonus_kobo: number;
  admin_bonus_kobo: number;
  total_earning_kobo: number;
  status: string;
  payout_reference: string;
  delivered_at: string;
  paid_at: string | null;
}

export function DispatcherDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'active' | 'history' | 'earnings'>('active');

  const [profile, setProfile] = useState<(DispatcherProfile & { full_name: string; phone: string }) | null>(null);
  const [counts, setCounts] = useState({
    new_assignments: 0,
    active_deliveries: 0,
    completed_deliveries: 0,
    failed_deliveries: 0,
    cancelled_orders: 0,
  });
  const [earningsSummary, setEarningsSummary] = useState({
    pending_kobo: 0,
    approved_kobo: 0,
    paid_kobo: 0,
    total_earned_kobo: 0,
  });
  const [jobs, setJobs] = useState<DispatcherJob[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Delivery Confirmation (POD + Customer PIN)
  const [podOrderId, setPodOrderId] = useState<number | null>(null);
  const [podPin, setPodPin] = useState('');
  const [podNote, setPodNote] = useState('Cylinder delivered in good condition and verified with customer.');

  // Failure Reporting modal
  const [failOrderId, setFailOrderId] = useState<number | null>(null);
  const [failReason, setFailReason] = useState('CUSTOMER_UNAVAILABLE');
  const [failNotes, setFailNotes] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [dash, ord, earn] = await Promise.all([
        apiRequest<{
          profile: DispatcherProfile & { full_name: string; phone: string };
          counts: typeof counts;
          earningsSummary: typeof earningsSummary;
        }>('/api/dispatcher/dashboard'),
        apiRequest<{ orders: DispatcherJob[] }>('/api/dispatcher/orders'),
        apiRequest<{ earnings: EarningRow[] }>('/api/dispatcher/earnings'),
      ]);
      setProfile(dash.profile);
      setCounts(dash.counts);
      setEarningsSummary(dash.earningsSummary);
      setJobs(ord.orders);
      setEarnings(earn.earnings);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return subscribeToPlatformEvents({
      onOrderUpdate: () => void loadAll(),
      onNotification: () => void loadAll(),
    });
  }, [loadAll]);

  const flash = (msg: string) => {
    setNotice(msg);
    setError('');
    setTimeout(() => setNotice(''), 4000);
  };

  const handleAvailabilityChange = async (availabilityStatus: 'ONLINE' | 'BUSY' | 'OFFLINE') => {
    setError('');
    try {
      await apiRequest('/api/dispatcher/availability', {
        method: 'PATCH',
        body: { availabilityStatus },
      });
      flash(`Availability updated to ${availabilityStatus}.`);
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggleTracking = async (enable: boolean) => {
    setError('');
    try {
      await apiRequest('/api/dispatcher/location', {
        method: 'PATCH',
        body: { trackingEnabled: enable },
      });
      flash(enable ? 'Live GPS location sharing enabled for active deliveries.' : 'Live GPS location sharing paused.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSimulateGpsStep = async (job: DispatcherJob) => {
    if (!profile) return;
    setError('');
    // Move dispatcher marker 35% closer toward customer delivery point so live tracking is visibly verifiable
    const curLat = profile.current_lat || job.retailer_lat;
    const curLng = profile.current_lng || job.retailer_lng;
    const nextLat = curLat + (job.delivery_lat - curLat) * 0.35;
    const nextLng = curLng + (job.delivery_lng - curLng) * 0.35;
    try {
      await apiRequest('/api/dispatcher/location', {
        method: 'PATCH',
        body: { lat: nextLat, lng: nextLng, trackingEnabled: true },
      });
      flash('Live GPS coordinates broadcast to customer tracking map & Operations.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAdvanceStatus = async (
    orderId: number,
    nextStatus:
      | 'ACCEPTED_BY_DISPATCHER'
      | 'AWAITING_COLLECTION'
      | 'COLLECTED_FROM_RETAILER'
      | 'IN_TRANSIT'
      | 'DELIVERED',
    extra?: { confirmationCode?: string; proofOfDeliveryNote?: string }
  ) => {
    setUpdatingId(orderId);
    setError('');
    try {
      const res = await apiRequest<{ orderReference: string; status: string }>(`/api/dispatcher/orders/${orderId}/status`, {
        method: 'POST',
        body: { nextStatus, ...extra },
      });
      flash(`Order ${res.orderReference} updated to ${res.status.replace(/_/g, ' ')}.`);
      setPodOrderId(null);
      setPodPin('');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReportFailure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!failOrderId) return;
    setError('');
    try {
      await apiRequest(`/api/dispatcher/orders/${failOrderId}/report-failure`, {
        method: 'POST',
        body: { reason: failReason, notes: failNotes },
      });
      setFailOrderId(null);
      setFailNotes('');
      flash('Delivery failure report sent to Operations Admin & customer.');
      void loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const activeJobs = jobs.filter((j) =>
    [
      'ASSIGNED_TO_DISPATCHER',
      'ACCEPTED_BY_DISPATCHER',
      'AWAITING_COLLECTION',
      'COLLECTED_FROM_RETAILER',
      'IN_TRANSIT',
    ].includes(j.status)
  );
  const historyJobs = jobs.filter((j) => !activeJobs.includes(j));
  const focusedJob = activeJobs.find((j) => j.id === selectedJobId) || activeJobs[0] || null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">
      {/* Mobile-First Dispatcher Status Bar */}
      <div className="bg-[#06265B] text-white rounded-xl p-5 border border-[#073B8C] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#EAF3FF]/80">
                Dispatcher Field Operations
              </div>
              <h1 className="text-lg font-extrabold">{profile?.full_name || user?.full_name}</h1>
              <div className="text-xs text-[#EAF3FF]/80">
                {profile?.vehicle_type} · <span className="font-mono">{profile?.plate_number}</span> · Zone:{' '}
                {profile?.zone}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['ONLINE', 'BUSY', 'OFFLINE'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => void handleAvailabilityChange(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-colors ${
                  profile?.availability_status === st
                    ? st === 'ONLINE'
                      ? 'bg-[#16834A] border-[#4ADE80] text-white'
                      : st === 'BUSY'
                        ? 'bg-[#E99A25] border-[#FDE68A] text-white'
                        : 'bg-[#64748B] border-white/40 text-white'
                    : 'bg-white/10 border-white/20 text-[#EAF3FF] hover:bg-white/20'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Privacy-Controlled Live GPS Bar */}
        <div className="bg-white/10 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Radio
              className={`w-4 h-4 ${
                profile?.location_tracking_enabled ? 'text-[#4ADE80] animate-pulse' : 'text-[#EAF3FF]/60'
              }`}
            />
            <span>
              Live Delivery GPS Tracking:{' '}
              <strong>{profile?.location_tracking_enabled ? 'ACTIVE' : 'INACTIVE'}</strong>
              <span className="text-[#EAF3FF]/70 hidden sm:inline">
                {' '}
                (Restricted strictly to active deliveries; stops automatically upon handover)
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleToggleTracking(!profile?.location_tracking_enabled)}
            className="px-3 py-1 rounded-md bg-white text-[#06265B] font-bold hover:bg-[#EAF3FF]"
          >
            {profile?.location_tracking_enabled ? 'Pause GPS Sharing' : 'Enable Active GPS'}
          </button>
        </div>

        {/* Compact KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-[#EAF3FF]/75">New Assignments</div>
            <div className="text-xl font-extrabold tabular-nums mt-0.5">{counts.new_assignments || 0}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-[#EAF3FF]/75">Active Jobs</div>
            <div className="text-xl font-extrabold tabular-nums mt-0.5">{counts.active_deliveries || 0}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-[#EAF3FF]/75">Completed</div>
            <div className="text-xl font-extrabold tabular-nums mt-0.5">{counts.completed_deliveries || 0}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-[#EAF3FF]/75">Total Earnings</div>
            <div className="text-xl font-extrabold tabular-nums mt-0.5">
              {formatNaira(earningsSummary.total_earned_kobo)}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setTab('active')}
          className={`py-2.5 px-3 rounded-lg text-xs font-extrabold border inline-flex items-center justify-center gap-1.5 ${
            tab === 'active'
              ? 'bg-[#073B8C] text-white border-[#073B8C]'
              : 'bg-white text-[#172B4D] border-[#E2E8F0]'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          Assigned & Active ({activeJobs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`py-2.5 px-3 rounded-lg text-xs font-extrabold border inline-flex items-center justify-center gap-1.5 ${
            tab === 'history'
              ? 'bg-[#073B8C] text-white border-[#073B8C]'
              : 'bg-white text-[#172B4D] border-[#E2E8F0]'
          }`}
        >
          <History className="w-4 h-4" />
          History ({historyJobs.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('earnings')}
          className={`py-2.5 px-3 rounded-lg text-xs font-extrabold border inline-flex items-center justify-center gap-1.5 ${
            tab === 'earnings'
              ? 'bg-[#073B8C] text-white border-[#073B8C]'
              : 'bg-white text-[#172B4D] border-[#E2E8F0]'
          }`}
        >
          <Wallet className="w-4 h-4" />
          Earnings
        </button>
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

      {/* TAB: ACTIVE & NEW ASSIGNMENTS */}
      {tab === 'active' && (
        <div className="space-y-4">
          {activeJobs.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#16834A] mx-auto" />
              <h2 className="text-base font-bold text-[#06265B]">No Active Delivery Assignments</h2>
              <p className="text-xs text-[#64748B]">
                Keep your availability status set to <strong>ONLINE</strong> to receive new cooking gas assignments
                from Operations.
              </p>
            </div>
          ) : (
            activeJobs.map((job) => (
              <div
                key={job.id}
                className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-xs"
              >
                {/* Cashless Rule Banner */}
                <div className="bg-[#EAF3FF] border-b border-[#BFDBFE] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-extrabold text-[#073B8C]">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    {job.paymentNotice}
                  </span>
                  <span className="font-mono">{job.order_reference}</span>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <StatusBadge status={job.status} />
                      <div className="text-xs text-[#64748B] mt-1 inline-flex items-center gap-1 ml-2">
                        <Clock className="w-3.5 h-3.5" /> Est. route: {job.distance_km.toFixed(1)} km (~
                        {job.estimated_delivery_mins} mins)
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
                      className="text-xs font-bold text-[#1769C2] hover:underline inline-flex items-center gap-1"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      {focusedJob?.id === job.id ? 'Map Visible Below' : 'Show Navigation Map'}
                    </button>
                  </div>

                  {/* Products to Collect */}
                  <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg p-3.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1.5">
                      Products & Quantities to Collect
                    </div>
                    <ul className="space-y-1 text-sm font-bold text-[#06265B]">
                      {job.items.map((item) => (
                        <li key={item.id}>
                          {item.quantity} × {item.product_name}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Collection & Delivery Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-lg border border-[#E2E8F0] space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#073B8C]">
                        Step 1 · Collect from Retailer
                      </div>
                      <div className="font-bold text-[#06265B] text-sm">{job.retailer_name}</div>
                      <div className="text-[#172B4D] flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#073B8C] shrink-0 mt-0.5" />
                        <span>
                          {job.retailer_address}, {job.retailer_neighbourhood}, {job.retailer_city}
                        </span>
                      </div>
                      <div className="text-[#64748B] pt-1">
                        Contact: {job.retailer_contact} ·{' '}
                        <a href={`tel:${job.retailer_phone}`} className="text-[#1769C2] font-bold">
                          {job.retailer_phone}
                        </a>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border border-[#E2E8F0] space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#16834A]">
                        Step 2 · Deliver to Customer
                      </div>
                      <div className="font-bold text-[#06265B] text-sm">{job.customer_name}</div>
                      <div className="text-[#172B4D] flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#16834A] shrink-0 mt-0.5" />
                        <span>
                          {job.delivery_address}, {job.delivery_neighbourhood}, {job.delivery_city}
                        </span>
                      </div>
                      <div className="text-[#64748B] pt-0.5 inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <a href={`tel:${job.customer_phone}`} className="text-[#1769C2] font-bold">
                          {job.customer_phone}
                        </a>
                      </div>
                      {job.delivery_instructions && (
                        <div className="mt-1 p-2 rounded bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[11px]">
                          <strong>Instructions:</strong> {job.delivery_instructions}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Embedded Navigation Map for Focused Job */}
                  {focusedJob?.id === job.id && (
                    <div className="space-y-2">
                      <DeliveryTrackingMap
                        retailer={{
                          name: job.retailer_name,
                          address: job.retailer_address,
                          lat: job.retailer_lat,
                          lng: job.retailer_lng,
                        }}
                        customer={{
                          address: job.delivery_address,
                          lat: job.delivery_lat,
                          lng: job.delivery_lng,
                        }}
                        dispatcher={
                          profile
                            ? {
                                name: profile.full_name,
                                lat: profile.current_lat,
                                lng: profile.current_lng,
                                active: profile.location_tracking_enabled === 1,
                              }
                            : null
                        }
                        heightClass="h-[250px]"
                        showExternalNavLinks
                      />
                      {['ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT'].includes(
                        job.status
                      ) && (
                        <button
                          type="button"
                          onClick={() => void handleSimulateGpsStep(job)}
                          className="px-3 py-1.5 rounded-lg border border-[#BFDBFE] bg-[#EAF3FF] text-[#073B8C] text-xs font-bold hover:bg-[#dbeafe]"
                        >
                          Broadcast Live GPS Route Ping (Move Toward Customer)
                        </button>
                      )}
                    </div>
                  )}

                  {/* 8-Stage Field Action Buttons (Thumb-friendly full width on mobile) */}
                  <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-[#E2E8F0]">
                    {job.status === 'ASSIGNED_TO_DISPATCHER' && (
                      <button
                        type="button"
                        disabled={updatingId === job.id}
                        onClick={() => void handleAdvanceStatus(job.id, 'ACCEPTED_BY_DISPATCHER')}
                        className="flex-1 py-3 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold"
                      >
                        Accept & Acknowledge Delivery Assignment
                      </button>
                    )}

                    {job.status === 'ACCEPTED_BY_DISPATCHER' && (
                      <>
                        <button
                          type="button"
                          disabled={updatingId === job.id}
                          onClick={() => void handleAdvanceStatus(job.id, 'AWAITING_COLLECTION')}
                          className="flex-1 py-3 px-4 rounded-lg bg-[#1769C2] hover:bg-[#073B8C] text-white text-xs font-extrabold"
                        >
                          Arrived at Retailer (Awaiting Collection)
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === job.id}
                          onClick={() => void handleAdvanceStatus(job.id, 'COLLECTED_FROM_RETAILER')}
                          className="flex-1 py-3 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold"
                        >
                          Confirm Product Collection
                        </button>
                      </>
                    )}

                    {job.status === 'AWAITING_COLLECTION' && (
                      <button
                        type="button"
                        disabled={updatingId === job.id}
                        onClick={() => void handleAdvanceStatus(job.id, 'COLLECTED_FROM_RETAILER')}
                        className="flex-1 py-3 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold"
                      >
                        Confirm Correct Products & Quantities Collected
                      </button>
                    )}

                    {job.status === 'COLLECTED_FROM_RETAILER' && (
                      <button
                        type="button"
                        disabled={updatingId === job.id}
                        onClick={() => void handleAdvanceStatus(job.id, 'IN_TRANSIT')}
                        className="flex-1 py-3 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold"
                      >
                        Depart to Customer (Notify In Transit)
                      </button>
                    )}

                    {job.status === 'IN_TRANSIT' && (
                      <button
                        type="button"
                        disabled={updatingId === job.id}
                        onClick={() => setPodOrderId(job.id)}
                        className="flex-1 py-3 px-4 rounded-lg bg-[#16834A] hover:bg-[#15803D] text-white text-xs font-extrabold"
                      >
                        Confirm Successful Delivery & Submit Proof
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setFailOrderId(job.id)}
                      className="py-3 px-4 rounded-lg border border-[#FECACA] text-[#D64545] hover:bg-[#FEF2F2] text-xs font-bold"
                    >
                      Report Issue / Failed Delivery
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB: DELIVERY HISTORY */}
      {tab === 'history' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] text-xs font-bold text-[#06265B]">
            Completed, Failed & Cancelled Deliveries
          </div>
          <div className="divide-y divide-[#E2E8F0] text-xs">
            {historyJobs.length === 0 ? (
              <div className="p-8 text-center text-[#64748B]">No historical delivery records yet.</div>
            ) : (
              historyJobs.map((j) => (
                <div key={j.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#073B8C]">{j.order_reference}</span>
                    <StatusBadge status={j.status} />
                  </div>
                  <div className="font-bold text-[#06265B]">
                    {j.retailer_name} → {j.delivery_neighbourhood}, {j.delivery_city}
                  </div>
                  <div className="text-[#64748B]">
                    {j.items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ')} · {j.distance_km.toFixed(1)} km
                  </div>
                  {j.proof_of_delivery_note && (
                    <div className="text-[#16834A] font-medium">POD: {j.proof_of_delivery_note}</div>
                  )}
                  {j.failure_reason && (
                    <div className="text-[#D64545] font-medium">
                      Reported {j.failure_reason.replace(/_/g, ' ')}: {j.failure_notes}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: EARNINGS & SETTLEMENTS */}
      {tab === 'earnings' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-xs text-[#64748B]">Pending Review</div>
              <div className="text-xl font-extrabold text-[#B45309] tabular-nums mt-1">
                {formatNaira(earningsSummary.pending_kobo)}
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-xs text-[#64748B]">Approved (Awaiting Payout)</div>
              <div className="text-xl font-extrabold text-[#073B8C] tabular-nums mt-1">
                {formatNaira(earningsSummary.approved_kobo)}
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-xs text-[#64748B]">Paid Settlements</div>
              <div className="text-xl font-extrabold text-[#16834A] tabular-nums mt-1">
                {formatNaira(earningsSummary.paid_kobo)}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between text-xs">
              <span className="font-bold text-[#06265B]">Delivery Compensation & Settlement History</span>
              <span className="text-[#64748B]">
                Model: <strong>{profile?.compensation_model?.replace(/_/g, ' ')}</strong>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[#64748B] bg-[#F7F9FC]">
                    <th className="py-2.5 px-4 font-bold">Order & Payout Ref</th>
                    <th className="py-2.5 px-4 font-bold">Route</th>
                    <th className="py-2.5 px-4 font-bold text-right">Base + Dist + Bonus</th>
                    <th className="py-2.5 px-4 font-bold text-right">Total Earning</th>
                    <th className="py-2.5 px-4 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {earnings.map((e) => (
                    <tr key={e.id}>
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-[#06265B]">{e.order_reference}</div>
                        <div className="text-[11px] font-mono text-[#64748B]">{e.payout_reference}</div>
                      </td>
                      <td className="py-3 px-4 text-[#172B4D]">
                        {e.delivery_neighbourhood} ({e.distance_km.toFixed(1)} km)
                      </td>
                      <td className="py-3 px-4 text-right text-[#64748B] tabular-nums">
                        {formatNaira(e.base_amount_kobo)} + {formatNaira(e.distance_bonus_kobo)} +{' '}
                        {formatNaira(e.admin_bonus_kobo)}
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-[#073B8C] tabular-nums">
                        {formatNaira(e.total_earning_kobo)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={e.status} />
                        {e.paid_at && <div className="text-[10px] text-[#64748B] mt-0.5">{formatDateTime(e.paid_at)}</div>}
                      </td>
                    </tr>
                  ))}
                  {earnings.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[#64748B]">
                        Complete deliveries to earn compensation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Proof of Delivery Modal */}
      {podOrderId && (
        <div className="fixed inset-0 z-50 bg-[#06265B]/60 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#06265B]">Confirm Delivery & Submit Proof</h3>
              <button type="button" onClick={() => setPodOrderId(null)} className="text-[#64748B]">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">
                  Customer 4-Digit Confirmation PIN (Optional if verified directly)
                </label>
                <input
                  value={podPin}
                  onChange={(e) => setPodPin(e.target.value)}
                  placeholder="Enter 4-digit PIN from customer dashboard"
                  className="w-full px-3 py-2 font-mono text-sm border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Proof of Delivery Note</label>
                <textarea
                  rows={3}
                  value={podNote}
                  onChange={(e) => setPodNote(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleAdvanceStatus(podOrderId, 'DELIVERED', {
                    confirmationCode: podPin.trim() || undefined,
                    proofOfDeliveryNote: podNote.trim(),
                  })
                }
                className="w-full py-2.5 rounded-lg bg-[#16834A] hover:bg-[#15803D] text-white font-extrabold"
              >
                Complete Delivery & Credit Earning
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Delivery Failure Modal */}
      {failOrderId && (
        <div className="fixed inset-0 z-50 bg-[#06265B]/60 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#D64545]">Report Delivery Failure or Retailer Issue</h3>
              <button type="button" onClick={() => setFailOrderId(null)} className="text-[#64748B]">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleReportFailure} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Issue Category</label>
                <select
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
                >
                  <option value="CUSTOMER_UNAVAILABLE">Customer Unavailable</option>
                  <option value="INCORRECT_ADDRESS">Incorrect Delivery Address</option>
                  <option value="RETAILER_UNABLE_TO_SUPPLY">Retailer Unable to Supply Product</option>
                  <option value="PRODUCT_UNAVAILABLE">Product Out of Stock at Depot</option>
                  <option value="VEHICLE_PROBLEM">Vehicle / Mechanical Problem</option>
                  <option value="OTHER">Other Delivery Issue</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#172B4D] mb-1">Detailed Field Report</label>
                <textarea
                  required
                  minLength={6}
                  rows={3}
                  value={failNotes}
                  onChange={(e) => setFailNotes(e.target.value)}
                  placeholder="Provide details for Operations Admin to reassign, resolve, or refund..."
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#D64545] hover:bg-[#B91C1C] text-white font-extrabold"
              >
                Submit Incident Report to Admin
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
