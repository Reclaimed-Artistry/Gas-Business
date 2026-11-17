import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Tag } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import type { AdminRetailerRow } from './AdminRetailersPanel';

interface CategoryRow {
  id: number;
  name: string;
  type: string;
}

interface ProductRow {
  id: number;
  category_id: number;
  category_name: string;
  category_type: string;
  name: string;
  size_kg: number | null;
  unit_label: string;
  description: string;
  image_url: string;
  is_active: number;
  assigned_retailers_count: number;
}

interface RetailerSkuRow {
  id: number;
  retailer_id: number;
  product_id: number;
  product_name: string;
  category_name: string;
  unit_label: string;
  selling_price_kobo: number;
  retailer_supply_cost_kobo: number;
  stock_quantity: number;
  is_available: number;
}

export function AdminPricingPanel({
  retailers,
  onFlash,
  onError,
}: {
  retailers: AdminRetailerRow[];
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<number>(retailers[0]?.id || 1);
  const [retailerSkus, setRetailerSkus] = useState<RetailerSkuRow[]>([]);

  // New global product form
  const [showNewProd, setShowNewProd] = useState(false);
  const [newProd, setNewProd] = useState({
    categoryId: 1,
    name: '',
    sizeKg: '',
    unitLabel: '',
    description: '',
    imageUrl: '/images/prod-refill-12-5kg.jpg',
  });

  // Assign / update pricing for retailer
  const [assignProductId, setAssignProductId] = useState<number>(0);
  const [sellNaira, setSellNaira] = useState('14800');
  const [supplyNaira, setSupplyNaira] = useState('13500');
  const [stockQty, setStockQty] = useState('35');
  const [isAvail, setIsAvail] = useState(true);

  const loadCatalog = async () => {
    const res = await apiRequest<{ categories: CategoryRow[]; products: ProductRow[] }>('/api/admin/products');
    setCategories(res.categories);
    setProducts(res.products);
    if (res.products.length > 0 && !assignProductId) {
      setAssignProductId(res.products[0].id);
    }
  };

  const loadRetailerSkus = async (rid: number) => {
    const res = await apiRequest<{ items: RetailerSkuRow[] }>(`/api/admin/retailers/${rid}/products`);
    setRetailerSkus(res.items);
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (retailers.length > 0 && !retailers.some((r) => r.id === selectedRetailerId)) {
      setSelectedRetailerId(retailers[0].id);
    }
  }, [retailers, selectedRetailerId]);

  useEffect(() => {
    if (selectedRetailerId) {
      void loadRetailerSkus(selectedRetailerId);
    }
  }, [selectedRetailerId]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/products', {
        method: 'POST',
        body: {
          categoryId: Number(newProd.categoryId),
          name: newProd.name,
          sizeKg: newProd.sizeKg ? Number(newProd.sizeKg) : null,
          unitLabel: newProd.unitLabel,
          description: newProd.description,
          imageUrl: newProd.imageUrl,
        },
      });
      setShowNewProd(false);
      setNewProd({
        categoryId: categories[0]?.id || 1,
        name: '',
        sizeKg: '',
        unitLabel: '',
        description: '',
        imageUrl: '/images/prod-refill-12-5kg.jpg',
      });
      onFlash('Product added to central catalog.');
      void loadCatalog();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleSaveRetailerPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/admin/retailers/${selectedRetailerId}/products`, {
        method: 'PUT',
        body: {
          productId: Number(assignProductId),
          sellingPriceNaira: Number(sellNaira),
          retailerSupplyCostNaira: Number(supplyNaira),
          stockQuantity: Number(stockQty),
          isAvailable: isAvail,
        },
      });
      onFlash('Independent retailer price, supply cost, and stock updated.');
      void loadRetailerSkus(selectedRetailerId);
      void loadCatalog();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const handleInlineQuickUpdate = async (sku: RetailerSkuRow, deltaSellNaira: number, toggleAvail?: boolean) => {
    const nextSell = Math.max(500, Math.round(sku.selling_price_kobo / 100) + deltaSellNaira);
    const nextAvail = toggleAvail !== undefined ? toggleAvail : sku.is_available === 1;
    try {
      await apiRequest(`/api/admin/retailers/${selectedRetailerId}/products`, {
        method: 'PUT',
        body: {
          productId: sku.product_id,
          sellingPriceNaira: nextSell,
          retailerSupplyCostNaira: Math.round(sku.retailer_supply_cost_kobo / 100),
          stockQuantity: sku.stock_quantity,
          isAvailable: nextAvail,
        },
      });
      onFlash(`Updated ${sku.product_name} for selected retailer.`);
      void loadRetailerSkus(selectedRetailerId);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const selectedRetailer = retailers.find((r) => r.id === selectedRetailerId);
  const marginPreview = Number(sellNaira) - Number(supplyNaira);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#06265B]">
            Product Catalog & Independent Per-Retailer Pricing
          </h2>
          <p className="text-xs text-[#64748B]">
            Set different customer selling prices, agreed retailer supply payouts, and live stock per depot.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewProd((s) => !s)}
          className="px-3.5 py-2 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white text-xs font-bold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add Master Product
        </button>
      </div>

      {showNewProd && (
        <form
          onSubmit={handleCreateProduct}
          className="bg-white border-2 border-[#073B8C] rounded-xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"
        >
          <div className="sm:col-span-3 font-extrabold text-sm text-[#06265B]">Add Product to Master Catalog</div>
          <div>
            <label className="block font-semibold mb-1">Category</label>
            <select
              value={newProd.categoryId}
              onChange={(e) => setNewProd({ ...newProd, categoryId: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Product Name *</label>
            <input
              required
              value={newProd.name}
              onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
              placeholder="e.g. 15kg Commercial Gas Refill"
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Unit Label *</label>
            <input
              required
              value={newProd.unitLabel}
              onChange={(e) => setNewProd({ ...newProd, unitLabel: e.target.value })}
              placeholder="e.g. 15kg or 1 Unit"
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Size in kg (Optional)</label>
            <input
              type="number"
              step="0.5"
              value={newProd.sizeKg}
              onChange={(e) => setNewProd({ ...newProd, sizeKg: e.target.value })}
              placeholder="e.g. 15"
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Image Asset</label>
            <select
              value={newProd.imageUrl}
              onChange={(e) => setNewProd({ ...newProd, imageUrl: e.target.value })}
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
            >
              <option value="/images/prod-refill-3kg.jpg">Compact 3kg Refill</option>
              <option value="/images/prod-refill-6kg.jpg">Medium 6kg Refill</option>
              <option value="/images/prod-refill-12-5kg.jpg">Standard 12.5kg Refill</option>
              <option value="/images/prod-refill-25kg.jpg">Commercial 25kg Refill</option>
              <option value="/images/prod-refill-50kg.jpg">Industrial 50kg Refill</option>
              <option value="/images/prod-cylinder-12-5kg.webp">New 12.5kg Cylinder</option>
              <option value="/images/prod-regulator.jpg">High-Pressure Regulator</option>
              <option value="/images/prod-hose.jpg">Braided LPG Hose</option>
              <option value="/images/prod-burner.jpg">Camp Gas Burner</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Description</label>
            <input
              value={newProd.description}
              onChange={(e) => setNewProd({ ...newProd, description: e.target.value })}
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewProd(false)}
              className="px-3.5 py-2 rounded-lg border border-[#E2E8F0] font-bold"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#073B8C] text-white font-bold">
              Save Product
            </button>
          </div>
        </form>
      )}

      {/* Retailer Selector & Assign/Price Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#1769C2] mb-1">
              Select Retailer to Manage Pricing
            </label>
            <select
              value={selectedRetailerId}
              onChange={(e) => setSelectedRetailerId(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm font-bold text-[#06265B] border border-[#073B8C] rounded-lg bg-[#EAF3FF]/40"
            >
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.business_name} ({r.neighbourhood})
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={handleSaveRetailerPrice} className="space-y-3 border-t border-[#E2E8F0] pt-4">
            <div className="font-bold text-sm text-[#06265B] inline-flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-[#073B8C]" />
              Assign / Update Independent SKU Price
            </div>
            <div>
              <label className="block font-semibold mb-1">Master Product</label>
              <select
                value={assignProductId}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  setAssignProductId(pid);
                  const existing = retailerSkus.find((s) => s.product_id === pid);
                  if (existing) {
                    setSellNaira(String(Math.round(existing.selling_price_kobo / 100)));
                    setSupplyNaira(String(Math.round(existing.retailer_supply_cost_kobo / 100)));
                    setStockQty(String(existing.stock_quantity));
                    setIsAvail(existing.is_available === 1);
                  }
                }}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg bg-[#F7F9FC]"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category_name})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold mb-1">Customer Selling Price (₦)</label>
                <input
                  type="number"
                  required
                  min={100}
                  value={sellNaira}
                  onChange={(e) => setSellNaira(e.target.value)}
                  className="w-full px-3 py-2 font-bold tabular-nums border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Retailer Supply Cost (₦)</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={supplyNaira}
                  onChange={(e) => setSupplyNaira(e.target.value)}
                  className="w-full px-3 py-2 font-bold tabular-nums border border-[#E2E8F0] rounded-lg"
                />
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#F7F9FC] border border-[#E2E8F0] flex justify-between">
              <span className="text-[#64748B]">Platform Product Margin:</span>
              <span className={`font-extrabold tabular-nums ${marginPreview >= 0 ? 'text-[#16834A]' : 'text-[#D64545]'}`}>
                ₦{marginPreview.toLocaleString()} (
                {Number(sellNaira) > 0 ? ((marginPreview / Number(sellNaira)) * 100).toFixed(1) : '0'}%)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 items-center">
              <div>
                <label className="block font-semibold mb-1">Available Stock</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg"
                />
              </div>
              <label className="inline-flex items-center gap-2 font-semibold mt-4">
                <input type="checkbox" checked={isAvail} onChange={(e) => setIsAvail(e.target.checked)} />
                Available for Sale
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#073B8C] hover:bg-[#06265B] text-white font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Save className="w-4 h-4" /> Save Price & Stock
            </button>
          </form>
        </div>

        {/* Selected Retailer's Live Independent Pricing Table */}
        <div className="lg:col-span-8 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC] flex items-center justify-between text-xs">
            <span className="font-bold text-[#06265B]">
              Active Catalog for {selectedRetailer?.business_name} ({retailerSkus.length} SKUs)
            </span>
            <span className="text-[#64748B]">Customer price vs Admin-only supply payout</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F7F9FC] text-[#64748B]">
                  <th className="py-2.5 px-3 font-bold">Product</th>
                  <th className="py-2.5 px-3 font-bold text-right">Customer Price</th>
                  <th className="py-2.5 px-3 font-bold text-right">Supply Cost</th>
                  <th className="py-2.5 px-3 font-bold text-right">Margin</th>
                  <th className="py-2.5 px-3 font-bold text-center">Stock</th>
                  <th className="py-2.5 px-3 font-bold text-right">Quick Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {retailerSkus.map((sku) => {
                  const margin = sku.selling_price_kobo - sku.retailer_supply_cost_kobo;
                  return (
                    <tr key={sku.id} className="hover:bg-[#F7F9FC]">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-[#06265B]">{sku.product_name}</div>
                        <div className="text-[10px] text-[#64748B]">{sku.category_name}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-[#073B8C] tabular-nums">
                        {formatNaira(sku.selling_price_kobo)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#64748B] tabular-nums">
                        {formatNaira(sku.retailer_supply_cost_kobo)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#16834A] tabular-nums">
                        {formatNaira(margin)}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">
                        {sku.stock_quantity}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleInlineQuickUpdate(sku, -100)}
                            className="px-2 py-1 rounded border border-[#E2E8F0] hover:bg-[#EAF3FF] font-bold"
                            title="Reduce selling price by ₦100"
                          >
                            -₦100
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleInlineQuickUpdate(sku, 100)}
                            className="px-2 py-1 rounded border border-[#E2E8F0] hover:bg-[#EAF3FF] font-bold"
                            title="Increase selling price by ₦100"
                          >
                            +₦100
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleInlineQuickUpdate(sku, 0, sku.is_available !== 1)}
                            className={`px-2 py-1 rounded text-[10px] font-bold ${
                              sku.is_available === 1
                                ? 'bg-[#ECFDF3] text-[#16834A]'
                                : 'bg-[#FEF2F2] text-[#D64545]'
                            }`}
                          >
                            {sku.is_available === 1 ? 'Active' : 'Paused'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiRequest(
                                `/api/admin/retailers/${selectedRetailerId}/products/${sku.product_id}`,
                                { method: 'DELETE' }
                              );
                              void loadRetailerSkus(selectedRetailerId);
                            }}
                            className="p-1 text-[#64748B] hover:text-[#D64545]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
