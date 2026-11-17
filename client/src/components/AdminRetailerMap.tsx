import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { createBaseTileLayer } from '../lib/mapTiles';

export interface AdminRetailerPoint {
  id: number;
  business_name: string;
  address: string;
  neighbourhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  max_delivery_radius_km: number;
  status: string;
  is_open_now: number;
}

interface AdminRetailerMapProps {
  retailers: AdminRetailerPoint[];
  selectedId?: number | null;
  pickCoords?: { lat: number; lng: number } | null;
  onSelectRetailer?: (r: AdminRetailerPoint) => void;
  onMapPickCoords?: (lat: number, lng: number) => void;
  heightClass?: string;
}

export function AdminRetailerMap({
  retailers,
  selectedId,
  pickCoords,
  onSelectRetailer,
  onMapPickCoords,
  heightClass = 'h-[420px]',
}: AdminRetailerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const cbRef = useRef({ onSelectRetailer, onMapPickCoords });
  cbRef.current = { onSelectRetailer, onMapPickCoords };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [5.0377, 7.9128],
      zoom: 12,
    });
    createBaseTileLayer().addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      cbRef.current.onMapPickCoords?.(
        Math.round(e.latlng.lat * 10000) / 10000,
        Math.round(e.latlng.lng * 10000) / 10000
      );
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    for (const r of retailers) {
      const color =
        r.status === 'APPROVED_ACTIVE'
          ? '#073B8C'
          : r.status === 'PENDING_APPROVAL'
            ? '#E99A25'
            : '#D64545';

      // Draw delivery coverage radius circle to reveal coverage overlap and underserved areas
      L.circle([r.lat, r.lng], {
        radius: r.max_delivery_radius_km * 1000,
        color,
        weight: selectedId === r.id ? 2.5 : 1,
        dashArray: r.status === 'APPROVED_ACTIVE' ? undefined : '5 5',
        fillColor: color,
        fillOpacity: r.status === 'APPROVED_ACTIVE' ? 0.1 : 0.05,
      }).addTo(layer);

      const icon = L.divIcon({
        className: 'bf-admin-pin',
        html: `<div style="width:26px;height:26px;border-radius:9999px;background:${color};border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-size:10px;font-weight:800;">R</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      L.marker([r.lat, r.lng], { icon })
        .bindPopup(
          `<div style="padding:10px;font-size:12px;">
            <div style="font-weight:700;color:#06265B;">${r.business_name}</div>
            <div style="color:#64748B;margin-top:2px;">${r.address}, ${r.city}</div>
            <div style="margin-top:6px;font-weight:600;color:${color};">Status: ${r.status.replace(/_/g, ' ')}</div>
            <div style="color:#172B4D;margin-top:2px;">Coverage radius: ${r.max_delivery_radius_km} km</div>
          </div>`
        )
        .on('click', () => cbRef.current.onSelectRetailer?.(r))
        .addTo(layer);
    }

    if (pickCoords) {
      const pinIcon = L.divIcon({
        className: 'bf-pick-pin',
        html: `<div style="width:28px;height:28px;border-radius:9999px;background:#16834A;border:3px solid #FFFFFF;box-shadow:0 4px 12px rgba(22,131,74,0.45);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-size:11px;font-weight:800;">+</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([pickCoords.lat, pickCoords.lng], { icon: pinIcon, zIndexOffset: 900 }).addTo(layer);
    }
  }, [retailers, selectedId, pickCoords]);

  return (
    <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-[#E2E8F0]`}>
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 z-[400] bg-white/95 border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[11px] flex flex-wrap gap-3 shadow-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#073B8C]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#073B8C]" /> Approved Active
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#B45309]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E99A25]" /> Pending Approval
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#D64545]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#D64545]" /> Suspended / Inactive
        </span>
      </div>
    </div>
  );
}
