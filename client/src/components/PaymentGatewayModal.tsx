import React, { useState } from 'react';
import { ShieldCheck, CreditCard, Building2, Smartphone, X, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatNaira } from '../lib/format';

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

export function PaymentGatewayModal({
  session,
  customerEmail,
  onClose,
  onSuccess,
  onFailure,
}: PaymentGatewayModalProps) {
  const [cardNumber, setCardNumber] = useState('5061 0512 4081 8812');
  const [expiry, setExpiry] = useState('09/28');
  const [cvv, setCvv] = useState('408');
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [verifiedDone, setVerifiedDone] = useState(false);

  const runVerification = async (outcome: 'SUCCESS' | 'FAILED') => {
    setVerifying(true);
    setErrorMsg('');
    try {
      const result = await apiRequest<{
        verified: boolean;
        reference: string;
        walletBalanceKobo?: number;
        orderId?: number | null;
        orderReference?: string;
        message: string;
      }>('/api/payments/verify', {
        method: 'POST',
        body: {
          reference: session.reference,
          simulatedOutcome: outcome,
          paymentChannelDetails: {
            channel: session.channel,
            last4: cardNumber.replace(/\s+/g, '').slice(-4),
          },
        },
      });
      if (result.verified) {
        setVerifiedDone(true);
        setTimeout(() => {
          onSuccess(result);
        }, 700);
      }
    } catch (err) {
      const msg = (err as Error).message || 'Electronic payment verification failed.';
      setErrorMsg(msg);
      onFailure?.(msg);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#06265B]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-[#06265B] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#EAF3FF]/80">
              <Lock className="w-3 h-3" />
              {session.provider} Secured Checkout · Server-Verified
            </div>
            <div className="text-lg font-extrabold tabular-nums mt-0.5">{formatNaira(session.amountKobo)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={verifying}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
            aria-label="Close gateway modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg px-3.5 py-2.5 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-[#64748B]">Customer</span>
              <span className="font-semibold text-[#172B4D]">{customerEmail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#64748B]">Transaction Ref</span>
              <span className="font-mono font-semibold text-[#073B8C]">{session.reference}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#64748B]">Purpose</span>
              <span className="font-semibold text-[#172B4D]">
                {session.purpose === 'WALLET_FUNDING' ? 'Digital Wallet Funding' : 'Direct Order Payment'}
              </span>
            </div>
          </div>

          {verifiedDone ? (
            <div className="py-8 text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-[#16834A] mx-auto" />
              <h4 className="text-base font-bold text-[#06265B]">Server Verification Confirmed</h4>
              <p className="text-xs text-[#64748B]">
                Your electronic payment has been independently verified and logged to the ledger.
              </p>
            </div>
          ) : (
            <>
              {session.channel === 'CARD' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#06265B]">
                    <CreditCard className="w-4 h-4 text-[#073B8C]" />
                    Nigerian Debit / Credit Card (Verve, Mastercard, Visa)
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Card Number</label>
                    <input
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Expiry</label>
                      <input
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#64748B] mb-1">CVV</label>
                      <input
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {session.channel === 'BANK_TRANSFER' && (
                <div className="bg-[#EAF3FF] border border-[#BFDBFE] rounded-lg p-3.5 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-[#073B8C]">
                    <Building2 className="w-4 h-4" />
                    Instant Bank Transfer Account
                  </div>
                  <p className="text-[#172B4D]">
                    Transfer exact amount <strong className="tabular-nums">{formatNaira(session.amountKobo)}</strong> to:
                  </p>
                  <div className="bg-white rounded-md p-2.5 border border-[#BFDBFE] font-mono space-y-1">
                    <div>Bank: Wema Bank / {session.provider} Checkout</div>
                    <div>Account No: 9930148205</div>
                    <div>Account Name: Gasflo Energy NG</div>
                  </div>
                </div>
              )}

              {session.channel === 'USSD' && (
                <div className="bg-[#EAF3FF] border border-[#BFDBFE] rounded-lg p-3.5 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-[#073B8C]">
                    <Smartphone className="w-4 h-4" />
                    Bank USSD Authorization
                  </div>
                  <p className="text-[#172B4D]">
                    Dial <span className="font-mono font-bold text-[#06265B]">*737*000*{session.reference.slice(-4)}#</span> on your mobile phone and click verify below.
                  </p>
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#D64545]">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => void runVerification('SUCCESS')}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-sm font-bold transition-colors disabled:opacity-60"
                >
                  {verifying
                    ? 'Verifying with Server...'
                    : `Authorize & Verify ${formatNaira(session.amountKobo)}`}
                </button>
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => void runVerification('FAILED')}
                  className="w-full py-2 px-4 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#D64545] hover:border-[#FECACA] text-xs font-semibold transition-colors disabled:opacity-60"
                >
                  Simulate Declined / Failed Payment (Security Test)
                </button>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#64748B] pt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#16834A]" />
                <span>Backend independently verifies payment before crediting wallet or confirming orders.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
