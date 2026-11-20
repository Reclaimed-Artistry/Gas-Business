import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Search,
  LocateFixed,
  ArrowRight,
  ShieldCheck,
  Clock,
  Star,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  SlidersHorizontal,
  Truck,
  Wallet,
  Scale,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useLocationContext } from '../context/LocationContext';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';
import { formatNaira } from '../lib/format';
import { RetailerMap } from '../components/RetailerMap';
import type { RetailerPublic } from '../types';

interface HomepageData {
  cms: {
    announcementBanner?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    supportPhone?: string;
    supportEmail?: string;
    supportHours?: string;
    faqs?: { question: string; answer: string }[];
    testimonials?: { name: string; location: string; rating: number; quote: string }[];
  };
  stats: {
    approvedRetailers: number;
    citiesCovered: number;
    completedDeliveries: number;
    avgDeliveryMins: number;
  };
  retailers: RetailerPublic[];
  featuredRetailers: RetailerPublic[];
  popularProducts: {
    id: number;
    name: string;
    slug: string;
    size_kg: number | null;
    unit_label: string;
    description: string;
    image_url: string;
    category_name: string;
    category_type: string;
    min_price_kobo: number;
    max_price_kobo: number;
    retailer_count: number;
  }[];
  promotions: {
    code: string;
    title: string;
    description: string;
  }[];
}

export function HomePage() {
  const { location, setLocation, setCoordinates, detectGpsLocation, locating } = useLocationContext();
  const navigate = useNavigate();

  const pageRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<HomepageData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRetailerId, setSelectedRetailerId] = useState<number | null>(null);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [gpsStatus, setGpsStatus] = useState('');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      neighbourhood: location.neighbourhood,
      city: location.city,
    });
    apiRequest<HomepageData>(`/api/public/homepage?${params.toString()}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.lat, location.lng, location.neighbourhood, location.city]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elements = Array.from(page.querySelectorAll<HTMLElement>('[data-scroll-reveal]'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        // Reset only once the element has completely left the viewport, so it
        // can reveal again when scrolling in either direction.
        target.classList.toggle('scroll-reveal-pending', !isIntersecting);
      });
    }, { threshold: 0 });
    elements.forEach((element, index) => {
      element.dataset.scrollDirection = index % 2 === 0 ? 'left' : 'right';
      const bounds = element.getBoundingClientRect();
      // Keep content already on screen visible on reload or back navigation.
      if (bounds.top >= window.innerHeight || bounds.bottom <= 0) {
        element.classList.add('scroll-reveal-pending');
      }
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
      elements.forEach((element) => element.classList.remove('scroll-reveal-pending'));
    };
  }, [data]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (searchQuery.trim()) qs.set('q', searchQuery.trim());
    navigate(`/explore${qs.toString() ? `?${qs.toString()}` : ''}`);
  };

  const handleGps = async () => {
    setGpsStatus('');
    const res = await detectGpsLocation();
    setGpsStatus(res.message);
  };

  const coveringCount = data?.retailers.filter((r) => r.coverage.canDeliver).length ?? 0;

  return (
    <div ref={pageRef} className="bg-[#F8F9F7] overflow-x-clip">
      {/* Hero Section */}
      <section className="bg-[#F7F8F3] border-b border-[#E5E9E1]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#E4EDE1] px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#31583C]">
                <span className="w-2 h-2 rounded-full bg-[#53A05D]" /> Gas delivery, made simpler
              </div>

              <h1 className="max-w-[720px] text-[42px] sm:text-5xl lg:text-[64px] font-extrabold text-[#102D25] leading-[1.06] tracking-[-0.045em]">
                Your cooking gas, <span className="text-[#39754B]">closer to home.</span>
              </h1>
              <p className="text-base sm:text-lg text-[#5A6B62] leading-relaxed max-w-xl">
                Find nearby gas retailers, compare prices and explore delivery coverage in Uyo—all in one place.
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled aria-describedby="ordering-status" className="inline-flex items-center justify-center rounded-full bg-[#D7E0D6] px-7 py-3.5 text-sm font-bold text-[#485D4D] cursor-not-allowed">
                  Order now
                </button>
                <Link to="/explore" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#173E30] px-7 py-3.5 text-sm font-bold text-white hover:bg-[#285B43] transition-colors">
                  Explore retailers <ArrowRight className="w-4 h-4" />
                </Link>
                <a href="#how-it-works" className="inline-flex items-center justify-center rounded-full border border-[#C7D5C8] px-7 py-3.5 text-sm font-bold text-[#173E30] hover:bg-white transition-colors">How it works</a>
              </div>
              <p id="ordering-status" className="text-xs text-[#76551F] font-medium">Online ordering and wallet funding are temporarily unavailable. You can still explore retailers and compare prices.</p>

              {/* Prominent Location Selector & Search Bar */}
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-7">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-1">
                      Your Delivery Area
                    </label>
                    <div className="relative">
                      <MapPin className="w-4 h-4 text-[#073B8C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        value={
                          NIGERIAN_PRESET_LOCATIONS.some((p) => p.label === location.label)
                            ? location.label
                            : '__custom__'
                        }
                        onChange={(e) => {
                          const found = NIGERIAN_PRESET_LOCATIONS.find((p) => p.label === e.target.value);
                          if (found) setLocation(found);
                        }}
                        className="w-full pl-9 pr-3 py-2.5 text-sm font-semibold text-[#06265B] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#073B8C]"
                      >
                        {!NIGERIAN_PRESET_LOCATIONS.some((p) => p.label === location.label) && (
                          <option value="__custom__">{location.label}</option>
                        )}
                        {NIGERIAN_PRESET_LOCATIONS.map((loc) => (
                          <option key={loc.label} value={loc.label}>
                            {loc.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="sm:col-span-5 flex items-end">
                    <button
                      type="button"
                      onClick={() => void handleGps()}
                      disabled={locating}
                      className="w-full py-2.5 px-3 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-[#073B8C] hover:bg-[#dbeafe] text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <LocateFixed className="w-4 h-4" />
                      {locating ? 'Locating GPS...' : 'Use My Current GPS'}
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search gas size (e.g. 12.5kg, 6kg, regulator) or retailer name..."
                      className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D] placeholder:text-[#64748B] focus:outline-none focus:border-[#073B8C]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors shrink-0"
                  >
                    Find Retailers
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] pt-0.5">
                  <span>
                    <strong className="text-[#073B8C]">{coveringCount}</strong> verified retailer
                    {coveringCount === 1 ? '' : 's'} currently delivering to{' '}
                    <strong className="text-[#172B4D]">{location.neighbourhood}</strong>
                  </span>
                  {gpsStatus && <span className="text-[#1769C2] font-medium">{gpsStatus}</span>}
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-[#536B5B]">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#39754B]" /> Verified retailers</span>
                <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#39754B]" /> Local coverage</span>
                <span className="inline-flex items-center gap-2"><Scale className="w-4 h-4 text-[#39754B]" /> Compare prices</span>
              </div>
            </div>

            {/* Illustrative image; the marketplace remains the source of retailer details. */}
            <div className="lg:col-span-5 relative">
              <div className="relative overflow-hidden rounded-[2rem] bg-[#DDE8DB] shadow-xl shadow-[#1C3D2C]/10">
                <img src="/images/gasflo-delivery-hero.jpg" alt="Illustration of a cooking gas delivery at a home" className="w-full h-[340px] sm:h-[460px] lg:h-[610px] object-cover object-[68%_center]" />
                <div className="absolute bottom-5 left-5 right-5 rounded-2xl bg-white/95 backdrop-blur-sm px-5 py-4 flex items-center gap-3 shadow-lg">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E8F2E7] text-[#39754B]"><MapPin className="w-5 h-5" /></div>
                  <div><p className="text-sm font-extrabold text-[#173E30]">Made for your neighbourhood</p><p className="text-xs text-[#64746B] mt-0.5">Find gas retailers near your location</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Simple service overview, inspired by the reference's approachable layout. */}
      <section className="bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div data-scroll-reveal className="grid gap-8 lg:grid-cols-12 lg:items-end mb-10">
            <div className="lg:col-span-7"><span className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#55916A]">A simpler way to refill</span><h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl leading-tight font-extrabold tracking-tight text-[#163A2C]">Less searching.<br />More time for life.</h2></div>
            <p className="lg:col-span-5 text-sm sm:text-base leading-relaxed text-[#6B7970]">Gasflo helps you explore retailers around you, check coverage and compare gas prices without the guesswork.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: MapPin, title: 'Find your location', text: 'Use your device location or select a point on the map to check nearby retailers.' },
              { icon: Scale, title: 'Compare with confidence', text: 'Browse available gas products and compare retailer prices in one place.' },
              { icon: Truck, title: 'Keep track of delivery', text: 'Follow delivery progress and dispatcher location when tracking is available.' },
            ].map((card, index) => <div key={card.title} data-scroll-reveal className="home-hover-card rounded-[1.5rem] bg-[#F5F8F1] p-7 sm:p-8 flex flex-col min-h-[210px]">
              <div className="flex items-center justify-between"><span className="h-12 w-12 rounded-2xl bg-white flex items-center justify-center text-[#39754B]"><card.icon className="w-5 h-5" /></span><span className="text-xs font-bold text-[#9BAEA0]">0{index + 1}</span></div>
              <h3 className="mt-7 text-lg font-extrabold text-[#173E30]">{card.title}</h3><p className="mt-2 text-sm leading-relaxed text-[#67786B]">{card.text}</p>
            </div>)}
          </div>
        </div>
      </section>

      {/* Interactive Map Preview — Explore Nearby Retailers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div data-scroll-reveal className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">
              Location-Based Discovery
            </span>
            <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">
              Explore Verified Gas Retailers Around You
            </h2>
            <p className="text-sm text-[#64748B] mt-1">
              Click any blue price marker to compare rates and delivery times, or click the map to pin a custom
              delivery address.
            </p>
          </div>
          <Link
            to="/explore"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#073B8C] text-white text-xs font-bold hover:bg-[#06265B] self-start sm:self-auto"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Open Full Map & Price Comparator
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8">
            <RetailerMap
              retailers={data?.retailers || []}
              customerLocation={location}
              selectedRetailerId={selectedRetailerId}
              onSelectRetailer={(r) => setSelectedRetailerId(r.id)}
              onOpenRetailer={(r) => navigate(`/retailers/${r.slug}`)}
              onPickLocation={(lat, lng) => setCoordinates(lat, lng)}
              heightClass="h-[440px]"
            />
          </div>

          <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-xl flex flex-col max-h-[440px]">
            <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#06265B]">Nearby Depots</h3>
                <p className="text-[11px] text-[#64748B]">Sorted by coverage & proximity to {location.neighbourhood}</p>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#EAF3FF] text-[#073B8C] text-xs font-bold tabular-nums">
                {data?.retailers.length || 0}
              </span>
            </div>
            <div className="overflow-y-auto divide-y divide-[#E2E8F0] flex-1">
              {(data?.retailers || []).slice(0, 6).map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedRetailerId(r.id)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    selectedRetailerId === r.id ? 'bg-[#EAF3FF]/60' : 'hover:bg-[#F7F9FC]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-[#06265B]">{r.business_name}</div>
                      <div className="text-xs text-[#64748B]">{r.neighbourhood}, {r.city}</div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        r.coverage.canDeliver
                          ? 'bg-[#ECFDF3] text-[#16834A]'
                          : 'bg-[#F1F5F9] text-[#64748B]'
                      }`}
                    >
                      {r.coverage.canDeliver ? 'Covers You' : `${r.coverage.distanceKm.toFixed(1)} km`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2.5 text-xs">
                    <div>
                      <span className="text-[#64748B]">12.5kg: </span>
                      <span className="font-bold text-[#073B8C] tabular-nums">
                        {r.highlights.price_12_5kg_kobo ? formatNaira(r.highlights.price_12_5kg_kobo) : 'N/A'}
                      </span>
                    </div>
                    <div className="text-[#64748B] tabular-nums">
                      Delivery: <span className="font-semibold text-[#172B4D]">{formatNaira(r.coverage.deliveryFeeKobo)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#64748B]">
                      <Star className="w-3 h-3 text-[#E99A25] fill-[#E99A25]" />
                      {r.rating_avg.toFixed(1)} · ~{r.coverage.estimatedDeliveryMins} mins
                    </span>
                    <Link
                      to={`/retailers/${r.slug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-bold text-[#1769C2] hover:text-[#073B8C]"
                    >
                      Order →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Popular Gas Quantities & Accessories */}
      <section className="bg-white border-y border-[#E2E8F0] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div data-scroll-reveal className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">
                Transparent Price Ranges
              </span>
              <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">
                Popular Gas Quantities & Cooking Accessories
              </h2>
              <p className="text-sm text-[#64748B] mt-1">
                Prices vary independently across retailers. Select any cylinder size to compare nearby stations side by
                side.
              </p>
            </div>
            <Link
              to="/explore?view=compare"
              className="text-xs font-bold text-[#073B8C] hover:underline inline-flex items-center gap-1"
            >
              View Full Price Comparison Table <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {(data?.popularProducts || [])
              .filter((p) => [3, 5, 6, 12.5, 25, 50].includes(p.size_kg || -1) || p.category_type === 'ACCESSORY')
              .slice(0, 8)
              .map((prod) => (
                <Link
                  key={prod.id}
                  to={
                    prod.size_kg && prod.category_type === 'GAS_REFILL'
                      ? `/explore?view=compare&sizeKg=${prod.size_kg}`
                      : `/explore?q=${encodeURIComponent(prod.name)}`
                  }
                  className="home-hover-card group bg-[#F7F9FC] border border-[#E2E8F0] hover:border-[#1769C2] rounded-xl overflow-hidden transition-colors flex flex-col"
                >
                  <div className="h-40 bg-white flex items-center justify-center border-b border-[#E2E8F0] overflow-hidden">
                    <img
                      src={prod.image_url}
                      alt={prod.name}
                      className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                    />
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1769C2]">
                        {prod.category_name}
                      </span>
                      <h3 className="text-sm font-bold text-[#06265B] mt-0.5 leading-snug">{prod.name}</h3>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-[#E2E8F0] flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-[#64748B]">From</div>
                        <div className="text-sm font-extrabold text-[#073B8C] tabular-nums">
                          {formatNaira(prod.min_price_kobo)}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-[#64748B]">
                        {prod.retailer_count} depots
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* Featured Approved Retailers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div data-scroll-reveal className="mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">
            Operations-Approved Supply Partners
          </span>
          <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">Featured Gas Retailers</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {(data?.featuredRetailers || []).map((r) => (
            <div
              key={r.id}
              data-scroll-reveal
              className="home-hover-card bg-white border border-[#E2E8F0] rounded-xl overflow-hidden flex flex-col hover:border-[#1769C2] transition-colors"
            >
              <div className="relative h-36 bg-[#06265B]">
                <img
                  src={r.cover_image_url || '/images/depot-ewet.jpg'}
                  alt={r.business_name}
                  className="w-full h-full object-cover"
                />
                <span
                  className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    r.is_open_now ? 'bg-[#ECFDF3] text-[#16834A]' : 'bg-[#FEF2F2] text-[#D64545]'
                  }`}
                >
                  {r.is_open_now ? 'Open Now' : 'Closed'}
                </span>
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#06265B]">{r.business_name}</h3>
                    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-[#172B4D]">
                      <Star className="w-3.5 h-3.5 text-[#E99A25] fill-[#E99A25]" />
                      {r.rating_avg.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-1">{r.address}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 bg-[#F7F9FC] border border-[#E2E8F0] rounded-lg p-2.5 text-xs">
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
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[#64748B]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> ~{r.coverage.estimatedDeliveryMins} mins
                    </span>
                    <span>Radius: {r.max_delivery_radius_km} km</span>
                  </div>
                  <Link
                    to={`/retailers/${r.slug}`}
                    className="block w-full text-center py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold transition-colors"
                  >
                    Browse Products & Order
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-white border-y border-[#E2E8F0] py-16 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div data-scroll-reveal className="text-center max-w-2xl mx-auto mb-9">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">How Gasflo Works</span>
            <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">
              Engineered for Transparent Pricing & Safe Doorstep Delivery
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                step: '01',
                icon: MapPin,
                title: 'Pin Address & Compare',
                desc: 'Choose your GPS or neighbourhood location to inspect verified retailers covering your area and compare exact gas & delivery fees.',
              },
              {
                step: '02',
                icon: Wallet,
                title: 'Payments Coming Soon',
                desc: 'Online payments and ordering are temporarily unavailable while payment processing is being set up.',
              },
              {
                step: '03',
                icon: Scale,
                title: 'Dispatcher Collects Sealed Gas',
                desc: 'Operations assigns the closest available dispatcher who collects your weighed gas refill or accessory from the selected retailer.',
              },
              {
                step: '04',
                icon: Truck,
                title: 'Track Live & Confirm PIN',
                desc: 'Follow delivery milestones and live map progress until arrival, then share your 4-digit delivery confirmation PIN.',
              },
            ].map((item) => (
              <div key={item.step} data-scroll-reveal className="home-hover-card bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-lg bg-[#EAF3FF] border border-[#BFDBFE] text-[#073B8C] flex items-center justify-center">
                    <item.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-extrabold text-[#1769C2] font-mono">{item.step}</span>
                </div>
                <h3 className="text-sm font-bold text-[#06265B]">{item.title}</h3>
                <p className="text-xs text-[#64748B] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Customer Testimonials */}
      {data?.cms?.testimonials && data.cms.testimonials.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">Verified Customers</span>
            <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">Trusted Across Uyo Households</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {data.cms.testimonials.map((t, idx) => (
              <div key={idx} data-scroll-reveal className="home-hover-card bg-white border border-[#E2E8F0] rounded-xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-0.5 mb-3">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 text-[#E99A25] fill-[#E99A25]" />
                    ))}
                  </div>
                  <p className="text-sm text-[#172B4D] leading-relaxed">“{t.quote}”</p>
                </div>
                <div className="mt-4 pt-3 border-t border-[#E2E8F0]">
                  <div className="text-xs font-bold text-[#06265B]">{t.name}</div>
                  <div className="text-[11px] text-[#64748B]">{t.location}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ & Customer Support */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-3">
            <div data-scroll-reveal className="mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1769C2]">Help Centre</span>
              <h2 className="text-2xl font-extrabold text-[#06265B] mt-1">Frequently Asked Questions</h2>
            </div>
            {(data?.cms?.faqs || []).map((faq, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div key={idx} className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-[#F7F9FC] transition-colors"
                    aria-expanded={isOpen}
                  >
                    <span className="text-sm font-bold text-[#06265B]">{faq.question}</span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-[#073B8C] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#64748B] shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 text-xs text-[#64748B] leading-relaxed border-t border-[#F1F5F9] pt-3">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="lg:col-span-5">
            <div className="bg-[#073B8C] text-white rounded-xl p-6 space-y-4 border border-[#06265B]">
              <span className="inline-block px-2.5 py-1 rounded-md bg-white/10 text-[#EAF3FF] text-[11px] font-bold">
                Dedicated Customer Care
              </span>
              <h3 className="text-xl font-extrabold">Need Help With an Order or Delivery?</h3>
              <p className="text-xs text-[#EAF3FF]/85 leading-relaxed">
                Our Uyo, Akwa Ibom operations support desk monitors every active dispatch and payment ledger. Reach us
                directly or submit a tracked support ticket inside your Customer Dashboard.
              </p>
              <div className="space-y-2.5 pt-1 text-xs">
                <div className="flex items-center gap-2.5 bg-white/10 rounded-lg px-3.5 py-2.5">
                  <Phone className="w-4 h-4 text-[#EAF3FF]" />
                  <div>
                    <div className="text-[10px] text-[#EAF3FF]/70 uppercase">Support Hotline</div>
                    <div className="font-bold">{data?.cms?.supportPhone || '+234 800 258 3352'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 bg-white/10 rounded-lg px-3.5 py-2.5">
                  <Mail className="w-4 h-4 text-[#EAF3FF]" />
                  <div>
                    <div className="text-[10px] text-[#EAF3FF]/70 uppercase">Support Email</div>
                    <div className="font-bold">{data?.cms?.supportEmail || 'support@blueflame.ng'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 bg-white/10 rounded-lg px-3.5 py-2.5">
                  <Clock className="w-4 h-4 text-[#EAF3FF]" />
                  <div>
                    <div className="text-[10px] text-[#EAF3FF]/70 uppercase">Operations Hours</div>
                    <div className="font-bold">{data?.cms?.supportHours || 'Daily, 6:30 AM – 9:30 PM WAT'}</div>
                  </div>
                </div>
              </div>
              <Link
                to="/dashboard?tab=support"
                className="block w-full text-center py-2.5 rounded-lg bg-white text-[#073B8C] hover:bg-[#EAF3FF] text-xs font-extrabold transition-colors"
              >
                Open Customer Support Portal
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
