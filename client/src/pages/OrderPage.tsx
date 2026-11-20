import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LocateFixed, MapPin, ArrowRight } from 'lucide-react';
import { RetailerMap } from '../components/RetailerMap';
import { useCart } from '../context/CartContext';
import { useLocationContext } from '../context/LocationContext';
import { apiRequest } from '../lib/api';
import { formatNaira } from '../lib/format';
import { NIGERIAN_PRESET_LOCATIONS } from '../lib/locations';
import type { RetailerPublic, RetailerProductPublic } from '../types';

const sizes = [1, 2, 3, 5, 6, 12.5, 25, 50];

export function OrderPage() {
  const navigate = useNavigate();
  const { location, setLocation, setCoordinates, detectGpsLocation, locating } = useLocationContext();
  const { items, replaceItem } = useCart();
  const [size, setSize] = useState('12.5');
  const [quantity, setQuantity] = useState(1);
  const [retailers, setRetailers] = useState<RetailerPublic[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSelectedId(null);
    setRetailers([]);
    const params = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng), neighbourhood: location.neighbourhood, city: location.city, state: location.state, sortBy: 'nearest', sizeKg: size });
    apiRequest<{ retailers: RetailerPublic[] }>(`/api/public/retailers?${params}`)
      .then(result => { if (active) setRetailers(result.retailers); })
      .catch(() => { if (active) setError('Could not load retailers. Please try again or change your location.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [location.lat, location.lng, location.neighbourhood, location.city, location.state, size]);

  const productFor = (retailer: RetailerPublic): RetailerProductPublic | undefined => retailer.products.find(p =>
    p.category_type === 'GAS_REFILL' && p.size_kg === Number(size) && Boolean(p.is_available) && p.stock_quantity > 0
  );
  const available = useMemo(() => retailers.filter(r => productFor(r)), [retailers, size]);
  const selected = available.find(r => r.id === selectedId);
  const product = selected && productFor(selected);
  const canContinue = Boolean(selected?.coverage.canDeliver && product && Number.isInteger(quantity) && quantity >= 1 && quantity <= product.stock_quantity);

  const continueToCheckout = () => {
    if (!selected || !product || !canContinue) return;
    if (items.length && !window.confirm('This will replace your current cart with this gas selection. Continue?')) return;
    replaceItem({ retailerId: selected.id, retailerName: selected.business_name, productId: product.product_id, productName: product.product_name, unitLabel: product.unit_label, sizeKg: product.size_kg, imageUrl: product.image_url, sellingPriceKobo: product.selling_price_kobo, maxStock: product.stock_quantity }, quantity);
    navigate('/checkout');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div><p className="text-xs font-bold tracking-wider uppercase text-[#39754B]">Step 1 of 2</p><h1 className="mt-1 text-3xl font-extrabold text-[#102D25]">Choose your gas</h1><p className="mt-2 text-sm text-[#64748B]">Select a refill size, quantity and nearby retailer, then review your selection at checkout.</p></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">You can prepare and review an order, but placing orders and payments are temporarily unavailable. Please do not send money.</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#06265B]">1. Gas and quantity</h2>
          <div><label htmlFor="order-size" className="block text-sm font-semibold mb-2">Refill size</label><select id="order-size" value={size} onChange={e => { setSize(e.target.value); setQuantity(1); }} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-3 text-sm bg-white">{sizes.map(s => <option key={s} value={s}>{s} kg</option>)}</select><p className="mt-1 text-xs text-[#64748B]">Choose the size of each refill available from a retailer.</p></div>
          <div><label htmlFor="order-quantity" className="block text-sm font-semibold mb-2">Number of refills</label><input id="order-quantity" type="number" inputMode="numeric" min="1" max={product?.stock_quantity} step="1" value={Number.isNaN(quantity) ? '' : quantity} onChange={e => setQuantity(e.target.value === '' ? NaN : Number(e.target.value))} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-3 text-sm" />{product && (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock_quantity) && <p className="text-xs text-red-700 mt-1">Enter a whole number from 1 to {product.stock_quantity}.</p>}</div>
        </section>
        <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#06265B]">2. Delivery location</h2>
          <label htmlFor="order-location" className="block text-sm font-semibold">Choose an area</label>
          <select id="order-location" value={NIGERIAN_PRESET_LOCATIONS.some(p => p.label === location.label) ? location.label : '__custom__'} onChange={e => { const selectedLocation = NIGERIAN_PRESET_LOCATIONS.find(p => p.label === e.target.value); if (selectedLocation) setLocation(selectedLocation); }} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-3 text-sm bg-white"><option value="__custom__" disabled>{location.label}</option>{NIGERIAN_PRESET_LOCATIONS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}</select>
          <p className="text-xs text-[#64748B]"><MapPin className="inline w-4 h-4 mr-1" />{location.addressLine}</p>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={locating} onClick={async () => setGpsStatus((await detectGpsLocation()).message)} className="inline-flex items-center gap-2 rounded-lg border border-[#BFDBFE] bg-[#EAF3FF] text-[#073B8C] px-3 py-2 text-sm font-semibold disabled:opacity-60"><LocateFixed size={16}/>{locating ? 'Finding location…' : 'Use my location'}</button><button type="button" onClick={() => setShowMap(!showMap)} className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm font-semibold text-[#073B8C]">{showMap ? 'Hide map' : 'Choose on map'}</button></div>
          {gpsStatus && <p role="status" className="text-xs text-[#073B8C]">{gpsStatus}</p>}
        </section>
      </div>
      {showMap && <section className="space-y-2"><div className="flex flex-wrap justify-between items-center gap-2"><p className="text-sm text-[#475569]">{picking ? 'Tap the map to set your delivery location.' : 'View nearby retailers or choose a point on the map.'}</p><button type="button" onClick={() => setPicking(!picking)} className="text-sm font-bold text-[#073B8C] underline">{picking ? 'Cancel pin selection' : 'Set location on map'}</button></div><RetailerMap retailers={available} customerLocation={location} selectedRetailerId={selectedId} onSelectRetailer={r => setSelectedId(r.id)} onPickLocation={picking ? (lat, lng) => { setCoordinates(lat, lng); setPicking(false); } : undefined} enablePickMode={picking} heightClass="h-[350px]" /></section>}
      <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 space-y-4">
        <h2 className="text-lg font-bold text-[#06265B]">3. Choose a retailer</h2>
        {loading ? <p className="text-sm text-[#64748B]">Finding nearby retailers…</p> : error ? <p role="alert" className="text-sm text-red-700">{error}</p> : available.length === 0 ? <p className="text-sm text-[#64748B]">No retailers currently list this refill size. Try another size or location.</p> : <div className="grid gap-3 sm:grid-cols-2">{available.map(r => { const p = productFor(r)!; return <label key={r.id} className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer ${selectedId === r.id ? 'border-[#1769C2] bg-[#EAF3FF]' : 'border-[#E2E8F0] hover:border-[#1769C2]'}`}><input type="radio" name="retailer" checked={selectedId === r.id} onChange={() => setSelectedId(r.id)} className="mt-1" /><span className="flex-1"><span className="block font-bold text-[#06265B]">{r.business_name}</span><span className="block text-xs text-[#64748B] mt-1">{r.address} · {r.coverage.distanceKm.toFixed(1)} km away</span><span className="block text-sm font-bold text-[#073B8C] mt-2">{formatNaira(p.selling_price_kobo)} / {p.unit_label}</span><span className={`block text-xs mt-1 ${r.coverage.canDeliver ? 'text-green-700' : 'text-amber-800'}`}>{r.coverage.canDeliver ? 'Delivery available for this area' : r.coverage.reason || 'Delivery unavailable for this area'}</span></span></label>; })}</div>}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4"><div className="text-sm text-[#475569]">{selected && product ? <><strong>{selected.business_name}</strong> · {size} kg × {Number.isFinite(quantity) ? quantity : '–'} {canContinue && <>· Items: <strong>{formatNaira(product.selling_price_kobo * quantity)}</strong> (delivery and fees extra)</>}</> : 'Select a retailer to continue.'}</div><button type="button" onClick={continueToCheckout} disabled={!canContinue || loading} className="inline-flex items-center gap-2 rounded-full bg-[#173E30] px-6 py-3 font-bold text-white hover:bg-[#285B43] disabled:opacity-50 disabled:cursor-not-allowed">Continue to checkout <ArrowRight size={17}/></button></div>
      <Link to="/explore" className="text-sm font-semibold text-[#073B8C] underline">Explore all retailers</Link>
    </div>
  );
}
