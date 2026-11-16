import React, { useState } from 'react';
import { MapPin, Plus, CheckCircle2, PauseCircle, Trash2, Edit3, Crosshair } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { StatusBadge } from '../../components/StatusBadge';
import { AdminRetailerMap, type AdminRetailerPoint } from '../../components/AdminRetailerMap';

export interface AdminRetailerRow extends AdminRetailerPoint {
  contact_person: string;
  phone: string;
  email: string;
  description: string;
  coverage_areas_json: string;
  base_delivery_fee_kobo: number;
  per_km_delivery_fee_kobo: number;
  estimated_prep_mins: number;
  featured: number;
  rating_avg: number;
  active_products_count: number;
  total_orders: number;
}

export function AdminRetailersPanel({
  retailers,
  onReload,
  onFlash,
  onError,
}: {
  retailers: AdminRetailerRow[];
  onReload: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [stateFilter, setStateFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    businessName: '',
    contactPerson: '',
    phone: '+234 ',
    email: '',
    address: '',
    neighbourhood: '',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4541,
    lng: 3.3947,
    description: '',
    maxDeliveryRadiusKm: 10,
    coverageAreasText: 'Victoria Island, Ikoyi, Lekki Phase 1',
    baseDeliveryFeeNaira: 1000,
    perKmDeliveryFeeNaira: 120,
    estimatedPrepMins: 15,
    status: 'APPROVED_ACTIVE',
    featured: false,
    isOpenNow: true,
  });

  const filtered = retailers.filter((r) => {
    if (stateFilter !== 'ALL' && r.state !== stateFilter) return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  const openCreateForm = () => {
    setEditingId(null);
    setForm({
      businessName: '',
      contactPerson: '',
      phone: '+234 ',
      email: '',
      address: '',
      neighbourhood: '',
      city: 'Lagos',
      state: 'Lagos',
      lat: 6.4541,
      lng: 3.3947,
      description: '',
      maxDeliveryRadiusKm: 10,
      coverageAreasText: '',
      baseDeliveryFeeNaira: 1000,
      perKmDeliveryFeeNaira: 120,
      estimatedPrepMins: 15,
      status: 'APPROVED_ACTIVE',
      featured: false,
      isOpenNow: true,
    });
    setShowForm(true);
  };

  const openEditForm = (r: AdminRetailerRow) => {
    let areas: string[] = [];
    try {
      areas = JSON.parse(r.coverage_areas_json || '[]');
    } catch {
      areas = [];
    }
    setEditingId(r.id);
    setSelectedId(r.id);
    setForm({
      businessName: r.business_name,
      contactPerson: r.contact_person,
      phone: r.phone,
      email: r.email || '',
      address: r.address,
      neighbourhood: r.neighbourhood,
      city: r.city,
      state: r.state,
      lat: r.lat,
      lng: r.lng,
      description: r.description || '',
      maxDeliveryRadiusKm: r.max_delivery_radius_km,
      coverageAreasText: areas.join(', '),
      baseDeliveryFeeNaira: Math.round(r.base_delivery_fee_kobo / 100),
      perKmDeliveryFeeNaira: Math.round(r.per_km_delivery_fee_kobo / 100),
      estimatedPrepMins: r.estimated_prep_mins || 15,
      status: r.status,
      featured: r.featured === 1,
      isOpenNow: r.is_open_now === 1,
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      businessName: form.businessName,
      contactPerson: form.contactPerson,
      phone: form.phone,
      email: form.email,
      address: form.address,
      neighbourhood: form.neighbourhood,
      city: form.city,
      state: form.state,
      lat: Number(form.lat),
      lng: Number(form.lng),
      description: form.description,
      maxDeliveryRadiusKm: Number(form.maxDeliveryRadiusKm),
      coverageAreas: form.coverageAreasText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      baseDeliveryFeeNaira: Number(form.baseDeliveryFeeNaira),
      perKmDeliveryFeeNaira: Number(form.perKmDeliveryFeeNaira),
      estimatedPrepMins: Number(form.estimatedPrepMins),
      status: form.status,
      featured: form.featured,
      isOpenNow: form.isOpenNow,
    };
    try {
      if (editingId) {
        await apiRequest(`/api/admin/retailers/${editingId}`, { method: 'PATCH', body: payload });
        onFlash(`Retailer "${form.businessName}" updated.`);
      } else {
        await apiRequest('/api/admin/retailers', { method: 'POST', body: payload });
        onFlash(`Retailer "${form.businessName}" registered centrally (no retailer login created).`);
      }
      setShowForm(false);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleQuickStatus = async (r: AdminRetailerRow, status: string) => {
    try {
      await apiRequest(`/api/admin/retailers/${r.id}`, {
        method: 'PATCH',
        body: { status, isOpenNow: status === 'APPROVED_ACTIVE' },
      });
      onFlash(`${r.business_name} status changed to ${status.replace(/_/g, ' ')}.`);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleDelete = async (r: AdminRetailerRow) => {
    if (!window.confirm(`Remove or suspend ${r.business_name}?`)) return;
    try {
      const res = await apiRequest<{ message?: string }>(`/api/admin/retailers/${r.id}`, { method: 'DELETE' });
      onFlash(res.message || `${r.business_name} removed.`);
      onReload();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const states = ['ALL', ...Array.from(new Set(retailers.map((r) => r.state)))];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#06265B]">
            Centralized Retailer Management & Coverage Map
          </h2>
          <p className="text-xs text-[#64748B]">
            Retailers do not have accounts or logins. Only <strong>Approved & Active</strong> retailers appear on the
            public customer map.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-white"
          >
            {states.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? 'All States' : s}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-2 text-xs font-semibold border border-[#E2E8F0] rounded-lg bg-white"
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED_ACTIVE">Approved Active</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button
            type="button"
            onClick={openCreateForm}
            className="px-3.5 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Register Gas Retailer
          </button>
        </div>
      </div>

      {/* Interactive Admin Coverage Map */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[#06265B] inline-flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-[#073B8C]" />
            Network Coverage & Radius Visualization ({filtered.length} depots)
          </span>
          {showForm && (
            <span className="text-[#16834A] font-semibold inline-flex items-center gap-1">
              <Crosshair className="w-3.5 h-3.5" /> Click anywhere on the map to set GPS coordinates in the form below
            </span>
          )}
        </div>
        <AdminRetailerMap
          retailers={filtered}
          selectedId={selectedId}
          pickCoords={showForm ? { lat: form.lat, lng: form.lng } : null}
          onSelectRetailer={(r) => setSelectedId(r.id)}
          onMapPickCoords={(lat, lng) => {
            if (showForm) {
              setForm((prev) => ({ ...prev, lat, lng }));
            }
          }}
          heightClass="h-[360px]"
        />
      </div>

      {/* Register / Edit Retailer Form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="bg-white border-2 border-[#073B8C] rounded-xl p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
            <h3 className="text-sm font-extrabold text-[#06265B]">
              {editingId ? 'Edit Registered Gas Retailer' : 'Register New Cooking Gas Retailer (Admin-Managed)'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-[#64748B] font-bold hover:text-[#172B4D]"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold mb-1">Business Name *</label>
              <input
                required
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                placeholder="e.g. Festac CleanGas Depot"
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Contact Person *</label>
              <input
                required
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Phone Number *</label>
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold mb-1">Physical Street Address *</label>
              <input
                required
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Email (Optional)</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Neighbourhood *</label>
              <input
                required
                value={form.neighbourhood}
                onChange={(e) => setForm({ ...form, neighbourhood: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">City *</label>
              <input
                required
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">State *</label>
              <input
                required
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Latitude (Click Map to Set)</label>
              <input
                type="number"
                step="0.0001"
                required
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Longitude (Click Map to Set)</label>
              <input
                type="number"
                step="0.0001"
                required
                value={form.lng}
                onChange={(e) => setForm({ ...form, lng: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Max Delivery Radius (km)</label>
              <input
                type="number"
                step="0.5"
                min={1}
                max={60}
                required
                value={form.maxDeliveryRadiusKm}
                onChange={(e) => setForm({ ...form, maxDeliveryRadiusKm: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block font-semibold mb-1">
                Served Delivery Neighbourhoods / Towns (Comma-separated)
              </label>
              <input
                value={form.coverageAreasText}
                onChange={(e) => setForm({ ...form, coverageAreasText: e.target.value })}
                placeholder="Lekki Phase 1, Victoria Island, Ikoyi, Oniru"
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Base Delivery Fee (₦)</label>
              <input
                type="number"
                min={0}
                required
                value={form.baseDeliveryFeeNaira}
                onChange={(e) => setForm({ ...form, baseDeliveryFeeNaira: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Per-km Fee (₦)</label>
              <input
                type="number"
                min={0}
                required
                value={form.perKmDeliveryFeeNaira}
                onChange={(e) => setForm({ ...form, perKmDeliveryFeeNaira: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Approval Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC] font-semibold"
              >
                <option value="APPROVED_ACTIVE">Approved & Active (Visible to Customers)</option>
                <option value="PENDING_APPROVAL">Pending Approval (Hidden)</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <label className="block font-semibold mb-1">Business Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={form.isOpenNow}
                  onChange={(e) => setForm({ ...form, isOpenNow: e.target.checked })}
                />
                Currently Open
              </label>
              <label className="inline-flex items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                />
                Feature on Homepage
              </label>
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white font-bold"
            >
              {editingId ? 'Save Retailer Updates' : 'Register Retailer'}
            </button>
          </div>
        </form>
      )}

      {/* Retailers Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                <th className="py-3 px-4 font-bold">Retailer & Contact</th>
                <th className="py-3 px-4 font-bold">Location & Coverage</th>
                <th className="py-3 px-4 font-bold">Delivery Fees</th>
                <th className="py-3 px-4 font-bold">Products / Orders</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filtered.map((r) => (
                <tr key={r.id} className={selectedId === r.id ? 'bg-[#EAF3FF]/40' : 'hover:bg-[#F7F9FC]'}>
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#06265B]">{r.business_name}</div>
                    <div className="text-[11px] text-[#64748B]">
                      {r.contact_person} · {r.phone}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-[#172B4D] font-medium">
                      {r.neighbourhood}, {r.city} ({r.state})
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Radius: {r.max_delivery_radius_km} km · GPS: {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    </div>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    <div>Base: {formatNaira(r.base_delivery_fee_kobo)}</div>
                    <div className="text-[11px] text-[#64748B]">+{formatNaira(r.per_km_delivery_fee_kobo)}/km</div>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    <div className="font-bold text-[#073B8C]">{r.active_products_count} active SKUs</div>
                    <div className="text-[11px] text-[#64748B]">{r.total_orders} orders</div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditForm(r)}
                        title="Edit Retailer"
                        className="p-1.5 rounded border border-[#E2E8F0] hover:border-[#073B8C] text-[#073B8C]"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {r.status !== 'APPROVED_ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => void handleQuickStatus(r, 'APPROVED_ACTIVE')}
                          title="Approve & Activate on Customer Map"
                          className="p-1.5 rounded border border-[#BBF7D0] bg-[#ECFDF3] text-[#16834A]"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleQuickStatus(r, 'SUSPENDED')}
                          title="Suspend Retailer"
                          className="p-1.5 rounded border border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]"
                        >
                          <PauseCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(r)}
                        title="Delete or Suspend"
                        className="p-1.5 rounded border border-[#FECACA] text-[#D64545]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
