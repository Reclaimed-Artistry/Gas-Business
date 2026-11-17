import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MapPin,
  Clock,
  Star,
  Heart,
  CheckCircle2,
  AlertTriangle,
  ShoppingCart,
  ArrowLeft,
  Phone,
  ShieldCheck,
  Plus,
  Minus,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useLocationContext } from '../context/LocationContext';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatNaira } from '../lib/format';
import type { RetailerProductPublic, RetailerPublic } from '../types';

interface ReviewRow {
  id: number;
  retailer_rating: number;
  dispatcher_rating: number | null;
  comment: string;
  customer_name: string;
  created_at: string;
}

export function RetailerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { location } = useLocationContext();
  const { user } = useAuth();
  const { items, addItem, updateQuantity, subtotalKobo, retailerId: cartRetailerId } = useCart();

  const [retailer, setRetailer] = useState<RetailerPublic | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [isFavourite, setIsFavourite] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      neighbourhood: location.neighbourhood,
      city: location.city,
    });
    apiRequest<{ retailer: RetailerPublic; reviews: ReviewRow[] }>(
      `/api/public/retailers/${encodeURIComponent(id)}?${params.toString()}`
    )
      .then((res) => {
        setRetailer(res.retailer);
        setReviews(res.reviews);
      })
      .catch(() => setRetailer(null))
      .finally(() => setLoading(false));
  }, [id, location.lat, location.lng, location.neighbourhood, location.city]);

  useEffect(() => {
    if (user?.role === 'CUSTOMER' && retailer) {
      apiRequest<{ favourites: { id: number }[] }>('/api/customer/favourites')
        .then((res) => setIsFavourite(res.favourites.some((f) => f.id === retailer.id)))
        .catch(() => {});
    }
  }, [user, retailer]);

  const toggleFavourite = async () => {
    if (!retailer) return;
    if (!user || user.role !== 'CUSTOMER') {
      navigate('/login');
      return;
    }
    if (isFavourite) {
      await apiRequest(`/api/customer/favourites/${retailer.id}`, { method: 'DELETE' });
      setIsFavourite(false);
    } else {
      await apiRequest(`/api/customer/favourites/${retailer.id}`, { method: 'POST' });
      setIsFavourite(true);
    }
  };

  const handleAddProduct = (prod: RetailerProductPublic) => {
    if (!retailer) return;
    const res = addItem(
      {
        retailerId: retailer.id,
        retailerName: retailer.business_name,
        productId: prod.product_id,
        productName: prod.product_name,
        unitLabel: prod.unit_label,
        sizeKg: prod.size_kg,
        imageUrl: prod.image_url,
        sellingPriceKobo: prod.selling_price_kobo,
        maxStock: prod.stock_quantity,
      },
      1
    );
    setToast(
      res.switchedRetailer
        ? `Cart updated to ${retailer.business_name} · Added ${prod.product_name}`
        : `Added ${prod.product_name} to your cart`
    );
    setTimeout(() => setToast(''), 3000);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-sm text-[#64748B]">
        Loading verified retailer details...
      </div>
    );
  }

  if (!retailer) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-[#06265B]">Retailer Not Found or Unavailable</h2>
        <p className="text-sm text-[#64748B]">
          Only active, Operations-approved cooking gas retailers are available for ordering.
        </p>
        <Link
          to="/explore"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B8C] text-white text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Nearby Retailers
        </Link>
      </div>
    );
  }

  const categories = ['ALL', ...Array.from(new Set(retailer.products.map((p) => p.category_name)))];
  const filteredProducts =
    activeCategory === 'ALL'
      ? retailer.products
      : retailer.products.filter((p) => p.category_name === activeCategory);

  const canOrderHere = retailer.coverage.canDeliver && retailer.is_open_now;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1769C2] hover:text-[#073B8C]"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Map & Price Comparison
        </Link>
      </div>

      {/* Retailer Hero Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-4 h-56 lg:h-auto bg-[#06265B] relative">
            <img
              src={retailer.cover_image_url || '/images/depot-ewet.jpg'}
              alt={retailer.business_name}
              className="w-full h-full object-cover"
            />
            <span
              className={`absolute top-3 left-3 px-2.5 py-1 rounded-md text-xs font-bold ${
                retailer.is_open_now ? 'bg-[#ECFDF3] text-[#16834A]' : 'bg-[#FEF2F2] text-[#D64545]'
              }`}
            >
              {retailer.is_open_now ? 'Open for Delivery' : 'Currently Closed'}
            </span>
          </div>

          <div className="lg:col-span-8 p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#1769C2]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Gasflo Verified & Centrally Managed Retailer
                </div>
                <h1 className="text-2xl font-extrabold text-[#06265B] mt-1">{retailer.business_name}</h1>
                <p className="text-xs text-[#64748B] mt-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#073B8C]" />
                  <span>
                    Physical Depot: <strong className="text-[#172B4D]">{retailer.address}</strong>,{' '}
                    {retailer.neighbourhood}, {retailer.city}, {retailer.state}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => void toggleFavourite()}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-bold transition-colors ${
                  isFavourite
                    ? 'bg-[#FEF2F2] border-[#FECACA] text-[#D64545]'
                    : 'bg-white border-[#E2E8F0] text-[#172B4D] hover:border-[#073B8C]'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavourite ? 'fill-[#D64545]' : ''}`} />
                {isFavourite ? 'Saved Favourite' : 'Save Retailer'}
              </button>
            </div>

            <p className="text-sm text-[#172B4D] leading-relaxed">{retailer.description}</p>

            {/* Clearly distinguish physical location vs delivery coverage */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-3.5 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#64748B]">
                  Delivery Coverage Radius
                </div>
                <div className="font-bold text-[#06265B] mt-0.5">
                  Up to {retailer.max_delivery_radius_km} km from depot
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Areas: {retailer.coverage_areas.join(', ')}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#64748B]">
                  Operating Hours & Contact
                </div>
                <div className="font-semibold text-[#172B4D] mt-0.5">
                  Mon–Fri: {retailer.operating_hours.mon_fri || '07:00 - 20:00'}
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5 inline-flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {retailer.phone}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#64748B]">
                  Rating & Est. Delivery
                </div>
                <div className="font-bold text-[#06265B] mt-0.5 inline-flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-[#E99A25] fill-[#E99A25]" />
                  {retailer.rating_avg.toFixed(1)} ({retailer.review_count} reviews)
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> ~{retailer.coverage.estimatedDeliveryMins} mins · Fee{' '}
                  {formatNaira(retailer.coverage.deliveryFeeKobo)}
                </div>
              </div>
            </div>

            {/* Live Coverage Verification Banner */}
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-lg border text-xs ${
                retailer.coverage.canDeliver
                  ? 'bg-[#ECFDF3] border-[#BBF7D0] text-[#16834A]'
                  : 'bg-[#FEF2F2] border-[#FECACA] text-[#D64545]'
              }`}
            >
              <div className="flex items-start gap-2 font-semibold">
                {retailer.coverage.canDeliver ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div>
                  <div>
                    Delivery to <strong>{location.label}</strong>:{' '}
                    {retailer.coverage.canDeliver ? 'Verified & Covered' : 'Not Available for Ordering'}
                  </div>
                  <div className="text-[11px] opacity-90">{retailer.coverage.reason}</div>
                </div>
              </div>
              {!retailer.coverage.canDeliver && (
                <Link
                  to="/explore"
                  className="shrink-0 px-3 py-1.5 rounded-md bg-white border border-[#FECACA] text-[#D64545] font-bold"
                >
                  Find Covering Retailer
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="bg-[#06265B] text-white px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between">
          <span>{toast}</span>
          <Link to="/checkout" className="underline text-[#EAF3FF] font-bold">
            Proceed to Checkout →
          </Link>
        </div>
      )}

      {/* Products Catalogue & Sticky Cart Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-[#06265B]">Available Gas Quantities & Products</h2>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    activeCategory === cat
                      ? 'bg-[#073B8C] text-white border-[#073B8C]'
                      : 'bg-white text-[#172B4D] border-[#E2E8F0] hover:border-[#1769C2]'
                  }`}
                >
                  {cat === 'ALL' ? 'All Products' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredProducts.map((prod) => {
              const inCart =
                cartRetailerId === retailer.id ? items.find((i) => i.productId === prod.product_id) : undefined;
              const available = prod.is_available === 1 && prod.stock_quantity > 0;
              return (
                <div
                  key={prod.retailer_product_id}
                  className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex gap-3.5 hover:border-[#1769C2] transition-colors"
                >
                  <img
                    src={prod.image_url}
                    alt={prod.product_name}
                    className="w-20 h-20 rounded-lg object-contain bg-[#F7F9FC] border border-[#E2E8F0] p-1.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1769C2]">
                        {prod.category_name}
                      </span>
                      <h3 className="text-sm font-bold text-[#06265B] leading-snug">{prod.product_name}</h3>
                      <p className="text-[11px] text-[#64748B] mt-0.5 line-clamp-2">{prod.description}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-base font-extrabold text-[#073B8C] tabular-nums">
                          {formatNaira(prod.selling_price_kobo)}
                        </div>
                        <div className="text-[10px] font-semibold text-[#64748B]">
                          {available ? `${prod.stock_quantity} in stock` : 'Out of stock'}
                        </div>
                      </div>

                      {!available || !canOrderHere ? (
                        <span className="px-2.5 py-1.5 rounded-lg bg-[#F1F5F9] text-[#64748B] text-[11px] font-bold">
                          {!available ? 'Unavailable' : 'Out of Area'}
                        </span>
                      ) : inCart ? (
                        <div className="inline-flex items-center gap-1.5 border border-[#073B8C] rounded-lg p-0.5 bg-[#EAF3FF]">
                          <button
                            type="button"
                            onClick={() => updateQuantity(prod.product_id, inCart.quantity - 1)}
                            className="p-1 rounded bg-white text-[#073B8C]"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2 text-xs font-extrabold text-[#06265B] tabular-nums">
                            {inCart.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(prod.product_id, inCart.quantity + 1)}
                            className="p-1 rounded bg-[#073B8C] text-white"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddProduct(prod)}
                          className="px-3 py-1.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold transition-colors"
                        >
                          Add to Cart
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sticky Order Summary Sidebar */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#06265B] inline-flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4 text-[#073B8C]" />
                Your Order Summary
              </h3>
              <span className="text-[11px] font-bold text-[#16834A]">Cashless Only</span>
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-[#64748B] py-4 text-center">
                Select any gas quantity or accessory to begin your order.
              </p>
            ) : (
              <>
                <div className="divide-y divide-[#F1F5F9] text-xs">
                  {items.map((item) => (
                    <div key={item.productId} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-[#172B4D]">{item.productName}</div>
                        <div className="text-[#64748B]">
                          {item.quantity} × {formatNaira(item.sellingPriceKobo)}
                        </div>
                      </div>
                      <div className="font-bold text-[#06265B] tabular-nums">
                        {formatNaira(item.sellingPriceKobo * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-[#E2E8F0] pt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-[#64748B]">
                    <span>Items Subtotal</span>
                    <span className="font-semibold text-[#172B4D] tabular-nums">{formatNaira(subtotalKobo)}</span>
                  </div>
                  <div className="flex justify-between text-[#64748B]">
                    <span>Est. Delivery Fee</span>
                    <span className="font-semibold text-[#172B4D] tabular-nums">
                      {formatNaira(retailer.coverage.deliveryFeeKobo)}
                    </span>
                  </div>
                </div>

                <Link
                  to="/checkout"
                  className="block w-full text-center py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-extrabold transition-colors"
                >
                  Review & Pay Electronically →
                </Link>
              </>
            )}
          </div>

          {/* Reviews Card */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#06265B]">Verified Customer Reviews ({reviews.length})</h3>
            {reviews.length === 0 ? (
              <p className="text-xs text-[#64748B]">No customer reviews yet for this depot.</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {reviews.map((rv) => (
                  <div key={rv.id} className="border-b border-[#F1F5F9] last:border-none pb-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#06265B]">{rv.customer_name}</span>
                      <span className="inline-flex items-center gap-0.5 text-[#E99A25] font-bold">
                        <Star className="w-3 h-3 fill-[#E99A25]" /> {rv.retailer_rating}.0
                      </span>
                    </div>
                    {rv.comment && <p className="text-xs text-[#64748B] mt-1">{rv.comment}</p>}
                    <div className="text-[10px] text-[#94A3B8] mt-1">{formatDateTime(rv.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
