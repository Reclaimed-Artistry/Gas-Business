export type UserRole = 'CUSTOMER' | 'DISPATCHER' | 'ADMIN';

export interface User {
  id: number;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  avatar_url?: string | null;
}

export interface DispatcherProfile {
  id: number;
  user_id: number;
  vehicle_type: string;
  plate_number: string;
  license_number: string;
  zone: string;
  availability_status: 'ONLINE' | 'BUSY' | 'OFFLINE';
  current_lat: number;
  current_lng: number;
  location_tracking_enabled: number;
  location_updated_at?: string | null;
  compensation_model: string;
  base_rate_kobo: number;
  per_km_rate_kobo: number;
  rating_avg: number;
  completed_deliveries_count: number;
}

export interface DeliveryLocation {
  label: string;
  addressLine: string;
  neighbourhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  deliveryInstructions?: string;
}

export interface RetailerCoverage {
  canDeliver: boolean;
  distanceKm: number;
  reason: string;
  matchedArea?: string;
  deliveryFeeKobo: number;
  estimatedDeliveryMins: number;
}

export interface RetailerProductPublic {
  retailer_product_id: number;
  retailer_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  category_name: string;
  category_type: 'GAS_REFILL' | 'CYLINDER' | 'ACCESSORY';
  size_kg: number | null;
  unit_label: string;
  description: string;
  image_url: string;
  selling_price_kobo: number;
  stock_quantity: number;
  is_available: number;
}

export interface RetailerPublic {
  id: number;
  business_name: string;
  slug: string;
  phone: string;
  address: string;
  neighbourhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  logo_url: string;
  cover_image_url: string;
  description: string;
  operating_hours: Record<string, string>;
  is_open_now: boolean;
  max_delivery_radius_km: number;
  coverage_areas: string[];
  base_delivery_fee_kobo: number;
  per_km_delivery_fee_kobo: number;
  estimated_prep_mins: number;
  rating_avg: number;
  review_count: number;
  featured: boolean;
  coverage: RetailerCoverage;
  highlights: {
    price_5kg_kobo: number | null;
    price_6kg_kobo: number | null;
    price_12_5kg_kobo: number | null;
    min_refill_price_kobo: number | null;
    available_product_count: number;
  };
  products: RetailerProductPublic[];
}

export interface CartItem {
  retailerId: number;
  retailerName: string;
  productId: number;
  productName: string;
  unitLabel: string;
  sizeKg: number | null;
  imageUrl: string;
  sellingPriceKobo: number;
  quantity: number;
  maxStock: number;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  role_scope: UserRole;
  title: string;
  message: string;
  type: string;
  channels_json: string;
  related_order_id?: number | null;
  is_read: number;
  created_at: string;
}

export interface OrderTimelineEntry {
  id: number;
  from_status: string | null;
  to_status: string;
  changed_by_role: string;
  note: string;
  created_at: string;
}

export interface OrderItemRow {
  id: number;
  product_id?: number;
  product_name: string;
  size_kg: number | null;
  quantity: number;
  unit_price_kobo?: number;
  line_total_kobo?: number;
}

export interface CustomerOrder {
  id: number;
  order_reference: string;
  retailer_id: number;
  retailer_name: string;
  retailer_address: string;
  retailer_phone: string;
  retailer_lat: number;
  retailer_lng: number;
  dispatcher_id: number | null;
  dispatcher_name: string | null;
  dispatcher_phone: string | null;
  dispatcher_vehicle: string | null;
  dispatcher_plate: string | null;
  dispatcher_rating: number | null;
  dispatcher_lat: number | null;
  dispatcher_lng: number | null;
  liveTrackingActive: boolean;
  status: string;
  payment_method: 'WALLET' | 'DIRECT_ONLINE';
  payment_status: string;
  payment_reference: string | null;
  gateway_provider: string | null;
  delivery_address: string;
  delivery_neighbourhood: string;
  delivery_city: string;
  delivery_state: string;
  delivery_lat: number;
  delivery_lng: number;
  delivery_instructions: string;
  distance_km: number;
  estimated_delivery_mins: number;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  discount_kobo: number;
  promo_code: string | null;
  total_amount_kobo: number;
  delivery_confirmation_code: string;
  proof_of_delivery_note: string;
  failure_reason: string;
  failure_notes: string;
  has_review?: number;
  created_at: string;
  delivered_at?: string | null;
  items: OrderItemRow[];
  timeline: OrderTimelineEntry[];
}
