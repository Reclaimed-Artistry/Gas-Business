import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { DeliveryLocation, RetailerPublic } from '../types';
import { formatNaira } from '../lib/format';
import { createBaseTileLayer } from '../lib/mapTiles';

interface RetailerMapProps {
  retailers: RetailerPublic[];
  customerLocation: DeliveryLocation;
  selectedRetailerId?: number | null;
  onSelectRetailer?: (retailer: RetailerPublic) => void;
  onOpenRetailer?: (retailer: RetailerPublic) => void;
  onPickLocation?: (lat: number, lng: number) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  heightClass?: string;
  enablePickMode?: boolean;
  showCoverageCircle?: boolean;
}

export function RetailerMap({
  retailers,
  customerLocation,
  selectedRetailerId,
  onSelectRetailer,
  onOpenRetailer,
  onPickLocation,
  onBoundsChange,
  heightClass = 'h-[460px]',
  enablePickMode = false,
  showCoverageCircle = true,
}: RetailerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lastLocationRef = useRef({ lat: customerLocation.lat, lng: customerLocation.lng, capturedAt: customerLocation.capturedAt });
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const customerLayerRef = useRef<L.LayerGroup | null>(null);
  const coverageLayerRef = useRef<L.LayerGroup | null>(null);

  const callbacksRef = useRef({ onSelectRetailer, onOpenRetailer, onPickLocation, onBoundsChange });
  callbacksRef.current = { onSelectRetailer, onOpenRetailer, onPickLocation, onBoundsChange };

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [customerLocation.lat, customerLocation.lng],
      zoom: customerLocation.source === 'gps' ? 16 : 12,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    createBaseTileLayer().addTo(map);

    coverageLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    customerLayerRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      if (callbacksRef.current.onBoundsChange) {
        const b = map.getBounds();
        callbacksRef.current.onBoundsChange({
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
      }
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (callbacksRef.current.onPickLocation) {
        callbacksRef.current.onPickLocation(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Recenter on every new selection, even when the new fix is nearby.
  useEffect(() => {
    const map = mapRef.current;
    const last = lastLocationRef.current;
    if (!map || (last.lat === customerLocation.lat && last.lng === customerLocation.lng && last.capturedAt === customerLocation.capturedAt)) return;
    lastLocationRef.current = { lat: customerLocation.lat, lng: customerLocation.lng, capturedAt: customerLocation.capturedAt };
    map.setView([customerLocation.lat, customerLocation.lng], customerLocation.source === 'gps' ? 16 : Math.max(map.getZoom(), 14), { animate: true });
  }, [customerLocation.lat, customerLocation.lng, customerLocation.source, customerLocation.capturedAt]);

  // Render customer delivery location pin
  useEffect(() => {
    const layer = customerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const customerIcon = L.divIcon({
      className: 'bf-customer-icon',
      html: `
        <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:#16834A;border:3px solid #FFFFFF;box-shadow:0 4px 12px rgba(22,131,74,0.45);color:#FFFFFF;font-size:11px;font-weight:800;">
          YOU
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    if (customerLocation.source === 'gps' && Number.isFinite(customerLocation.accuracyMeters) && customerLocation.accuracyMeters! > 0) {
      L.circle([customerLocation.lat, customerLocation.lng], {
        radius: customerLocation.accuracyMeters, color: '#16834A', weight: 1, fillOpacity: 0.12,
      }).addTo(layer);
    }
    const popup = document.createElement('div');
    popup.style.cssText = 'padding:12px;font-size:12px;';
    const title = document.createElement('strong');
    title.textContent = 'Selected delivery location';
    const detail = document.createElement('div');
    detail.textContent = customerLocation.addressLine;
    popup.append(title, detail);
    if (customerLocation.source === 'gps' && Number.isFinite(customerLocation.accuracyMeters)) {
      const accuracy = document.createElement('div');
      accuracy.textContent = `Estimated accuracy: ±${Math.ceil(customerLocation.accuracyMeters!)} m`;
      popup.append(accuracy);
    }
    L.marker([customerLocation.lat, customerLocation.lng], { icon: customerIcon, zIndexOffset: 1000 })
      .bindPopup(popup)
      .addTo(layer);
  }, [customerLocation]);

  // Render retailer markers with zoom-aware grouping/clustering + info cards
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    const covLayer = coverageLayerRef.current;
    if (!map || !layer || !covLayer) return;

    const renderMarkers = () => {
      layer.clearLayers();
      covLayer.clearLayers();

      const zoom = map.getZoom();
      // Simple grid clustering when zoomed far out (zoom <= 9)
      if (zoom <= 9 && retailers.length > 3) {
        const clusters = new Map<string, RetailerPublic[]>();
        for (const r of retailers) {
          const key = `${Math.round(r.lat * 2) / 2},${Math.round(r.lng * 2) / 2}`;
          const arr = clusters.get(key) || [];
          arr.push(r);
          clusters.set(key, arr);
        }

        for (const group of clusters.values()) {
          if (group.length > 1) {
            const avgLat = group.reduce((s, r) => s + r.lat, 0) / group.length;
            const avgLng = group.reduce((s, r) => s + r.lng, 0) / group.length;
            const clusterIcon = L.divIcon({
              className: 'bf-cluster-icon',
              html: `<div class="bf-marker-pin" style="width:40px;height:40px;background:#06265B;font-size:13px;">${group.length}</div>`,
              iconSize: [40, 40],
              iconAnchor: [20, 20],
            });
            L.marker([avgLat, avgLng], { icon: clusterIcon })
              .on('click', () => map.setView([avgLat, avgLng], Math.min(12, zoom + 3), { animate: true }))
              .addTo(layer);
            continue;
          }
          addSingleRetailerMarker(group[0]);
        }
      } else {
        for (const r of retailers) {
          addSingleRetailerMarker(r);
        }
      }

      // Show delivery coverage circle for selected retailer
      if (showCoverageCircle && selectedRetailerId) {
        const sel = retailers.find((r) => r.id === selectedRetailerId);
        if (sel) {
          L.circle([sel.lat, sel.lng], {
            radius: sel.max_delivery_radius_km * 1000,
            color: '#1769C2',
            weight: 1.5,
            dashArray: '6 4',
            fillColor: '#EAF3FF',
            fillOpacity: 0.25,
          }).addTo(covLayer);
        }
      }
    };

    const addSingleRetailerMarker = (r: RetailerPublic) => {
      const isSelected = selectedRetailerId === r.id;
      const canDeliver = r.coverage.canDeliver;
      const priceLabel = r.highlights.price_12_5kg_kobo
        ? `₦${(r.highlights.price_12_5kg_kobo / 100000).toFixed(1)}k`
        : 'LPG';

      const bg = isSelected ? '#06265B' : canDeliver ? '#073B8C' : '#64748B';
      const icon = L.divIcon({
        className: 'bf-retailer-icon',
        html: `
          <div style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:9999px;background:${bg};color:#FFFFFF;border:2px solid #FFFFFF;box-shadow:0 4px 12px rgba(6,38,91,0.32);font-size:11px;font-weight:700;white-space:nowrap;">
            <span style="width:7px;height:7px;border-radius:9999px;background:${r.is_open_now ? '#4ADE80' : '#F87171'};"></span>
            <span>${priceLabel}</span>
          </div>
        `,
        iconSize: [72, 28],
        iconAnchor: [36, 14],
      });

      const popupContainer = document.createElement('div');
      popupContainer.style.padding = '12px';
      popupContainer.style.fontFamily = 'Inter, sans-serif';
      popupContainer.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:#06265B;">${r.business_name}</div>
            <div style="font-size:11px;color:#64748B;margin-top:2px;">${r.address}, ${r.neighbourhood}</div>
          </div>
          <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap;background:${r.is_open_now ? '#ECFDF3' : '#FEF2F2'};color:${r.is_open_now ? '#16834A' : '#D64545'};">
            ${r.is_open_now ? 'Open' : 'Closed'}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;padding:8px;background:#F7F9FC;border:1px solid #E2E8F0;border-radius:8px;font-size:11px;">
          <div>
            <div style="color:#64748B;">12.5kg Refill</div>
            <div style="font-weight:700;color:#073B8C;">${r.highlights.price_12_5kg_kobo ? formatNaira(r.highlights.price_12_5kg_kobo) : 'N/A'}</div>
          </div>
          <div>
            <div style="color:#64748B;">Delivery Fee</div>
            <div style="font-weight:700;color:#172B4D;">${formatNaira(r.coverage.deliveryFeeKobo)}</div>
          </div>
          <div>
            <div style="color:#64748B;">Distance</div>
            <div style="font-weight:600;color:#172B4D;">${r.coverage.distanceKm.toFixed(1)} km</div>
          </div>
          <div>
            <div style="color:#64748B;">Est. Delivery</div>
            <div style="font-weight:600;color:#172B4D;">~${r.coverage.estimatedDeliveryMins} mins</div>
          </div>
        </div>
        <div style="margin-top:8px;font-size:11px;font-weight:600;color:${canDeliver ? '#16834A' : '#D64545'};">
          ${canDeliver ? '✓ Delivers to your selected location' : '✕ Outside delivery coverage radius'}
        </div>
        <button data-open-retailer="true" style="margin-top:10px;width:100%;padding:8px 10px;border:none;border-radius:7px;background:#073B8C;color:#FFFFFF;font-size:12px;font-weight:700;cursor:pointer;">
          View Available Products (${r.highlights.available_product_count})
        </button>
      `;

      const btn = popupContainer.querySelector('[data-open-retailer="true"]');
      if (btn) {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          callbacksRef.current.onOpenRetailer?.(r);
        });
      }

      const marker = L.marker([r.lat, r.lng], { icon })
        .bindPopup(popupContainer, { maxWidth: 300 })
        .on('click', () => {
          callbacksRef.current.onSelectRetailer?.(r);
        })
        .addTo(layer);

      if (isSelected) {
        marker.openPopup();
      }
    };

    renderMarkers();
    map.on('zoomend', renderMarkers);
    return () => {
      map.off('zoomend', renderMarkers);
    };
  }, [retailers, selectedRetailerId, showCoverageCircle]);

  return (
    <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-[#E2E8F0] bg-[#EAF3FF]`}>
      <div ref={containerRef} className="w-full h-full" />
      {enablePickMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] bg-[#06265B]/95 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md pointer-events-none">
          Click anywhere on the map to set your delivery pin
        </div>
      )}
      <div className="absolute bottom-3 left-3 z-[400] bg-white/95 border border-[#E2E8F0] rounded-lg px-3 py-2 text-[11px] flex flex-wrap items-center gap-3 shadow-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#172B4D]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#073B8C]" /> Covers Your Area
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#64748B]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#64748B]" /> Outside Coverage
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#16834A]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#16834A]" /> Your Pin
        </span>
      </div>
    </div>
  );
}
