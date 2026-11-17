import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Map as MapIcon,
  List,
  Scale,
  Search,
  MapPin,
  LocateFixed,
  Star,
  Clock,
  CheckCircle2,
  XCircle,
  Crosshair,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useLocationContext } from '../context/LocationContext';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';
import { formatNaira } from '../lib/format';
import { RetailerMap } from '../components/RetailerMap';
import type { RetailerPublic } from '../types';

interface ComparisonRow {
  retailerId: number;
  retailerSlug: string;
  businessName: string;
  address: string;
  neighbourhood: string;
  city: string;
  state: string;
  isOpenNow: boolean;
  ratingAvg: number;
  reviewCount: number;
  canDeliver: boolean;
  coverageReason: string;
  distanceKm: number;
  estimatedDeliveryMins: number;
  product: {
    retailerProductId: number;
    productId: number;
    name: string;
    unitLabel: string;
    sellingPriceKobo: number;
    stockQuantity: number;
    isAvailable: boolean;
  };
  deliveryFeeKobo: number;
  serviceFeeKobo: number;
  landedTotalKobo: number;
}

const GAS_SIZES = [1, 2, 3, 5, 6, 12.5, 25, 50];

export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { location, setLocation, setCoordinates, detectGpsLocation, locating } = useLocationContext();

  const initialView = (searchParams.get('view') as 'map' | 'list' | 'compare') || 'map';
  const [viewMode, setViewMode] = useState<'map' | 'list' | 'compare'>(initialView);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [sizeKg, setSizeKg] = useState<string>(searchParams.get('sizeKg') || '');
  const [sortBy, setSortBy] = useState('nearest');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [openOnly, setOpenOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [deliverableOnly, setDeliverableOnly] = useState(false);
  const [maxEta, setMaxEta] = useState('');
  const [pickOnMapMode, setPickOnMapMode] = useState(false);
  const [filterByMapBounds, setFilterByMapBounds] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);

  const [retailers, setRetailers] = useState<RetailerPublic[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Price Comparison state
  const [compareSizeKg, setCompareSizeKg] = useState<number>(Number(searchParams.get('sizeKg')) || 12.5);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const fetchRetailers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(location.lat),
        lng: String(location.lng),
        neighbourhood: location.neighbourhood,
        city: location.city,
        state: stateFilter,
        sortBy,
        openOnly: String(openOnly),
        inStockOnly: String(inStockOnly),
        deliverableOnly: String(deliverableOnly),
      });
      if (search.trim()) params.set('search', search.trim());
      if (sizeKg) params.set('sizeKg', sizeKg);
      if (maxEta) params.set('maxEta', maxEta);
      if (filterByMapBounds && mapBounds) {
        params.set('north', String(mapBounds.north));
        params.set('south', String(mapBounds.south));
        params.set('east', String(mapBounds.east));
        params.set('west', String(mapBounds.west));
      }
      const res = await apiRequest<{ retailers: RetailerPublic[] }>(`/api/public/retailers?${params.toString()}`);
      setRetailers(res.retailers);
    } finally {
      setLoading(false);
    }
  }, [
    location.lat,
    location.lng,
    location.neighbourhood,
    location.city,
    stateFilter,
    sortBy,
    openOnly,
    inStockOnly,
    deliverableOnly,
    search,
    sizeKg,
    maxEta,
    filterByMapBounds,
    mapBounds,
  ]);

  const fetchComparison = useCallback(async () => {
    setLoadingCompare(true);
    try {
      const params = new URLSearchParams({
        lat: String(location.lat),
        lng: String(location.lng),
        neighbourhood: location.neighbourhood,
        city: location.city,
        sizeKg: String(compareSizeKg),
      });
      const res = await apiRequest<{ comparison: ComparisonRow[] }>(`/api/public/compare?${params.toString()}`);
      setComparisonRows(res.comparison);
    } finally {
      setLoadingCompare(false);
    }
  }, [location.lat, location.lng, location.neighbourhood, location.city, compareSizeKg]);

  useEffect(() => {
    void fetchRetailers();
  }, [fetchRetailers]);

  useEffect(() => {
    if (viewMode === 'compare') {
      void fetchComparison();
    }
  }, [viewMode, fetchComparison]);

  const switchView = (v: 'map' | 'list' | 'compare') => {
    setViewMode(v);
    const next = new URLSearchParams(searchParams);
    next.set('view', v);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      {/* Header & View Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#06265B]">
            Discover Cooking Gas Retailers & Compare Prices
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Showing Operations-approved retailers for <strong className="text-[#073B8C]">{location.label}</strong>
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-1 self-start">
          <button
            type="button"
            onClick={() => switchView('map')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold transition-colors ${
              viewMode === 'map' ? 'bg-[#073B8C] text-white' : 'text-[#172B4D] hover:bg-[#F7F9FC]'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Map View
          </button>
          <button
            type="button"
            onClick={() => switchView('list')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold transition-colors ${
              viewMode === 'list' ? 'bg-[#073B8C] text-white' : 'text-[#172B4D] hover:bg-[#F7F9FC]'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            List View
          </button>
          <button
            type="button"
            onClick={() => switchView('compare')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold transition-colors ${
              viewMode === 'compare' ? 'bg-[#073B8C] text-white' : 'text-[#172B4D] hover:bg-[#F7F9FC]'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Price Comparison
          </button>
        </div>
      </div>

      {/* Location & Filter Toolbar */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Location Preset */}
          <div className="md:col-span-4">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
              Delivery Address / Area
            </label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <MapPin className="w-3.5 h-3.5 text-[#073B8C] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <select
                  value={
                    NIGERIAN_PRESET_LOCATIONS.some((p) => p.label === location.label) ? location.label : '__custom__'
                  }
                  onChange={(e) => {
                    const f = NIGERIAN_PRESET_LOCATIONS.find((p) => p.label === e.target.value);
                    if (f) setLocation(f);
                  }}
                  className="w-full pl-8 pr-2 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-[#F7F9FC] text-[#06265B]"
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
              <button
                type="button"
                onClick={() => void detectGpsLocation()}
                disabled={locating}
                title="Use GPS Location"
                className="px-2.5 py-2 rounded-lg bg-[#EAF3FF] text-[#073B8C] hover:bg-[#dbeafe]"
              >
                <LocateFixed className="w-4 h-4" />
              </button>
              {viewMode === 'map' && (
                <button
                  type="button"
                  onClick={() => setPickOnMapMode((m) => !m)}
                  title="Click map to pin delivery address"
                  className={`px-2.5 py-2 rounded-lg border text-xs font-bold inline-flex items-center gap-1 ${
                    pickOnMapMode
                      ? 'bg-[#16834A] text-white border-[#16834A]'
                      : 'bg-white text-[#073B8C] border-[#E2E8F0] hover:border-[#073B8C]'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">Pin</span>
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="md:col-span-4">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
              Search Retailer, Product, City or Street
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. Ewet Housing, Oron Rd, 12.5kg, regulator..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
              />
            </div>
          </div>

          {/* Sort By */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-white text-[#172B4D]"
            >
              <option value="nearest">Nearest Location</option>
              <option value="lowest_price">Lowest Product Price</option>
              <option value="lowest_delivery">Lowest Delivery Fee</option>
              <option value="highest_rated">Highest Rated</option>
              <option value="fastest">Fastest Delivery ETA</option>
            </select>
          </div>

          {/* Gas Quantity */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
              Gas Quantity
            </label>
            <select
              value={sizeKg}
              onChange={(e) => setSizeKg(e.target.value)}
              className="w-full px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-white text-[#172B4D]"
            >
              <option value="">All Quantities</option>
              {GAS_SIZES.map((sz) => (
                <option key={sz} value={String(sz)}>
                  {sz}kg Refill
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Secondary Filter Chips */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#F1F5F9] text-xs">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F7F9FC] text-xs font-semibold text-[#172B4D]"
          >
            <option value="ALL">All Active Regions (Uyo Focus)</option>
            <option value="Akwa Ibom">Akwa Ibom State (Uyo)</option>
          </select>

          <select
            value={maxEta}
            onChange={(e) => setMaxEta(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F7F9FC] text-xs font-semibold text-[#172B4D]"
          >
            <option value="">Any Delivery Time</option>
            <option value="30">Under 30 mins</option>
            <option value="45">Under 45 mins</option>
            <option value="60">Under 60 mins</option>
          </select>

          <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-[#172B4D]">
            <input
              type="checkbox"
              checked={deliverableOnly}
              onChange={(e) => setDeliverableOnly(e.target.checked)}
              className="rounded border-[#CBD5E1] text-[#073B8C]"
            />
            Covers My Address Only
          </label>

          <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-[#172B4D]">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="rounded border-[#CBD5E1] text-[#073B8C]"
            />
            Open Now
          </label>

          <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-[#172B4D]">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="rounded border-[#CBD5E1] text-[#073B8C]"
            />
            In Stock
          </label>

          {viewMode === 'map' && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-[#1769C2]">
              <input
                type="checkbox"
                checked={filterByMapBounds}
                onChange={(e) => setFilterByMapBounds(e.target.checked)}
                className="rounded border-[#CBD5E1] text-[#073B8C]"
              />
              Auto-filter as map moves
            </label>
          )}
        </div>
      </div>

      {/* VIEW 1: INTERACTIVE MAP + SIDE LIST */}
      {viewMode === 'map' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 xl:col-span-8">
            <RetailerMap
              retailers={retailers}
              customerLocation={location}
              selectedRetailerId={selectedRetailerId}
              onSelectRetailer={(r) => setSelectedRetailerId(r.id)}
              onOpenRetailer={(r) => navigate(`/retailers/${r.slug}`)}
              onPickLocation={(lat, lng) => {
                setCoordinates(lat, lng);
                setPickOnMapMode(false);
              }}
              onBoundsChange={(b) => {
                if (filterByMapBounds) setMapBounds(b);
              }}
              enablePickMode={pickOnMapMode}
              heightClass="h-[540px]"
            />
          </div>

          <div className="lg:col-span-5 xl:col-span-4 bg-white border border-[#E2E8F0] rounded-xl flex flex-col max-h-[540px]">
            <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between">
              <span className="text-xs font-bold text-[#06265B]">
                {loading ? 'Updating retailers...' : `${retailers.length} Approved Retailer${retailers.length === 1 ? '' : 's'}`}
              </span>
              <button
                type="button"
                onClick={() => void fetchRetailers()}
                className="text-xs font-semibold text-[#1769C2] inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-[#E2E8F0] flex-1">
              {retailers.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#64748B]">
                  No retailers matched your filters. Try expanding your area or disabling &ldquo;Covers My Address Only&rdquo;.
                </div>
              ) : (
                retailers.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRetailerId(r.id)}
                    className={`p-4 cursor-pointer transition-colors ${
                      selectedRetailerId === r.id ? 'bg-[#EAF3FF]/60' : 'hover:bg-[#F7F9FC]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-[#06265B]">{r.business_name}</h3>
                        <p className="text-xs text-[#64748B] mt-0.5">{r.address}</p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                          r.is_open_now ? 'bg-[#ECFDF3] text-[#16834A]' : 'bg-[#FEF2F2] text-[#D64545]'
                        }`}
                      >
                        {r.is_open_now ? 'Open' : 'Closed'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg p-2">
                      <div>
                        <div className="text-[10px] text-[#64748B]">5kg</div>
                        <div className="font-bold text-[#073B8C] tabular-nums">
                          {r.highlights.price_5kg_kobo ? formatNaira(r.highlights.price_5kg_kobo) : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[#64748B]">12.5kg</div>
                        <div className="font-bold text-[#073B8C] tabular-nums">
                          {r.highlights.price_12_5kg_kobo ? formatNaira(r.highlights.price_12_5kg_kobo) : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[#64748B]">Delivery</div>
                        <div className="font-bold text-[#172B4D] tabular-nums">
                          {formatNaira(r.coverage.deliveryFeeKobo)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          r.coverage.canDeliver ? 'text-[#16834A]' : 'text-[#D64545]'
                        }`}
                      >
                        {r.coverage.canDeliver ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Delivers ({r.coverage.distanceKm.toFixed(1)} km · ~{r.coverage.estimatedDeliveryMins}m)
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            Outside coverage ({r.coverage.distanceKm.toFixed(1)} km)
                          </>
                        )}
                      </span>
                      <Link
                        to={`/retailers/${r.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-bold text-[#073B8C] hover:underline"
                      >
                        View Products →
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: FULL LIST VIEW */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {retailers.map((r) => (
            <div key={r.id} className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden flex flex-col">
              <div className="relative h-40 bg-[#06265B]">
                <img
                  src={r.cover_image_url || '/images/depot-ewet.jpg'}
                  alt={r.business_name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2.5 left-2.5 flex gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      r.coverage.canDeliver ? 'bg-[#ECFDF3] text-[#16834A]' : 'bg-[#FEF2F2] text-[#D64545]'
                    }`}
                  >
                    {r.coverage.canDeliver ? 'Delivers to You' : 'Outside Delivery Area'}
                  </span>
                </div>
                <span
                  className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    r.is_open_now ? 'bg-white text-[#16834A]' : 'bg-[#FEF2F2] text-[#D64545]'
                  }`}
                >
                  {r.is_open_now ? 'Open' : 'Closed'}
                </span>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-[#06265B]">{r.business_name}</h3>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#172B4D]">
                      <Star className="w-3.5 h-3.5 text-[#E99A25] fill-[#E99A25]" />
                      {r.rating_avg.toFixed(1)} ({r.review_count})
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-1">
                    {r.address}, {r.neighbourhood}, {r.city}
                  </p>
                  <p className="text-[11px] text-[#64748B] mt-1">
                    Serves: {r.coverage_areas.slice(0, 4).join(', ')} (max {r.max_delivery_radius_km} km)
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-2 bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg p-2.5 text-xs">
                    <div>
                      <div className="text-[10px] text-[#64748B]">5kg Refill</div>
                      <div className="font-bold text-[#073B8C] tabular-nums">
                        {r.highlights.price_5kg_kobo ? formatNaira(r.highlights.price_5kg_kobo) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#64748B]">12.5kg Refill</div>
                      <div className="font-bold text-[#073B8C] tabular-nums">
                        {r.highlights.price_12_5kg_kobo ? formatNaira(r.highlights.price_12_5kg_kobo) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#64748B]">Delivery</div>
                      <div className="font-bold text-[#172B4D] tabular-nums">
                        {formatNaira(r.coverage.deliveryFeeKobo)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-[#64748B]">
                    <span>{r.coverage.distanceKm.toFixed(1)} km from pin</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> ~{r.coverage.estimatedDeliveryMins} mins
                    </span>
                  </div>
                  <Link
                    to={`/retailers/${r.slug}`}
                    className={`block w-full text-center py-2.5 rounded-lg text-xs font-bold transition-colors ${
                      r.coverage.canDeliver
                        ? 'bg-[#073B8C] hover:bg-[#06265B] text-white'
                        : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
                    }`}
                  >
                    {r.coverage.canDeliver ? 'View Products & Order' : 'Inspect Retailer Catalogue'}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW 3: SIDE-BY-SIDE PRICE COMPARISON MATRIX */}
      {viewMode === 'compare' && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F7F9FC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#06265B]">
                Compare Landed Cooking Gas Prices for {location.neighbourhood}
              </h2>
              <p className="text-xs text-[#64748B]">
                Ranked by lowest total cost (Verified Retailer Price + Distance Delivery Fee + Service Fee).
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GAS_SIZES.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setCompareSizeKg(sz)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    compareSizeKg === sz
                      ? 'bg-[#073B8C] text-white border-[#073B8C]'
                      : 'bg-white text-[#172B4D] border-[#E2E8F0] hover:border-[#1769C2]'
                  }`}
                >
                  {sz}kg
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                  <th className="py-3 px-4 font-bold">Retailer & Location</th>
                  <th className="py-3 px-4 font-bold">Coverage</th>
                  <th className="py-3 px-4 font-bold text-right">{compareSizeKg}kg Price</th>
                  <th className="py-3 px-4 font-bold text-right">Delivery Fee</th>
                  <th className="py-3 px-4 font-bold text-right">Service Fee</th>
                  <th className="py-3 px-4 font-bold text-right">Total Landed Cost</th>
                  <th className="py-3 px-4 font-bold text-center">Est. ETA</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {loadingCompare ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[#64748B]">
                      Comparing verified retailer rates...
                    </td>
                  </tr>
                ) : (
                  comparisonRows.map((row, idx) => (
                    <tr
                      key={row.retailerId}
                      className={row.canDeliver && idx === 0 ? 'bg-[#EAF3FF]/45' : 'hover:bg-[#F7F9FC]'}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#06265B]">{row.businessName}</span>
                          {row.canDeliver && idx === 0 && (
                            <span className="px-2 py-0.5 rounded bg-[#073B8C] text-white text-[10px] font-bold">
                              Best Value
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#64748B] mt-0.5">
                          {row.neighbourhood}, {row.city} · {row.distanceKm.toFixed(1)} km · ★ {row.ratingAvg.toFixed(1)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {row.canDeliver ? (
                          <span className="inline-flex items-center gap-1 text-[#16834A] font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Delivers
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#D64545] font-semibold">
                            <XCircle className="w-3.5 h-3.5" /> Out of range
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-[#073B8C] tabular-nums">
                        {formatNaira(row.product.sellingPriceKobo)}
                      </td>
                      <td className="py-3.5 px-4 text-right text-[#172B4D] tabular-nums">
                        {formatNaira(row.deliveryFeeKobo)}
                      </td>
                      <td className="py-3.5 px-4 text-right text-[#64748B] tabular-nums">
                        {formatNaira(row.serviceFeeKobo)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-[#06265B] text-sm tabular-nums">
                        {formatNaira(row.landedTotalKobo)}
                      </td>
                      <td className="py-3.5 px-4 text-center text-[#172B4D] tabular-nums">
                        ~{row.estimatedDeliveryMins} mins
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link
                          to={`/retailers/${row.retailerSlug}`}
                          className={`inline-block px-3 py-1.5 rounded-lg font-bold text-xs ${
                            row.canDeliver && row.product.isAvailable
                              ? 'bg-[#073B8C] text-white hover:bg-[#06265B]'
                              : 'bg-[#F1F5F9] text-[#64748B]'
                          }`}
                        >
                          {row.canDeliver ? 'Select & Order' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
