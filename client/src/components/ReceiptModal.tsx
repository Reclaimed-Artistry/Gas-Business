import React from 'react';
import { Printer, X, CheckCircle2, ShieldCheck } from 'lucide-react';
import { formatDateTime, formatNaira } from '../lib/format';
import { BrandLogo } from './BrandLogo';

export interface ElectronicReceipt {
  receiptNumber: string;
  orderReference: string;
  paymentReference: string;
  paymentMethod: string;
  gatewayProvider?: string | null;
  paymentStatus: string;
  issuedAt: string;
  customer: { name: string; email: string; phone: string };
  retailer: { name: string; address: string; phone: string };
  deliveryAddress: string;
  subtotalKobo: number;
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  discountKobo: number;
  totalAmountKobo: number;
  cashlessStatement: string;
  items: { product_name: string; quantity: number; unit_price_kobo: number; line_total_kobo: number }[];
}

export function ReceiptModal({
  receipt,
  onClose,
}: {
  receipt: ElectronicReceipt;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#06265B]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F7F9FC] no-print">
          <h3 className="text-sm font-bold text-[#06265B]">Electronic Payment Receipt</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B8C] text-white text-xs font-bold hover:bg-[#06265B]"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Receipt
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#172B4D]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
            <BrandLogo />
            <div className="text-right">
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#ECFDF3] border border-[#BBF7D0] text-[#16834A] text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {receipt.paymentStatus}
              </div>
              <div className="text-xs font-mono font-bold text-[#06265B] mt-1.5">{receipt.receiptNumber}</div>
              <div className="text-[11px] text-[#64748B]">{formatDateTime(receipt.issuedAt)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Billed To</div>
              <div className="font-bold text-[#06265B]">{receipt.customer.name}</div>
              <div className="text-[#64748B]">{receipt.customer.email}</div>
              <div className="text-[#64748B]">{receipt.customer.phone}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Fulfilling Retailer</div>
              <div className="font-bold text-[#06265B]">{receipt.retailer.name}</div>
              <div className="text-[#64748B]">{receipt.retailer.address}</div>
              <div className="text-[#64748B]">{receipt.retailer.phone}</div>
            </div>
          </div>

          <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg p-3 text-xs space-y-1">
            <div>
              <span className="text-[#64748B]">Order Ref: </span>
              <span className="font-mono font-bold text-[#06265B]">{receipt.orderReference}</span>
            </div>
            <div>
              <span className="text-[#64748B]">Payment Ref: </span>
              <span className="font-mono font-semibold text-[#073B8C]">{receipt.paymentReference}</span>
            </div>
            <div>
              <span className="text-[#64748B]">Payment Method: </span>
              <span className="font-semibold text-[#172B4D]">
                {receipt.paymentMethod === 'WALLET'
                  ? 'BlueFlame Digital Wallet'
                  : `Direct Online (${receipt.gatewayProvider || 'Gateway'})`}
              </span>
            </div>
            <div>
              <span className="text-[#64748B]">Delivery Address: </span>
              <span className="font-medium text-[#172B4D]">{receipt.deliveryAddress}</span>
            </div>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[#64748B] text-left">
                <th className="py-2 font-semibold">Item</th>
                <th className="py-2 font-semibold text-center">Qty</th>
                <th className="py-2 font-semibold text-right">Unit Price</th>
                <th className="py-2 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {receipt.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-2.5 font-semibold text-[#172B4D]">{item.product_name}</td>
                  <td className="py-2.5 text-center tabular-nums">{item.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums text-[#64748B]">{formatNaira(item.unit_price_kobo)}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-[#172B4D]">
                    {formatNaira(item.line_total_kobo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-[#E2E8F0] pt-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-[#64748B]">
              <span>Products Subtotal</span>
              <span className="tabular-nums font-medium text-[#172B4D]">{formatNaira(receipt.subtotalKobo)}</span>
            </div>
            <div className="flex justify-between text-[#64748B]">
              <span>Delivery Fee</span>
              <span className="tabular-nums font-medium text-[#172B4D]">{formatNaira(receipt.deliveryFeeKobo)}</span>
            </div>
            <div className="flex justify-between text-[#64748B]">
              <span>Platform Service Fee</span>
              <span className="tabular-nums font-medium text-[#172B4D]">{formatNaira(receipt.serviceFeeKobo)}</span>
            </div>
            {receipt.discountKobo > 0 && (
              <div className="flex justify-between text-[#16834A]">
                <span>Promotion Discount</span>
                <span className="tabular-nums font-semibold">-{formatNaira(receipt.discountKobo)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-[#E2E8F0] text-sm font-extrabold text-[#06265B]">
              <span>Total Paid</span>
              <span className="tabular-nums">{formatNaira(receipt.totalAmountKobo)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-xs font-semibold text-[#073B8C]">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{receipt.cashlessStatement}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
