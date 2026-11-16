export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || Number.isNaN(kobo)) return '₦0';
  const naira = Math.round(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    AWAITING_PAYMENT: 'Awaiting Payment',
    PAYMENT_CONFIRMED: 'Payment Confirmed',
    ORDER_RECEIVED: 'Order Received',
    AWAITING_DISPATCHER_ASSIGNMENT: 'Awaiting Dispatcher',
    ASSIGNED_TO_DISPATCHER: 'Assigned to Dispatcher',
    ACCEPTED_BY_DISPATCHER: 'Accepted by Dispatcher',
    AWAITING_COLLECTION: 'Awaiting Collection',
    COLLECTED_FROM_RETAILER: 'Collected from Retailer',
    IN_TRANSIT: 'In Transit',
    DELIVERED: 'Delivered',
    DELIVERY_FAILED: 'Delivery Failed',
    CANCELLED: 'Cancelled',
    REFUND_PROCESSING: 'Refund Processing',
    REFUNDED: 'Refunded',
    APPROVED_ACTIVE: 'Approved & Active',
    PENDING_APPROVAL: 'Pending Approval',
    INACTIVE: 'Inactive',
    SUSPENDED: 'Suspended',
    ONLINE: 'Online',
    BUSY: 'On Delivery',
    OFFLINE: 'Offline',
    PAID: 'Paid',
    APPROVED: 'Approved',
    PENDING: 'Pending',
    SUCCESS: 'Success',
    VERIFIED_SUCCESS: 'Verified',
    FAILED: 'Failed',
    COMPLETED: 'Completed',
    REQUESTED: 'Requested',
    OPEN: 'Open',
    IN_REVIEW: 'In Review',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  };
  return map[status] || status.replace(/_/g, ' ');
}

export function getStatusClasses(status: string): string {
  switch (status) {
    case 'DELIVERED':
    case 'APPROVED_ACTIVE':
    case 'PAID':
    case 'SUCCESS':
    case 'VERIFIED_SUCCESS':
    case 'COMPLETED':
    case 'ONLINE':
    case 'RESOLVED':
    case 'ACTIVE':
      return 'bg-[#ECFDF3] text-[#16834A] border-[#BBF7D0]';
    case 'IN_TRANSIT':
    case 'COLLECTED_FROM_RETAILER':
    case 'ACCEPTED_BY_DISPATCHER':
    case 'ASSIGNED_TO_DISPATCHER':
    case 'AWAITING_COLLECTION':
    case 'PAYMENT_CONFIRMED':
    case 'ORDER_RECEIVED':
    case 'APPROVED':
    case 'IN_REVIEW':
      return 'bg-[#EAF3FF] text-[#073B8C] border-[#BFDBFE]';
    case 'AWAITING_PAYMENT':
    case 'AWAITING_DISPATCHER_ASSIGNMENT':
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'REFUND_PROCESSING':
    case 'REQUESTED':
    case 'BUSY':
    case 'OPEN':
      return 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]';
    case 'DELIVERY_FAILED':
    case 'CANCELLED':
    case 'FAILED':
    case 'SUSPENDED':
    case 'REJECTED':
    case 'REVERSED':
      return 'bg-[#FEF2F2] text-[#D64545] border-[#FECACA]';
    case 'REFUNDED':
      return 'bg-[#F0F9FF] text-[#1769C2] border-[#BAE6FD]';
    default:
      return 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]';
  }
}

export const ORDER_PROGRESS_STEPS = [
  { key: 'PAYMENT_CONFIRMED', label: 'Paid' },
  { key: 'AWAITING_DISPATCHER_ASSIGNMENT', label: 'Dispatching' },
  { key: 'ACCEPTED_BY_DISPATCHER', label: 'Accepted' },
  { key: 'COLLECTED_FROM_RETAILER', label: 'Collected' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
  { key: 'DELIVERED', label: 'Delivered' },
];

export function getOrderStepIndex(status: string): number {
  const map: Record<string, number> = {
    AWAITING_PAYMENT: -1,
    PAYMENT_CONFIRMED: 0,
    ORDER_RECEIVED: 0,
    AWAITING_DISPATCHER_ASSIGNMENT: 1,
    ASSIGNED_TO_DISPATCHER: 1,
    ACCEPTED_BY_DISPATCHER: 2,
    AWAITING_COLLECTION: 2,
    COLLECTED_FROM_RETAILER: 3,
    IN_TRANSIT: 4,
    DELIVERED: 5,
  };
  return map[status] ?? -1;
}
