import React from 'react';

export interface GatewaySession {
  reference: string;
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  channel: 'CARD' | 'BANK_TRANSFER' | 'USSD';
  amountKobo: number;
  purpose: 'WALLET_FUNDING' | 'ORDER_PAYMENT';
  mode?: string;
}

interface PaymentGatewayModalProps {
  session: GatewaySession;
  customerEmail: string;
  onClose: () => void;
  onSuccess: (result: {
    reference: string;
    walletBalanceKobo?: number;
    orderId?: number | null;
    orderReference?: string;
  }) => void;
  onFailure?: (message: string) => void;
}

export function PaymentGatewayModal({ onClose }: PaymentGatewayModalProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Payment unavailable" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-md space-y-4">
        <h2 className="font-bold text-lg">Payment temporarily unavailable</h2>
        <p>Online payments and wallet funding are not available yet. Please do not send money or enter card details.</p>
        <button type="button" onClick={onClose} className="rounded-lg bg-[#073B8C] text-white px-4 py-2">Close</button>
      </div>
    </div>
  );
}
