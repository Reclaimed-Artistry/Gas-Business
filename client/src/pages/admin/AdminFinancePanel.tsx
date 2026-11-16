import React, { useEffect, useState } from 'react';
import { ShieldCheck, CheckCircle2, Banknote, RotateCcw } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatNaira } from '../../lib/format';
import { StatusBadge } from '../../components/StatusBadge';

interface FinanceData {
  totals: {
    totalCustomerPaymentsKobo: number;
    totalWalletFundingKobo: number;
    totalRetailerPayoutsDueKobo: number;
    totalRetailerPayoutsPaidKobo: number;
    totalDispatcherDueKobo: number;
    totalDispatcherPaidKobo: number;
    totalRefundedKobo: number;
    netPlatformRevenueKobo: number;
  };
  retailerSettlements: {
    id: number;
    retailer_name: string;
    order_reference: string;
    product_sale_kobo: number;
    agreed_retailer_payout_kobo: number;
    platform_margin_kobo: number;
    status: string;
    settlement_reference: string;
    paid_at: string | null;
  }[];
  dispatcherEarnings: {
    id: number;
    dispatcher_name: string;
    order_reference: string;
    distance_km: number;
    compensation_model: string;
    base_amount_kobo: number;
    distance_bonus_kobo: number;
    admin_bonus_kobo: number;
    total_earning_kobo: number;
    status: string;
    payout_reference: string;
    paid_at: string | null;
  }[];
  walletTransactions: {
    id: number;
    customer_name: string;
    reference: string;
    type: string;
    direction: string;
    amount_kobo: number;
    balance_after_kobo: number;
    status: string;
    payment_method: string;
    created_at: string;
  }[];
  gatewayTransactions: {
    id: number;
    customer_name: string;
    reference: string;
    purpose: string;
    provider: string;
    channel: string;
    amount_kobo: number;
    status: string;
    created_at: string;
  }[];
  refunds: {
    id: number;
    order_reference: string;
    customer_name: string;
    amount_kobo: number;
    destination: string;
    reason: string;
    status: string;
    refund_reference: string;
    processed_at: string | null;
  }[];
  auditLogs: {
    id: number;
    event_type: string;
    actor_name: string | null;
    actor_role: string;
    entity_type: string;
    reference: string;
    amount_kobo: number;
    created_at: string;
  }[];
}

export function AdminFinancePanel({
  onFlash,
  onError,
}: {
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [subTab, setSubTab] = useState<'settlements' | 'dispatchers' | 'wallets' | 'gateways' | 'refunds' | 'audit'>(
    'settlements'
  );

  const loadFinance = async () => {
    try {
      const res = await apiRequest<FinanceData>('/api/admin/finance/summary');
      setData(res);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  useEffect(() => {
    void loadFinance();
  }, []);

  const updateSettlement = async (id: number, status: 'APPROVED' | 'PAID') => {
    try {
      await apiRequest(`/api/admin/finance/settlements/${id}`, {
        method: 'PATCH',
        body: { status },
      });
      onFlash(`Retailer settlement marked ${status}.`);
      void loadFinance();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const updateDispatcherEarning = async (id: number, status: 'APPROVED' | 'PAID', askBonus = false) => {
    let adminBonusNaira: number | undefined;
    if (askBonus) {
      const val = window.prompt('Add optional performance bonus (₦ Naira, e.g. 500):', '500');
      if (val === null) return;
      adminBonusNaira = Number(val) || 0;
    }
    try {
      await apiRequest(`/api/admin/finance/dispatcher-earnings/${id}`, {
        method: 'PATCH',
        body: { status, adminBonusNaira },
      });
      onFlash(`Dispatcher compensation updated (${status}).`);
      void loadFinance();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  if (!data) {
    return <div className="py-10 text-center text-xs text-[#64748B]">Loading financial ledger...</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-extrabold text-[#06265B]">
          Central Financial Ledger, Settlements & Audit Trail
        </h2>
        <p className="text-xs text-[#64748B]">
          Separate traceable records for customer payments, wallets, retailer settlements, dispatcher compensation,
          refunds, and platform revenue.
        </p>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
          <div className="text-[#64748B]">Gross Verified Payments</div>
          <div className="text-xl font-extrabold text-[#06265B] tabular-nums mt-1">
            {formatNaira(data.totals.totalCustomerPaymentsKobo)}
          </div>
          <div className="text-[11px] text-[#16834A] mt-0.5">
            Platform Net: {formatNaira(data.totals.netPlatformRevenueKobo)}
          </div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
          <div className="text-[#64748B]">Retailer Settlements Due</div>
          <div className="text-xl font-extrabold text-[#073B8C] tabular-nums mt-1">
            {formatNaira(data.totals.totalRetailerPayoutsDueKobo)}
          </div>
          <div className="text-[11px] text-[#64748B] mt-0.5">
            Settled: {formatNaira(data.totals.totalRetailerPayoutsPaidKobo)}
          </div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
          <div className="text-[#64748B]">Dispatcher Payouts Due</div>
          <div className="text-xl font-extrabold text-[#B45309] tabular-nums mt-1">
            {formatNaira(data.totals.totalDispatcherDueKobo)}
          </div>
          <div className="text-[11px] text-[#64748B] mt-0.5">
            Paid: {formatNaira(data.totals.totalDispatcherPaidKobo)}
          </div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
          <div className="text-[#64748B]">Wallet Funding / Refunds</div>
          <div className="text-xl font-extrabold text-[#1769C2] tabular-nums mt-1">
            {formatNaira(data.totals.totalWalletFundingKobo)}
          </div>
          <div className="text-[11px] text-[#D64545] mt-0.5">
            Refunded: {formatNaira(data.totals.totalRefundedKobo)}
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['settlements', `Retailer Settlements (${data.retailerSettlements.length})`],
            ['dispatchers', `Dispatcher Compensation (${data.dispatcherEarnings.length})`],
            ['wallets', `Customer Wallets (${data.walletTransactions.length})`],
            ['gateways', `Paystack / Flutterwave (${data.gatewayTransactions.length})`],
            ['refunds', `Refunds (${data.refunds.length})`],
            ['audit', `Financial Audit Logs (${data.auditLogs.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              subTab === k ? 'bg-[#073B8C] text-white border-[#073B8C]' : 'bg-white text-[#172B4D] border-[#E2E8F0]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* RETAILER SETTLEMENTS */}
      {subTab === 'settlements' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Retailer & Ref</th>
                <th className="py-2.5 px-4 font-bold">Order</th>
                <th className="py-2.5 px-4 font-bold text-right">Product Sale</th>
                <th className="py-2.5 px-4 font-bold text-right">Agreed Payout</th>
                <th className="py-2.5 px-4 font-bold text-right">Platform Margin</th>
                <th className="py-2.5 px-4 font-bold">Status</th>
                <th className="py-2.5 px-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.retailerSettlements.map((s) => (
                <tr key={s.id}>
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#06265B]">{s.retailer_name}</div>
                    <div className="font-mono text-[10px] text-[#64748B]">{s.settlement_reference}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#073B8C] font-semibold">{s.order_reference}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{formatNaira(s.product_sale_kobo)}</td>
                  <td className="py-3 px-4 text-right font-extrabold text-[#06265B] tabular-nums">
                    {formatNaira(s.agreed_retailer_payout_kobo)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-[#16834A] tabular-nums">
                    {formatNaira(s.platform_margin_kobo)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-3 px-4 text-right space-x-1">
                    {s.status === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => void updateSettlement(s.id, 'APPROVED')}
                        className="px-2.5 py-1 rounded bg-[#EAF3FF] text-[#073B8C] font-bold"
                      >
                        Approve
                      </button>
                    )}
                    {(s.status === 'PENDING' || s.status === 'APPROVED') && (
                      <button
                        type="button"
                        onClick={() => void updateSettlement(s.id, 'PAID')}
                        className="px-2.5 py-1 rounded bg-[#16834A] text-white font-bold inline-flex items-center gap-1"
                      >
                        <Banknote className="w-3 h-3" /> Mark Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DISPATCHER COMPENSATION */}
      {subTab === 'dispatchers' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Dispatcher & Ref</th>
                <th className="py-2.5 px-4 font-bold">Order / Distance</th>
                <th className="py-2.5 px-4 font-bold text-right">Base + Dist + Bonus</th>
                <th className="py-2.5 px-4 font-bold text-right">Total Payout</th>
                <th className="py-2.5 px-4 font-bold">Status</th>
                <th className="py-2.5 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.dispatcherEarnings.map((d) => (
                <tr key={d.id}>
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#06265B]">{d.dispatcher_name}</div>
                    <div className="font-mono text-[10px] text-[#64748B]">{d.payout_reference}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-mono font-semibold text-[#073B8C]">{d.order_reference}</div>
                    <div className="text-[11px] text-[#64748B]">
                      {d.distance_km.toFixed(1)} km · {d.compensation_model}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-[#64748B]">
                    {formatNaira(d.base_amount_kobo)} + {formatNaira(d.distance_bonus_kobo)} +{' '}
                    {formatNaira(d.admin_bonus_kobo)}
                  </td>
                  <td className="py-3 px-4 text-right font-extrabold text-[#06265B] tabular-nums">
                    {formatNaira(d.total_earning_kobo)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="py-3 px-4 text-right space-x-1">
                    {d.status !== 'PAID' && (
                      <>
                        <button
                          type="button"
                          onClick={() => void updateDispatcherEarning(d.id, 'APPROVED', true)}
                          className="px-2.5 py-1 rounded bg-[#EAF3FF] text-[#073B8C] font-bold"
                        >
                          + Bonus
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateDispatcherEarning(d.id, 'PAID', false)}
                          className="px-2.5 py-1 rounded bg-[#16834A] text-white font-bold inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Pay Out
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CUSTOMER WALLET LEDGER */}
      {subTab === 'wallets' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Customer & Reference</th>
                <th className="py-2.5 px-4 font-bold">Type / Method</th>
                <th className="py-2.5 px-4 font-bold">Status</th>
                <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                <th className="py-2.5 px-4 font-bold text-right">Balance After</th>
                <th className="py-2.5 px-4 font-bold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.walletTransactions.map((w) => (
                <tr key={w.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-bold text-[#06265B]">{w.customer_name}</div>
                    <div className="font-mono text-[10px] text-[#64748B]">{w.reference}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    {w.type} ({w.payment_method})
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={w.status} />
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-bold tabular-nums ${
                      w.direction === 'CREDIT' ? 'text-[#16834A]' : 'text-[#06265B]'
                    }`}
                  >
                    {w.direction === 'CREDIT' ? '+' : '-'}
                    {formatNaira(w.amount_kobo)}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums">{formatNaira(w.balance_after_kobo)}</td>
                  <td className="py-2.5 px-4 text-[#64748B]">{formatDateTime(w.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GATEWAY TRANSACTIONS */}
      {subTab === 'gateways' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Reference</th>
                <th className="py-2.5 px-4 font-bold">Customer</th>
                <th className="py-2.5 px-4 font-bold">Provider / Channel</th>
                <th className="py-2.5 px-4 font-bold">Purpose</th>
                <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                <th className="py-2.5 px-4 font-bold">Status</th>
                <th className="py-2.5 px-4 font-bold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.gatewayTransactions.map((g) => (
                <tr key={g.id}>
                  <td className="py-2.5 px-4 font-mono font-bold text-[#073B8C]">{g.reference}</td>
                  <td className="py-2.5 px-4 font-semibold text-[#06265B]">{g.customer_name}</td>
                  <td className="py-2.5 px-4">
                    {g.provider} · {g.channel}
                  </td>
                  <td className="py-2.5 px-4">{g.purpose.replace(/_/g, ' ')}</td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums">{formatNaira(g.amount_kobo)}</td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={g.status} />
                  </td>
                  <td className="py-2.5 px-4 text-[#64748B]">{formatDateTime(g.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* REFUNDS */}
      {subTab === 'refunds' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Refund & Order Ref</th>
                <th className="py-2.5 px-4 font-bold">Customer</th>
                <th className="py-2.5 px-4 font-bold">Destination & Reason</th>
                <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                <th className="py-2.5 px-4 font-bold">Status</th>
                <th className="py-2.5 px-4 font-bold">Processed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.refunds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#64748B]">
                    No refunds recorded yet. Trigger eligible refunds from Orders Control Tower.
                  </td>
                </tr>
              ) : (
                data.refunds.map((rf) => (
                  <tr key={rf.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-bold text-[#073B8C]">{rf.refund_reference}</div>
                      <div className="font-mono text-[10px] text-[#64748B]">{rf.order_reference}</div>
                    </td>
                    <td className="py-2.5 px-4 font-bold text-[#06265B]">{rf.customer_name}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold">{rf.destination}</div>
                      <div className="text-[#64748B]">{rf.reason}</div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-extrabold tabular-nums">
                      {formatNaira(rf.amount_kobo)}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={rf.status} />
                    </td>
                    <td className="py-2.5 px-4 text-[#64748B]">{formatDateTime(rf.processed_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* FINANCIAL AUDIT LOGS */}
      {subTab === 'audit' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#EAF3FF]/60 flex items-center gap-2 text-xs font-bold text-[#073B8C]">
            <ShieldCheck className="w-4 h-4" />
            Immutable Financial Audit Trail — Every Verified Credit, Debit, Settlement, Earning & Refund
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-2.5 px-4 font-bold">Event</th>
                <th className="py-2.5 px-4 font-bold">Reference</th>
                <th className="py-2.5 px-4 font-bold">Actor</th>
                <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                <th className="py-2.5 px-4 font-bold">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-2.5 px-4 font-bold text-[#06265B]">{log.event_type.replace(/_/g, ' ')}</td>
                  <td className="py-2.5 px-4 font-mono text-[#073B8C]">{log.reference}</td>
                  <td className="py-2.5 px-4">
                    {log.actor_name || 'System'} ({log.actor_role})
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums">{formatNaira(log.amount_kobo)}</td>
                  <td className="py-2.5 px-4 text-[#64748B]">{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
