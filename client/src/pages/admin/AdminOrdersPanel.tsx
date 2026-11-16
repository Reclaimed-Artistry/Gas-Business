import React, { useState } from 'react';
import { Truck, Zap, RefreshCw, XCircle, RotateCcw } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatNaira } from '../../lib/format';
import { StatusBadge } from '../../components/StatusBadge';

export interface AdminOrderRow {
  id: number;
  order_reference: string;
  customer_name: string;
  customer_phone: string;
  retailer_name: string;
  retailer_address: string;
  dispatcher_id: number | null;
  dispatcher_name: string | null;
  dispatcher_plate: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string | null;
  delivery_address: string;
  delivery_neighbourhood: string;
  delivery_city: string;
  distance_km: number;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  total_amount_kobo: number;
  platform_margin_kobo: number;
  failure_reason: string;
  failure_notes: string;
  created_at: string;
  delivered_at: string | null;
  items: { product_name: string; quantity: number; line_total_kobo: number }[];
}

interface DispatcherCandidate {
  dispatcherId: number;
  fullName: string;
  phone: string;
  vehicleType: string;
  plateNumber: string;
  zone: string;
  availabilityStatus: string;
  distanceToRetailerKm: number;
  totalEstimatedRouteKm: number;
  activeJobsCount: number;
  ratingAvg: number;
  score: number;
  recommendationReason: string;
}

export function AdminOrdersPanel({
  orders,
  onReload,
  onFlash,
  onError,
}: {
  orders: AdminOrderRow[];
  onReload: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [assignModalOrder, setAssignModalOrder] = useState<AdminOrderRow | null>(null);
  const [candidates, setCandidates] = useState<DispatcherCandidate[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const openAssignmentModal = async (order: AdminOrderRow) => {
    setAssignModalOrder(order);
    setLoadingRecs(true);
    try {
      const res = await apiRequest<{ candidates: DispatcherCandidate[] }>(
        `/api/admin/orders/${order.id}/recommendations`
      );
      setCandidates(res.candidates);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoadingRecs(false);
    }
  };

  const handleAssign = async (orderId: number, options: { dispatcherId?: number; autoAssign?: boolean }) => {
    try {
      const res = await apiRequest<{ orderReference: string; dispatcherName: string; autoAssigned: boolean }>(
        `/api/admin/orders/${orderId}/assign`,
        {
          method: 'POST',
          body: options,
        }
      );
      onFlash(
        `${res.autoAssigned ? 'Auto-assigned' : 'Assigned'} ${res.orderReference} to ${res.dispatcherName}.`
      );
      setAssignModalOrder(null);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleRefund = async (order: AdminOrderRow) => {
    const reason = window.prompt(
      `Approve full wallet refund (${formatNaira(order.total_amount_kobo)}) for ${order.order_reference}? Enter refund reason:`,
      order.failure_reason ? `Failed delivery: ${order.failure_reason}` : 'Approved customer refund'
    );
    if (!reason) return;
    try {
      const res = await apiRequest<{ refundReference: string }>('/api/admin/finance/refunds', {
        method: 'POST',
        body: { orderId: order.id, destination: 'WALLET', reason },
      });
      onFlash(`Refund processed to customer wallet (Ref: ${res.refundReference}).`);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleCancel = async (order: AdminOrderRow) => {
    const reason = window.prompt(`Cancel order ${order.order_reference}? Enter reason:`, 'Cancelled by Operations');
    if (!reason) return;
    try {
      await apiRequest(`/api/admin/orders/${order.id}/cancel`, { method: 'POST', body: { reason } });
      onFlash(`Order ${order.order_reference} cancelled.`);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const filtered = statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#06265B]">Orders & Dispatch Control Tower</h2>
          <p className="text-xs text-[#64748B]">
            Monitor verified electronic orders, run automatic proximity dispatch scoring, manually override assignments,
            or resolve failed deliveries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-white"
          >
            <option value="ALL">All Statuses ({orders.length})</option>
            <option value="AWAITING_DISPATCHER_ASSIGNMENT">Awaiting Dispatcher</option>
            <option value="ASSIGNED_TO_DISPATCHER">Assigned to Dispatcher</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="DELIVERY_FAILED">Delivery Failed</option>
            <option value="REFUND_PROCESSING">Refund Processing</option>
            <option value="REFUNDED">Refunded</option>
          </select>
          <button
            type="button"
            onClick={onReload}
            className="p-2 rounded-lg border border-[#E2E8F0] bg-white hover:border-[#073B8C] text-[#073B8C]"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-3 px-4 font-bold">Order & Date</th>
                <th className="py-3 px-4 font-bold">Customer & Drop-off</th>
                <th className="py-3 px-4 font-bold">Retailer & Items</th>
                <th className="py-3 px-4 font-bold">Payment</th>
                <th className="py-3 px-4 font-bold">Dispatcher & Status</th>
                <th className="py-3 px-4 font-bold text-right">Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filtered.map((ord) => (
                <tr key={ord.id} className="hover:bg-[#F7F9FC] align-top">
                  <td className="py-3 px-4">
                    <div className="font-mono font-bold text-[#073B8C]">{ord.order_reference}</div>
                    <div className="text-[11px] text-[#64748B] mt-0.5">{formatDateTime(ord.created_at)}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#06265B]">{ord.customer_name}</div>
                    <div className="text-[11px] text-[#64748B]">
                      {ord.delivery_neighbourhood}, {ord.delivery_city} ({ord.distance_km.toFixed(1)} km)
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#172B4D]">{ord.retailer_name}</div>
                    <div className="text-[11px] text-[#64748B]">
                      {ord.items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ')}
                    </div>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    <div className="font-extrabold text-[#06265B]">{formatNaira(ord.total_amount_kobo)}</div>
                    <div className="text-[10px] font-semibold text-[#64748B]">
                      {ord.payment_method} · {ord.payment_status}
                    </div>
                    <div className="text-[10px] text-[#16834A] font-semibold">
                      Margin: {formatNaira(ord.platform_margin_kobo)}
                    </div>
                  </td>
                  <td className="py-3 px-4 space-y-1">
                    <StatusBadge status={ord.status} />
                    <div className="text-[11px] text-[#172B4D] font-semibold">
                      {ord.dispatcher_name ? `${ord.dispatcher_name} (${ord.dispatcher_plate})` : 'Unassigned'}
                    </div>
                    {ord.failure_reason && (
                      <div className="text-[10px] text-[#D64545] font-semibold">
                        {ord.failure_reason.replace(/_/g, ' ')}: {ord.failure_notes}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                      {ord.payment_status === 'PAID' &&
                        !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(ord.status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleAssign(ord.id, { autoAssign: true })}
                              className="px-2.5 py-1.5 rounded-lg bg-[#EAF3FF] text-[#073B8C] hover:bg-[#dbeafe] font-bold inline-flex items-center gap-1"
                              title="Auto-Assign optimal dispatcher"
                            >
                              <Zap className="w-3 h-3" /> Auto
                            </button>
                            <button
                              type="button"
                              onClick={() => void openAssignmentModal(ord)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#073B8C] text-white hover:bg-[#06265B] font-bold inline-flex items-center gap-1"
                            >
                              <Truck className="w-3 h-3" /> {ord.dispatcher_id ? 'Reassign' : 'Assign'}
                            </button>
                          </>
                        )}
                      {['DELIVERY_FAILED', 'REFUND_PROCESSING', 'CANCELLED'].includes(ord.status) &&
                        ord.payment_status !== 'REFUNDED' &&
                        ord.payment_status !== 'AWAITING_PAYMENT' && (
                          <button
                            type="button"
                            onClick={() => void handleRefund(ord)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#ECFDF3] border border-[#BBF7D0] text-[#16834A] font-bold inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Refund Wallet
                          </button>
                        )}
                      {!['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(ord.status) && (
                        <button
                          type="button"
                          onClick={() => void handleCancel(ord)}
                          className="p-1.5 rounded-lg border border-[#FECACA] text-[#D64545]"
                          title="Cancel Order"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dispatcher Assignment & Scoring Recommendation Modal */}
      {assignModalOrder && (
        <div className="fixed inset-0 z-50 bg-[#06265B]/60 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-2xl w-full p-5 space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#06265B]">
                  Assign Dispatcher · {assignModalOrder.order_reference}
                </h3>
                <p className="text-xs text-[#64748B]">
                  Collect from <strong>{assignModalOrder.retailer_name}</strong> → Deliver to{' '}
                  <strong>{assignModalOrder.delivery_neighbourhood}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalOrder(null)}
                className="text-xs font-bold text-[#64748B]"
              >
                Close
              </button>
            </div>

            <div className="flex items-center justify-between bg-[#EAF3FF] border border-[#BFDBFE] rounded-lg p-3 text-xs">
              <span className="font-semibold text-[#073B8C]">
                Dispatch engine ranks candidates by proximity, workload, availability & rating.
              </span>
              <button
                type="button"
                onClick={() => void handleAssign(assignModalOrder.id, { autoAssign: true })}
                className="px-3 py-1.5 rounded-lg bg-[#073B8C] text-white font-bold inline-flex items-center gap-1 shrink-0"
              >
                <Zap className="w-3.5 h-3.5" /> Auto-Assign Best Match
              </button>
            </div>

            {loadingRecs ? (
              <div className="py-8 text-center text-xs text-[#64748B]">Scoring available dispatchers...</div>
            ) : (
              <div className="space-y-2.5">
                {candidates.map((c, idx) => (
                  <div
                    key={c.dispatcherId}
                    className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                      idx === 0 ? 'border-[#073B8C] bg-[#EAF3FF]/40' : 'border-[#E2E8F0]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#06265B] text-sm">{c.fullName}</span>
                        <StatusBadge status={c.availabilityStatus} />
                        {idx === 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#073B8C] text-white text-[10px] font-bold">
                            Top Recommended (Score {c.score})
                          </span>
                        )}
                      </div>
                      <div className="text-[#64748B] mt-1">
                        {c.vehicleType} ({c.plateNumber}) · Zone: {c.zone} · ★ {c.ratingAvg.toFixed(1)}
                      </div>
                      <div className="text-[#073B8C] font-semibold mt-0.5">
                        {c.recommendationReason} · Est. full trip {c.totalEstimatedRouteKm.toFixed(1)} km
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAssign(assignModalOrder.id, { dispatcherId: c.dispatcherId })}
                      className="px-3.5 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white font-bold"
                    >
                      Assign Dispatcher
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
