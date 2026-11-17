import { Router } from 'express';
import { getDb } from '../db/database.js';
import { checkRetailerCoverage, parseCoverageAreas } from '../services/geo.js';
import { getPlatformSettings } from '../services/payment.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

interface RetailerRow {
  id: number;
  business_name: string;
  slug: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  neighbourhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  logo_url: string;
  cover_image_url: string;
  description: string;
  operating_hours_json: string;
  is_open_now: number;
  max_delivery_radius_km: number;
  coverage_areas_json: string;
  base_delivery_fee_kobo: number;
  per_km_delivery_fee_kobo: number;
  estimated_prep_mins: number;
  status: string;
  rating_avg: number;
  review_count: number;
  featured: number;
}

interface RetailerProductPublic {
  retailer_product_id: number;
  retailer_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  category_name: string;
  category_type: string;
  size_kg: number | null;
  unit_label: string;
  description: string;
  image_url: string;
  selling_price_kobo: number;
  stock_quantity: number;
  is_available: number;
}

async function getCommercialFeeConfig() {
  const settings = await getPlatformSettings();
  const fees = (settings.commercial_fees || {}) as {
    serviceFeePercent?: number;
    minServiceFeeKobo?: number;
    maxServiceFeeKobo?: number;
  };
  return {
    serviceFeePercent: fees.serviceFeePercent ?? 2.0,
    minServiceFeeKobo: fees.minServiceFeeKobo ?? 20000,
    maxServiceFeeKobo: fees.maxServiceFeeKobo ?? 150000,
  };
}

export async function calculateServiceFeeKobo(subtotalKobo: number): Promise<number> {
  const cfg = await getCommercialFeeConfig();
  const raw = Math.round((subtotalKobo * cfg.serviceFeePercent) / 100);
  const clamped = Math.max(cfg.minServiceFeeKobo, Math.min(cfg.maxServiceFeeKobo, raw));
  return Math.round(clamped / 500) * 500;
}

async function enrichRetailersWithProducts(
  retailers: RetailerRow[],
  target?: { lat: number; lng: number; neighbourhood?: string; city?: string; state?: string }
) {
  const db = getDb();
  if (retailers.length === 0) return [];
  const ids = retailers.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  // Strictly exclude retailer_supply_cost_kobo from public queries
  const allProducts = await db.all<RetailerProductPublic>(
    `
    SELECT
      rp.id as retailer_product_id,
      rp.retailer_id,
      rp.product_id,
      p.name as product_name,
      p.slug as product_slug,
      pc.name as category_name,
      pc.type as category_type,
      p.size_kg,
      p.unit_label,
      p.description,
      p.image_url,
      rp.selling_price_kobo,
      rp.stock_quantity,
      rp.is_available
    FROM retailer_products rp
    JOIN products p ON p.id = rp.product_id
    JOIN product_categories pc ON pc.id = p.category_id
    WHERE rp.retailer_id IN (${placeholders}) AND p.is_active = 1
    ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
  `,
    ...ids
  );

  const byRetailer = new Map<number, RetailerProductPublic[]>();
  for (const prod of allProducts) {
    const rid = Number(prod.retailer_id);
    const normalizedProd: RetailerProductPublic = {
      ...prod,
      retailer_product_id: Number(prod.retailer_product_id),
      retailer_id: rid,
      product_id: Number(prod.product_id),
      size_kg: prod.size_kg !== null ? Number(prod.size_kg) : null,
      selling_price_kobo: Number(prod.selling_price_kobo),
      stock_quantity: Number(prod.stock_quantity),
      is_available: Number(prod.is_available),
    };
    const arr = byRetailer.get(rid) || [];
    arr.push(normalizedProd);
    byRetailer.set(rid, arr);
  }

  return retailers.map((r) => {
    const rid = Number(r.id);
    const normR = {
      ...r,
      id: rid,
      lat: Number(r.lat),
      lng: Number(r.lng),
      max_delivery_radius_km: Number(r.max_delivery_radius_km),
      base_delivery_fee_kobo: Number(r.base_delivery_fee_kobo),
      per_km_delivery_fee_kobo: Number(r.per_km_delivery_fee_kobo),
      estimated_prep_mins: Number(r.estimated_prep_mins),
      rating_avg: Number(r.rating_avg),
      review_count: Number(r.review_count),
    };
    const products = byRetailer.get(rid) || [];
    const availableProducts = products.filter((p) => p.is_available === 1 && p.stock_quantity > 0);
    const refill12 = availableProducts.find((p) => p.size_kg === 12.5 && p.category_type === 'GAS_REFILL');
    const refill5 = availableProducts.find((p) => p.size_kg === 5 && p.category_type === 'GAS_REFILL');
    const refill6 = availableProducts.find((p) => p.size_kg === 6 && p.category_type === 'GAS_REFILL');
    const minRefillPriceKobo = availableProducts
      .filter((p) => p.category_type === 'GAS_REFILL')
      .reduce((min, p) => (min === 0 || p.selling_price_kobo < min ? p.selling_price_kobo : min), 0);

    const coverage = target
      ? checkRetailerCoverage(normR, target)
      : {
          canDeliver: true,
          distanceKm: 0,
          reason: `Serves up to ${normR.max_delivery_radius_km} km radius in ${normR.city}`,
          deliveryFeeKobo: normR.base_delivery_fee_kobo,
          estimatedDeliveryMins: normR.estimated_prep_mins + 14,
        };

    let operatingHours = {};
    try {
      operatingHours = JSON.parse(r.operating_hours_json || '{}');
    } catch {
      operatingHours = {};
    }

    return {
      id: normR.id,
      business_name: r.business_name,
      slug: r.slug,
      phone: r.phone,
      address: r.address,
      neighbourhood: r.neighbourhood,
      city: r.city,
      state: r.state,
      lat: normR.lat,
      lng: normR.lng,
      logo_url: r.logo_url,
      cover_image_url: r.cover_image_url,
      description: r.description,
      operating_hours: operatingHours,
      is_open_now: Number(r.is_open_now) === 1,
      max_delivery_radius_km: normR.max_delivery_radius_km,
      coverage_areas: parseCoverageAreas(r.coverage_areas_json),
      base_delivery_fee_kobo: normR.base_delivery_fee_kobo,
      per_km_delivery_fee_kobo: normR.per_km_delivery_fee_kobo,
      estimated_prep_mins: normR.estimated_prep_mins,
      rating_avg: normR.rating_avg,
      review_count: normR.review_count,
      featured: Number(r.featured) === 1,
      coverage,
      highlights: {
        price_5kg_kobo: refill5?.selling_price_kobo ?? null,
        price_6kg_kobo: refill6?.selling_price_kobo ?? null,
        price_12_5kg_kobo: refill12?.selling_price_kobo ?? null,
        min_refill_price_kobo: minRefillPriceKobo || null,
        available_product_count: availableProducts.length,
      },
      products,
    };
  });
}

router.get(
  '/homepage',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const settings = await getPlatformSettings();
    const lat = req.query.lat ? Number(req.query.lat) : 5.0198;
    const lng = req.query.lng ? Number(req.query.lng) : 7.9462;
    const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : 'Ewet Housing';
    const city = typeof req.query.city === 'string' ? req.query.city : 'Uyo';

    const approvedRetailers = await db.all<RetailerRow>(
      "SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE' ORDER BY featured DESC, rating_avg DESC"
    );

    const enriched = await enrichRetailersWithProducts(approvedRetailers, { lat, lng, neighbourhood, city });

    const popularSizes = await db.all(
      `
      SELECT
        p.id, p.name, p.slug, p.size_kg, p.unit_label, p.description, p.image_url,
        pc.name as category_name, pc.type as category_type,
        MIN(rp.selling_price_kobo) as min_price_kobo,
        MAX(rp.selling_price_kobo) as max_price_kobo,
        COUNT(DISTINCT rp.retailer_id) as retailer_count
      FROM products p
      JOIN product_categories pc ON pc.id = p.category_id
      JOIN retailer_products rp ON rp.product_id = p.id AND rp.is_available = 1 AND rp.stock_quantity > 0
      JOIN retailers r ON r.id = rp.retailer_id AND r.status = 'APPROVED_ACTIVE'
      WHERE p.is_active = 1
      GROUP BY p.id, pc.id, pc.name, pc.type, pc.sort_order
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `
    );

    const deliveredRow = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM orders WHERE status = 'DELIVERED'");
    const uniqueAreas = new Set<string>();
    for (const r of approvedRetailers) {
      for (const a of parseCoverageAreas(r.coverage_areas_json)) uniqueAreas.add(a);
    }

    const stats = {
      approvedRetailers: approvedRetailers.length,
      citiesCovered: uniqueAreas.size,
      completedDeliveries: Number(deliveredRow?.cnt || 0) + 1240,
      avgDeliveryMins: 26,
    };

    const today = new Date().toISOString().slice(0, 10);
    const activePromotions = await db.all(
      'SELECT code, title, description, discount_type, discount_value, min_order_kobo FROM promotions WHERE is_active = 1 AND ? <= valid_until',
      today
    );

    res.json({
      cms: settings.homepage_cms || {},
      fees: settings.commercial_fees || {},
      cancellationPolicy: settings.cancellation_policy || {},
      stats,
      retailers: enriched,
      featuredRetailers: enriched.filter((r) => r.featured).slice(0, 4),
      popularProducts: popularSizes,
      promotions: activePromotions,
    });
  })
);

router.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const categories = await db.all('SELECT * FROM product_categories WHERE is_active = 1 ORDER BY sort_order ASC');
    const products = await db.all(
      `
      SELECT p.*, pc.name as category_name, pc.type as category_type
      FROM products p
      JOIN product_categories pc ON pc.id = p.category_id
      WHERE p.is_active = 1
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `
    );
    res.json({ categories, products });
  })
);

router.get(
  '/retailers',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const sizeKg = req.query.sizeKg ? Number(req.query.sizeKg) : undefined;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const openOnly = req.query.openOnly === 'true';
    const inStockOnly = req.query.inStockOnly === 'true';
    const deliverableOnly = req.query.deliverableOnly === 'true';
    const maxEta = req.query.maxEta ? Number(req.query.maxEta) : undefined;
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'nearest';

    const north = req.query.north !== undefined ? Number(req.query.north) : undefined;
    const south = req.query.south !== undefined ? Number(req.query.south) : undefined;
    const east = req.query.east !== undefined ? Number(req.query.east) : undefined;
    const west = req.query.west !== undefined ? Number(req.query.west) : undefined;

    let rows = await db.all<RetailerRow>("SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE'");

    if (
      north !== undefined &&
      south !== undefined &&
      east !== undefined &&
      west !== undefined &&
      !Number.isNaN(north)
    ) {
      rows = rows.filter(
        (r) => Number(r.lat) <= north && Number(r.lat) >= south && Number(r.lng) <= east && Number(r.lng) >= west
      );
    }

    if (state && state !== 'ALL') {
      rows = rows.filter((r) => r.state.toLowerCase() === state.toLowerCase());
    }

    let enriched = await enrichRetailersWithProducts(
      rows,
      lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)
        ? { lat, lng, neighbourhood, city, state }
        : undefined
    );

    if (search) {
      enriched = enriched.filter((r) => {
        return (
          r.business_name.toLowerCase().includes(search) ||
          r.address.toLowerCase().includes(search) ||
          r.neighbourhood.toLowerCase().includes(search) ||
          r.city.toLowerCase().includes(search) ||
          r.state.toLowerCase().includes(search) ||
          r.coverage_areas.some((a) => a.toLowerCase().includes(search)) ||
          r.products.some((p) => p.product_name.toLowerCase().includes(search))
        );
      });
    }

    if (openOnly) {
      enriched = enriched.filter((r) => r.is_open_now);
    }

    if (sizeKg) {
      enriched = enriched.filter((r) =>
        r.products.some(
          (p) =>
            p.category_type === 'GAS_REFILL' &&
            p.size_kg === sizeKg &&
            (!inStockOnly || (p.is_available === 1 && p.stock_quantity > 0))
        )
      );
    }

    if (productId) {
      enriched = enriched.filter((r) =>
        r.products.some(
          (p) => p.product_id === productId && (!inStockOnly || (p.is_available === 1 && p.stock_quantity > 0))
        )
      );
    } else if (inStockOnly) {
      enriched = enriched.filter((r) => r.highlights.available_product_count > 0);
    }

    if (deliverableOnly) {
      enriched = enriched.filter((r) => r.coverage.canDeliver);
    }

    if (maxEta && !Number.isNaN(maxEta)) {
      enriched = enriched.filter((r) => r.coverage.estimatedDeliveryMins <= maxEta);
    }

    enriched.sort((a, b) => {
      if (lat !== undefined && a.coverage.canDeliver !== b.coverage.canDeliver) {
        return a.coverage.canDeliver ? -1 : 1;
      }
      if (sortBy === 'lowest_price') {
        const getTargetPrice = (r: (typeof enriched)[number]) => {
          if (productId) {
            return r.products.find((p) => p.product_id === productId)?.selling_price_kobo ?? Number.MAX_SAFE_INTEGER;
          }
          if (sizeKg) {
            return (
              r.products.find((p) => p.category_type === 'GAS_REFILL' && p.size_kg === sizeKg)?.selling_price_kobo ??
              Number.MAX_SAFE_INTEGER
            );
          }
          return r.highlights.price_12_5kg_kobo ?? r.highlights.min_refill_price_kobo ?? Number.MAX_SAFE_INTEGER;
        };
        return getTargetPrice(a) - getTargetPrice(b);
      }
      if (sortBy === 'lowest_delivery') {
        return a.coverage.deliveryFeeKobo - b.coverage.deliveryFeeKobo;
      }
      if (sortBy === 'highest_rated') {
        return b.rating_avg - a.rating_avg;
      }
      if (sortBy === 'fastest') {
        return a.coverage.estimatedDeliveryMins - b.coverage.estimatedDeliveryMins;
      }
      return a.coverage.distanceKm - b.coverage.distanceKm;
    });

    res.json({ retailers: enriched, total: enriched.length });
  })
);

router.get(
  '/retailers/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const idOrSlug = req.params.id;
    const row = await db.get<RetailerRow>(
      "SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE' AND (id = ? OR slug = ?)",
      Number(idOrSlug) || -1,
      idOrSlug
    );

    if (!row) {
      res.status(404).json({ error: 'Retailer not found or currently unavailable.' });
      return;
    }

    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;

    const [retailer] = await enrichRetailersWithProducts(
      [row],
      lat !== undefined && lng !== undefined ? { lat, lng, neighbourhood, city } : undefined
    );

    const reviews = await db.all(
      `
      SELECT rv.id, rv.retailer_rating, rv.dispatcher_rating, rv.comment, rv.created_at,
             u.full_name as customer_name
      FROM reviews rv
      JOIN users u ON u.id = rv.customer_id
      WHERE rv.retailer_id = ? AND rv.is_visible = 1
      ORDER BY rv.created_at DESC
      LIMIT 30
    `,
      row.id
    );

    res.json({ retailer, reviews });
  })
);

router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const lat = req.query.lat ? Number(req.query.lat) : 5.0198;
    const lng = req.query.lng ? Number(req.query.lng) : 7.9462;
    const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : '';
    const city = typeof req.query.city === 'string' ? req.query.city : '';
    const sizeKg = req.query.sizeKg ? Number(req.query.sizeKg) : 12.5;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;

    const rows = await db.all<RetailerRow>("SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE'");
    const enriched = await enrichRetailersWithProducts(rows, { lat, lng, neighbourhood, city });

    const comparisonRaw = await Promise.all(
      enriched.map(async (r) => {
        const prod = productId
          ? r.products.find((p) => p.product_id === productId)
          : r.products.find((p) => p.category_type === 'GAS_REFILL' && p.size_kg === sizeKg);
        if (!prod) return null;
        const serviceFeeKobo = await calculateServiceFeeKobo(prod.selling_price_kobo);
        const landedTotalKobo = prod.selling_price_kobo + r.coverage.deliveryFeeKobo + serviceFeeKobo;
        return {
          retailerId: r.id,
          retailerSlug: r.slug,
          businessName: r.business_name,
          address: r.address,
          neighbourhood: r.neighbourhood,
          city: r.city,
          state: r.state,
          isOpenNow: r.is_open_now,
          ratingAvg: r.rating_avg,
          reviewCount: r.review_count,
          canDeliver: r.coverage.canDeliver,
          coverageReason: r.coverage.reason,
          distanceKm: r.coverage.distanceKm,
          estimatedDeliveryMins: r.coverage.estimatedDeliveryMins,
          product: {
            retailerProductId: prod.retailer_product_id,
            productId: prod.product_id,
            name: prod.product_name,
            unitLabel: prod.unit_label,
            sellingPriceKobo: prod.selling_price_kobo,
            stockQuantity: prod.stock_quantity,
            isAvailable: prod.is_available === 1 && prod.stock_quantity > 0,
          },
          deliveryFeeKobo: r.coverage.deliveryFeeKobo,
          serviceFeeKobo,
          landedTotalKobo,
        };
      })
    );

    const comparison = comparisonRaw
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (a.canDeliver !== b.canDeliver) return a.canDeliver ? -1 : 1;
        return a.landedTotalKobo - b.landedTotalKobo;
      });

    res.json({ comparison, sizeKg, productId: productId || null });
  })
);

router.post(
  '/coverage-check',
  asyncHandler(async (req, res) => {
    const { retailerId, lat, lng, neighbourhood, city, state } = req.body || {};
    const db = getDb();
    const retailer = await db.get<RetailerRow>(
      "SELECT * FROM retailers WHERE id = ? AND status = 'APPROVED_ACTIVE'",
      Number(retailerId)
    );

    if (!retailer) {
      res.status(404).json({ error: 'Retailer not found or inactive.' });
      return;
    }
    const coverage = checkRetailerCoverage(
      {
        ...retailer,
        lat: Number(retailer.lat),
        lng: Number(retailer.lng),
        max_delivery_radius_km: Number(retailer.max_delivery_radius_km),
        base_delivery_fee_kobo: Number(retailer.base_delivery_fee_kobo),
        per_km_delivery_fee_kobo: Number(retailer.per_km_delivery_fee_kobo),
        estimated_prep_mins: Number(retailer.estimated_prep_mins),
      },
      {
        lat: Number(lat),
        lng: Number(lng),
        neighbourhood,
        city,
        state,
      }
    );
    res.json({
      retailerId: Number(retailer.id),
      businessName: retailer.business_name,
      retailerAddress: retailer.address,
      maxDeliveryRadiusKm: Number(retailer.max_delivery_radius_km),
      coverageAreas: parseCoverageAreas(retailer.coverage_areas_json),
      coverage,
    });
  })
);

router.post(
  '/promo/validate',
  asyncHandler(async (req, res) => {
    const { code, subtotalKobo } = req.body || {};
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Promo code is required.' });
      return;
    }
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const promo = await db.get<{
      code: string;
      title: string;
      discount_type: 'FIXED' | 'PERCENT';
      discount_value: number;
      min_order_kobo: number;
      max_discount_kobo: number;
      usage_limit: number;
      used_count: number;
    }>(
      'SELECT * FROM promotions WHERE LOWER(code) = LOWER(?) AND is_active = 1 AND ? >= valid_from AND ? <= valid_until',
      code.trim().toUpperCase(),
      today,
      today
    );

    if (!promo) {
      res.status(404).json({ error: 'Promo code is invalid or has expired.' });
      return;
    }
    if (Number(promo.used_count) >= Number(promo.usage_limit)) {
      res.status(400).json({ error: 'Promo code usage limit has been reached.' });
      return;
    }
    const sub = Number(subtotalKobo) || 0;
    const minOrder = Number(promo.min_order_kobo);
    if (sub < minOrder) {
      res.status(400).json({
        error: `Minimum order of ₦${(minOrder / 100).toLocaleString()} required for code ${promo.code}.`,
      });
      return;
    }
    const val = Number(promo.discount_value);
    const maxDisc = Number(promo.max_discount_kobo);
    const discountKobo =
      promo.discount_type === 'FIXED'
        ? Math.min(val, maxDisc, sub)
        : Math.min(Math.round((sub * val) / 100), maxDisc, sub);

    res.json({
      valid: true,
      code: promo.code,
      title: promo.title,
      discountKobo,
    });
  })
);

export default router;
