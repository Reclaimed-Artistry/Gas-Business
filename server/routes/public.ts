import { Router } from 'express';
import { getDb } from '../db/database.js';
import { checkRetailerCoverage, parseCoverageAreas } from '../services/geo.js';
import { getPlatformSettings } from '../services/payment.js';

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

function getCommercialFeeConfig() {
  const settings = getPlatformSettings();
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

export function calculateServiceFeeKobo(subtotalKobo: number): number {
  const cfg = getCommercialFeeConfig();
  const raw = Math.round((subtotalKobo * cfg.serviceFeePercent) / 100);
  const clamped = Math.max(cfg.minServiceFeeKobo, Math.min(cfg.maxServiceFeeKobo, raw));
  return Math.round(clamped / 500) * 500;
}

function enrichRetailersWithProducts(
  retailers: RetailerRow[],
  target?: { lat: number; lng: number; neighbourhood?: string; city?: string; state?: string }
) {
  const db = getDb();
  if (retailers.length === 0) return [];
  const ids = retailers.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  // Strictly exclude retailer_supply_cost_kobo from public queries
  const allProducts = db
    .prepare(`
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
    `)
    .all(...ids) as unknown as RetailerProductPublic[];

  const byRetailer = new Map<number, RetailerProductPublic[]>();
  for (const prod of allProducts) {
    const arr = byRetailer.get(prod.retailer_id) || [];
    arr.push(prod);
    byRetailer.set(prod.retailer_id, arr);
  }

  return retailers.map((r) => {
    const products = byRetailer.get(r.id) || [];
    const availableProducts = products.filter((p) => p.is_available === 1 && p.stock_quantity > 0);
    const refill12 = availableProducts.find((p) => p.size_kg === 12.5 && p.category_type === 'GAS_REFILL');
    const refill5 = availableProducts.find((p) => p.size_kg === 5 && p.category_type === 'GAS_REFILL');
    const refill6 = availableProducts.find((p) => p.size_kg === 6 && p.category_type === 'GAS_REFILL');
    const minRefillPriceKobo = availableProducts
      .filter((p) => p.category_type === 'GAS_REFILL')
      .reduce((min, p) => (min === 0 || p.selling_price_kobo < min ? p.selling_price_kobo : min), 0);

    const coverage = target
      ? checkRetailerCoverage(r, target)
      : {
          canDeliver: true,
          distanceKm: 0,
          reason: `Serves up to ${r.max_delivery_radius_km} km radius`,
          deliveryFeeKobo: r.base_delivery_fee_kobo,
          estimatedDeliveryMins: r.estimated_prep_mins + 18,
        };

    let operatingHours = {};
    try {
      operatingHours = JSON.parse(r.operating_hours_json || '{}');
    } catch {
      operatingHours = {};
    }

    return {
      id: r.id,
      business_name: r.business_name,
      slug: r.slug,
      phone: r.phone,
      address: r.address,
      neighbourhood: r.neighbourhood,
      city: r.city,
      state: r.state,
      lat: r.lat,
      lng: r.lng,
      logo_url: r.logo_url,
      cover_image_url: r.cover_image_url,
      description: r.description,
      operating_hours: operatingHours,
      is_open_now: r.is_open_now === 1,
      max_delivery_radius_km: r.max_delivery_radius_km,
      coverage_areas: parseCoverageAreas(r.coverage_areas_json),
      base_delivery_fee_kobo: r.base_delivery_fee_kobo,
      per_km_delivery_fee_kobo: r.per_km_delivery_fee_kobo,
      estimated_prep_mins: r.estimated_prep_mins,
      rating_avg: r.rating_avg,
      review_count: r.review_count,
      featured: r.featured === 1,
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

router.get('/homepage', (req, res) => {
  const db = getDb();
  const settings = getPlatformSettings();
  const lat = req.query.lat ? Number(req.query.lat) : 6.4432;
  const lng = req.query.lng ? Number(req.query.lng) : 3.4658;
  const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : 'Lekki Phase 1';
  const city = typeof req.query.city === 'string' ? req.query.city : 'Lagos';

  const approvedRetailers = db
    .prepare("SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE' ORDER BY featured DESC, rating_avg DESC")
    .all() as unknown as RetailerRow[];

  const enriched = enrichRetailersWithProducts(approvedRetailers, { lat, lng, neighbourhood, city });

  // Popular gas sizes with lowest verified price across approved retailers
  const popularSizes = db
    .prepare(`
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
      GROUP BY p.id
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `)
    .all();

  const stats = {
    approvedRetailers: approvedRetailers.length,
    citiesCovered: new Set(approvedRetailers.map((r) => r.city)).size,
    completedDeliveries:
      (db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'DELIVERED'").get() as { cnt: number }).cnt + 1480,
    avgDeliveryMins: 32,
  };

  const activePromotions = db
    .prepare("SELECT code, title, description, discount_type, discount_value, min_order_kobo FROM promotions WHERE is_active = 1 AND date('now') <= date(valid_until)")
    .all();

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
});

router.get('/catalog', (_req, res) => {
  const db = getDb();
  const categories = db
    .prepare('SELECT * FROM product_categories WHERE is_active = 1 ORDER BY sort_order ASC')
    .all();
  const products = db
    .prepare(`
      SELECT p.*, pc.name as category_name, pc.type as category_type
      FROM products p
      JOIN product_categories pc ON pc.id = p.category_id
      WHERE p.is_active = 1
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `)
    .all();
  res.json({ categories, products });
});

router.get('/retailers', (req, res) => {
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

  // Optional map bounding box auto-filtering
  const north = req.query.north !== undefined ? Number(req.query.north) : undefined;
  const south = req.query.south !== undefined ? Number(req.query.south) : undefined;
  const east = req.query.east !== undefined ? Number(req.query.east) : undefined;
  const west = req.query.west !== undefined ? Number(req.query.west) : undefined;

  // MANDATORY RULE: Only APPROVED_ACTIVE retailers are ever visible to customers!
  let rows = db
    .prepare("SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE'")
    .all() as unknown as RetailerRow[];

  if (
    north !== undefined &&
    south !== undefined &&
    east !== undefined &&
    west !== undefined &&
    !Number.isNaN(north)
  ) {
    rows = rows.filter((r) => r.lat <= north && r.lat >= south && r.lng <= east && r.lng >= west);
  }

  if (state && state !== 'ALL') {
    rows = rows.filter((r) => r.state.toLowerCase() === state.toLowerCase());
  }

  let enriched = enrichRetailersWithProducts(
    rows,
    lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)
      ? { lat, lng, neighbourhood, city, state }
      : undefined
  );

  if (search) {
    enriched = enriched.filter((r) => {
      const textMatch =
        r.business_name.toLowerCase().includes(search) ||
        r.address.toLowerCase().includes(search) ||
        r.neighbourhood.toLowerCase().includes(search) ||
        r.city.toLowerCase().includes(search) ||
        r.state.toLowerCase().includes(search) ||
        r.coverage_areas.some((a) => a.toLowerCase().includes(search)) ||
        r.products.some((p) => p.product_name.toLowerCase().includes(search));
      return textMatch;
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

  // Sort according to user's selected filter
  enriched.sort((a, b) => {
    // Always float deliverable retailers first when user has a target location
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
    // default: nearest
    return a.coverage.distanceKm - b.coverage.distanceKm;
  });

  res.json({ retailers: enriched, total: enriched.length });
});

router.get('/retailers/:id', (req, res) => {
  const db = getDb();
  const idOrSlug = req.params.id;
  const row = db
    .prepare(
      "SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE' AND (id = ? OR slug = ?)"
    )
    .get(Number(idOrSlug) || -1, idOrSlug) as RetailerRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Retailer not found or currently unavailable.' });
    return;
  }

  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lng = req.query.lng ? Number(req.query.lng) : undefined;
  const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : undefined;
  const city = typeof req.query.city === 'string' ? req.query.city : undefined;

  const [retailer] = enrichRetailersWithProducts(
    [row],
    lat !== undefined && lng !== undefined ? { lat, lng, neighbourhood, city } : undefined
  );

  const reviews = db
    .prepare(`
      SELECT rv.id, rv.retailer_rating, rv.dispatcher_rating, rv.comment, rv.created_at,
             u.full_name as customer_name
      FROM reviews rv
      JOIN users u ON u.id = rv.customer_id
      WHERE rv.retailer_id = ? AND rv.is_visible = 1
      ORDER BY rv.created_at DESC
      LIMIT 30
    `)
    .all(row.id);

  res.json({ retailer, reviews });
});

router.get('/compare', (req, res) => {
  const db = getDb();
  const lat = req.query.lat ? Number(req.query.lat) : 6.4432;
  const lng = req.query.lng ? Number(req.query.lng) : 3.4658;
  const neighbourhood = typeof req.query.neighbourhood === 'string' ? req.query.neighbourhood : '';
  const city = typeof req.query.city === 'string' ? req.query.city : '';
  const sizeKg = req.query.sizeKg ? Number(req.query.sizeKg) : 12.5;
  const productId = req.query.productId ? Number(req.query.productId) : undefined;

  const rows = db
    .prepare("SELECT * FROM retailers WHERE status = 'APPROVED_ACTIVE'")
    .all() as unknown as RetailerRow[];

  const enriched = enrichRetailersWithProducts(rows, { lat, lng, neighbourhood, city });

  const comparison = enriched
    .map((r) => {
      const prod = productId
        ? r.products.find((p) => p.product_id === productId)
        : r.products.find((p) => p.category_type === 'GAS_REFILL' && p.size_kg === sizeKg);
      if (!prod) return null;
      const serviceFeeKobo = calculateServiceFeeKobo(prod.selling_price_kobo);
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
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.canDeliver !== b.canDeliver) return a.canDeliver ? -1 : 1;
      return a.landedTotalKobo - b.landedTotalKobo;
    });

  res.json({ comparison, sizeKg, productId: productId || null });
});

router.post('/coverage-check', (req, res) => {
  const { retailerId, lat, lng, neighbourhood, city, state } = req.body || {};
  const db = getDb();
  const retailer = db
    .prepare("SELECT * FROM retailers WHERE id = ? AND status = 'APPROVED_ACTIVE'")
    .get(Number(retailerId)) as RetailerRow | undefined;

  if (!retailer) {
    res.status(404).json({ error: 'Retailer not found or inactive.' });
    return;
  }
  const coverage = checkRetailerCoverage(retailer, {
    lat: Number(lat),
    lng: Number(lng),
    neighbourhood,
    city,
    state,
  });
  res.json({
    retailerId: retailer.id,
    businessName: retailer.business_name,
    retailerAddress: retailer.address,
    maxDeliveryRadiusKm: retailer.max_delivery_radius_km,
    coverageAreas: parseCoverageAreas(retailer.coverage_areas_json),
    coverage,
  });
});

router.post('/promo/validate', (req, res) => {
  const { code, subtotalKobo } = req.body || {};
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Promo code is required.' });
    return;
  }
  const db = getDb();
  const promo = db
    .prepare("SELECT * FROM promotions WHERE code = ? AND is_active = 1 AND date('now') BETWEEN date(valid_from) AND date(valid_until)")
    .get(code.trim().toUpperCase()) as
    | {
        code: string;
        title: string;
        discount_type: 'FIXED' | 'PERCENT';
        discount_value: number;
        min_order_kobo: number;
        max_discount_kobo: number;
        usage_limit: number;
        used_count: number;
      }
    | undefined;

  if (!promo) {
    res.status(404).json({ error: 'Promo code is invalid or has expired.' });
    return;
  }
  if (promo.used_count >= promo.usage_limit) {
    res.status(400).json({ error: 'Promo code usage limit has been reached.' });
    return;
  }
  const sub = Number(subtotalKobo) || 0;
  if (sub < promo.min_order_kobo) {
    res.status(400).json({
      error: `Minimum order of ₦${(promo.min_order_kobo / 100).toLocaleString()} required for code ${promo.code}.`,
    });
    return;
  }
  const discountKobo =
    promo.discount_type === 'FIXED'
      ? Math.min(promo.discount_value, promo.max_discount_kobo, sub)
      : Math.min(Math.round((sub * promo.discount_value) / 100), promo.max_discount_kobo, sub);

  res.json({
    valid: true,
    code: promo.code,
    title: promo.title,
    discountKobo,
  });
});

export default router;
