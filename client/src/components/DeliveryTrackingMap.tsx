import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Navigation } from 'lucide-react';
import { createBaseTileLayer } from '../lib/mapTiles';

interface DeliveryTrackingMapProps {
  retailer: { name: string; address: string; lat: number; lng: number };
  customer: { address: string; lat: number; lng: number };
  dispatcher?: { name: string; lat: number | null; lng: number | null; active: boolean } | null;
  heightClass?: string;
  showExternalNavLinks?: boolean;
}

export function DeliveryTrackingMap({
  retailer,
  customer,
  dispatcher,
  heightClass = 'h-[320px]',
  showExternalNavLinks = false,
}: DeliveryTrackingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [retailer.lat, retailer.lng],
      zoom: 13,
    });
    createBaseTileLayer().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: [number, number][] = [
      [retailer.lat, retailer.lng],
      [customer.lat, customer.lng],
    ];

    const retailerIcon = L.divIcon({
      className: 'bf-track-retailer',
      html: `<div style="padding:4px 8px;border-radius:7px;background:#073B8C;color:#fff;border:2px solid #fff;box-shadow:0 3px 10px rgba(6,38,91,0.35);font-size:10px;font-weight:800;white-space:nowrap;">PICKUP</div>`,
      iconSize: [58, 24],
      iconAnchor: [29, 12],
    });
    L.marker([retailer.lat, retailer.lng], { icon: retailerIcon })
      .bindPopup(`<div style="padding:10px;font-size:12px;"><b>Collection Depot:</b> ${retailer.name}<br/><span style="color:#64748B;">${retailer.address}</span></div>`)
      .addTo(layer);

    const customerIcon = L.divIcon({
      className: 'bf-track-customer',
      html: `<div style="padding:4px 8px;border-radius:7px;background:#16834A;color:#fff;border:2px solid #fff;box-shadow:0 3px 10px rgba(22,131,74,0.35);font-size:10px;font-weight:800;white-space:nowrap;">DROP-OFF</div>`,
      iconSize: [68, 24],
      iconAnchor: [34, 12],
    });
    L.marker([customer.lat, customer.lng], { icon: customerIcon })
      .bindPopup(`<div style="padding:10px;font-size:12px;"><b>Customer Delivery:</b><br/><span style="color:#64748B;">${customer.address}</span></div>`)
      .addTo(layer);

    if (dispatcher?.active && dispatcher.lat !== null && dispatcher.lng !== null) {
      points.push([dispatcher.lat, dispatcher.lng]);
      const dispIcon = L.divIcon({
        className: 'bf-track-dispatcher',
        html: `<div style="padding:5px 9px;border-radius:9999px;background:#1769C2;color:#fff;border:2.5px solid #fff;box-shadow:0 4px 12px rgba(23,105,194,0.5);font-size:10px;font-weight:800;white-space:nowrap;">DISPATCHER LIVE</div>`,
        iconSize: [112, 26],
        iconAnchor: [56, 13],
      });
      L.marker([dispatcher.lat, dispatcher.lng], { icon: dispIcon, zIndexOffset: 950 })
        .bindPopup(`<div style="padding:10px;font-size:12px;"><b>${dispatcher.name}</b><br/><span style="color:#16834A;">Live delivery tracking active</span></div>`)
        .addTo(layer);

      L.polyline(
        [
          [retailer.lat, retailer.lng],
          [dispatcher.lat, dispatcher.lng],
          [customer.lat, customer.lng],
        ],
        { color: '#1769C2', weight: 3.5, dashArray: '8 6', opacity: 0.9 }
      ).addTo(layer);
    } else {
      L.polyline(
        [
          [retailer.lat, retailer.lng],
          [customer.lat, customer.lng],
        ],
        { color: '#073B8C', weight: 3, dashArray: '6 6', opacity: 0.7 }
      ).addTo(layer);
    }

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
  }, [retailer.lat, retailer.lng, customer.lat, customer.lng, dispatcher?.lat, dispatcher?.lng, dispatcher?.active]);

  return (
    <div className="space-y-2">
      <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-[#E2E8F0]`}>
        <div ref={containerRef} className="w-full h-full" />
      </div>
      {showExternalNavLinks && (
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${retailer.lat},${retailer.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EAF3FF] text-[#073B8C] text-xs font-bold hover:bg-[#dbeafe]"
          >
            <Navigation className="w-3.5 h-3.5" />
            Navigate to Retailer Pickup
          </a>
          <a
            href={`https://www.google.com/maps/dir/?api=1&origin=${retailer.lat},${retailer.lng}&destination=${customer.lat},${customer.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B8C] text-white text-xs font-bold hover:bg-[#06265B]"
          >
            <Navigation className="w-3.5 h-3.5" />
            Navigate to Customer Drop-off
          </a>
        </div>
      )}
    </div>
  );
}
