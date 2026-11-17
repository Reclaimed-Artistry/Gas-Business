import { getDb, runInTransaction } from './database.js';
import { hashPassword } from '../middleware/auth.js';

export async function seedDatabaseIfEmpty(): Promise<void> {
  const db = getDb();
  const row = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users');
  if (Number(row?.cnt || 0) > 0) {
    return;
  }

  await runInTransaction(async (tdb) => {
    // 1. Platform Settings & Uyo, Akwa Ibom Homepage CMS
    await tdb.run(
      'INSERT OR REPLACE INTO platform_settings (key, value_json) VALUES (?, ?)',
      'commercial_fees',
      JSON.stringify({
        serviceFeePercent: 2.0,
        minServiceFeeKobo: 20000,
        maxServiceFeeKobo: 150000,
        defaultBaseDeliveryFeeKobo: 85000,
        defaultPerKmDeliveryFeeKobo: 10000,
        defaultDispatcherBaseRateKobo: 75000,
        defaultDispatcherPerKmRateKobo: 7500,
        currency: 'NGN',
        cashOnDeliveryAllowed: false,
        primaryOperatingCity: 'Uyo',
        primaryOperatingState: 'Akwa Ibom',
      })
    );

    await tdb.run(
      'INSERT OR REPLACE INTO platform_settings (key, value_json) VALUES (?, ?)',
      'cancellation_policy',
      JSON.stringify({
        customerFreeCancelBeforeCollection: true,
        postCollectionRestockingFeePercent: 10,
        dispatcherFailedAttemptAllowanceKobo: 50000,
        defaultRefundDestination: 'WALLET',
        policySummary:
          'Orders cancelled before product collection receive a 100% refund to the BlueFlame Wallet. Orders cancelled after retailer collection may incur a 10% handling deduction to compensate dispatcher logistics.',
      })
    );

    await tdb.run(
      'INSERT OR REPLACE INTO platform_settings (key, value_json) VALUES (?, ?)',
      'homepage_cms',
      JSON.stringify({
        announcementBanner:
          'Now Live Across Uyo, Akwa Ibom State · 100% Cashless Verified Cooking Gas Delivery · Use code WELCOME500 for ₦500 off orders above ₦10,000',
        heroTitle: 'Compare Nearby Cooking Gas Prices in Uyo. Order & Track Fast Delivery.',
        heroSubtitle:
          'Discover vetted LPG retailers across Ewet Housing, Oron Road, Shelter Afrique, Ikot Ekpene Road, Abak Road & Nwaniba. Compare transparent gas refill prices, pay cashlessly online or via wallet, and track your Uyo dispatcher to your doorstep.',
        supportPhone: '+234 800 258 3352',
        supportEmail: 'support@blueflame.ng',
        supportHours: 'Daily, 6:30 AM – 9:30 PM WAT (Uyo Operations Desk)',
        faqs: [
          {
            question: 'Where does BlueFlame currently operate?',
            answer:
              'BlueFlame currently operates predominantly across Uyo, Akwa Ibom State — covering Ewet Housing, Shelter Afrique, Oron Road, Ikot Ekpene Road, Abak Road, Nwaniba, Osongama Estate, Aka Road, Itam, and Ring Road III. Our platform is built to expand to Eket, Ikot Ekpene, and more Nigerian cities as we grow.',
          },
          {
            question: 'How does BlueFlame guarantee accurate gas weight and pricing?',
            answer:
              'Every participating gas retailer in Uyo is vetted, registered, and centrally managed by our operations team. Product prices and digital-scale refill weights are verified and published transparently before you pay.',
          },
          {
            question: 'Can I pay cash on delivery to the dispatcher?',
            answer:
              'No. BlueFlame operates a strictly cashless electronic payment system for customer safety and transparent auditing. Pay instantly via your funded BlueFlame Digital Wallet or Paystack/Flutterwave (card, bank transfer, or USSD). Dispatchers never collect cash.',
          },
          {
            question: 'How do I sign in quickly?',
            answer:
              'You can sign in with Google in one tap or use your email and password. New Google sign-ins automatically set up a secure Customer account and BlueFlame Wallet ready for Uyo cooking gas orders.',
          },
          {
            question: 'What happens if a retailer runs out of stock or delivery fails?',
            answer:
              'Dispatchers report any collection or delivery issue directly to BlueFlame Uyo Operations. Our team either reassigns your order promptly or processes an audited refund directly to your BlueFlame Wallet.',
          },
        ],
        testimonials: [
          {
            name: 'Mrs. Mfoniso Ekpenyong',
            location: 'Ewet Housing Estate, Uyo',
            rating: 5,
            quote:
              'I compared three depots around Ewet Housing and Oron Road, saved ₦600 on my 12.5kg refill, paid from my wallet in seconds, and watched the dispatcher arrive in 24 minutes.',
          },
          {
            name: 'Engr. Aniekan Ukpong',
            location: 'Shelter Afrique, Uyo',
            rating: 5,
            quote:
              'Zero arguments about cash change or short-weighted cylinders. The electronic receipt, digital seal, and 4-digit delivery PIN make BlueFlame Uyo truly dependable.',
          },
          {
            name: 'Inemesit Okoro',
            location: 'Ikot Ekpene Road, Uyo',
            rating: 5,
            quote:
              'Ordered a 6kg refill and a replacement brass regulator near Uniuyo Town Campus. Clear pricing upfront and smooth cashless handover right at my gate.',
          },
        ],
      })
    );

    // 2. Users (Strictly CUSTOMER, DISPATCHER, ADMIN)
    const adminHash = hashPassword('Admin@BlueFlame2026');
    const customerHash = hashPassword('Customer@2026');
    const dispatcherHash = hashPassword('Dispatch@2026');

    const adminId = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('ADMIN', ?, ?, ?, ?, 'ACTIVE')`,
        'Iniobong Ekpo',
        'admin@blueflame.ng',
        '+234 809 100 0001',
        adminHash
      )
    ).lastInsertRowid;

    const c1 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')`,
        'Edidiong Udoh',
        'edidiong.udoh@example.com',
        '+234 803 412 8821',
        customerHash
      )
    ).lastInsertRowid;

    const c2 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')`,
        'Nsikak Akpan',
        'nsikak.akpan@example.com',
        '+234 805 771 3904',
        customerHash
      )
    ).lastInsertRowid;

    const c3 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')`,
        'Imaobong Bassey',
        'imaobong.bassey@example.com',
        '+234 812 904 1152',
        customerHash
      )
    ).lastInsertRowid;

    const d1 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('DISPATCHER', ?, ?, ?, ?, 'ACTIVE')`,
        'Ubong Etim',
        'ubong.dispatch@blueflame.ng',
        '+234 814 220 5510',
        dispatcherHash
      )
    ).lastInsertRowid;

    const d2 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('DISPATCHER', ?, ?, ?, ?, 'ACTIVE')`,
        'Idara Okon',
        'idara.dispatch@blueflame.ng',
        '+234 816 845 7723',
        dispatcherHash
      )
    ).lastInsertRowid;

    const d3 = (
      await tdb.run(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('DISPATCHER', ?, ?, ?, ?, 'ACTIVE')`,
        'Anietie Essien',
        'anietie.dispatch@blueflame.ng',
        '+234 802 619 4480',
        dispatcherHash
      )
    ).lastInsertRowid;

    // 3. Uyo Dispatcher Profiles
    const dispSql = `
      INSERT INTO dispatcher_profiles (
        user_id, vehicle_type, plate_number, license_number, zone, availability_status,
        current_lat, current_lng, location_tracking_enabled, location_updated_at,
        compensation_model, base_rate_kobo, per_km_rate_kobo, rating_avg, completed_deliveries_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `;
    await tdb.run(dispSql, d1, 'Heavy-Duty Delivery Motorcycle', 'UYO-482-QA', 'AKW-DRV-90218', 'Ewet Housing / Oron Rd / Shelter Afrique', 'BUSY', 5.0238, 7.9396, 1, 'FIXED_PLUS_DISTANCE', 75000, 8000, 4.9, 64);
    await tdb.run(dispSql, d2, 'Compact LPG Delivery Van', 'AKW-915-BC', 'AKW-DRV-74109', 'Ikot Ekpene Rd / Nwaniba / Uniuyo', 'ONLINE', 5.0412, 7.9264, 0, 'FIXED_PLUS_DISTANCE', 80000, 7500, 4.8, 51);
    await tdb.run(dispSql, d3, 'Cargo Delivery Tricycle', 'UYO-331-DF', 'AKW-DRV-61832', 'Abak Rd / Aka / Osongama / Ring Rd', 'ONLINE', 5.0242, 7.9125, 0, 'ZONE', 75000, 7500, 4.8, 39);

    // 4. Customer Wallets
    const w1 = (await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, ?)', c1, 4500000)).lastInsertRowid;
    const w2 = (await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, ?)', c2, 1850000)).lastInsertRowid;
    await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, ?)', c3, 3200000);

    // 5. Saved Uyo Addresses
    const addrSql = `
      INSERT INTO customer_addresses (user_id, label, address_line, neighbourhood, city, state, lat, lng, delivery_instructions, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await tdb.run(addrSql, c1, 'Home (Ewet Housing Estate)', 'House 18, F-Line, Ewet Housing Estate, Uyo', 'Ewet Housing', 'Uyo', 'Akwa Ibom', 5.0176, 7.9435, 'Call at Ewet Housing main gate; white duplex on left.', 1);
    await tdb.run(addrSql, c1, 'Office (Udo Udoma Avenue)', 'Plot 32 Banking Layout, Udo Udoma Avenue, Uyo', 'Udo Udoma', 'Uyo', 'Akwa Ibom', 5.0138, 7.9284, 'Drop at security reception post by main car park.', 0);
    await tdb.run(addrSql, c2, 'Home (Shelter Afrique Estate)', 'Plot 11, Phase 2, Shelter Afrique Estate, Uyo', 'Shelter Afrique', 'Uyo', 'Akwa Ibom', 5.0056, 7.9542, 'Ring intercom at blue compound gate.', 1);
    await tdb.run(addrSql, c3, 'Home (Abak Road)', '48 Abak Road, opposite Federal Secretariat, Uyo', 'Abak Road', 'Uyo', 'Akwa Ibom', 5.0274, 7.9072, 'Flat 2 upstairs behind pharmacy plaza.', 1);

    // 6. 9 Uyo Retailers — 9 100% UNIQUE DEPOT PHOTOS (ZERO REPEATS!)
    const defaultHours = JSON.stringify({ mon_fri: '07:00 - 20:30', sat: '07:30 - 20:00', sun: '09:00 - 18:00' });
    const retSql = `
      INSERT INTO retailers (
        business_name, slug, contact_person, phone, email, address, neighbourhood, city, state,
        lat, lng, logo_url, cover_image_url, description, operating_hours_json, is_open_now,
        max_delivery_radius_km, coverage_areas_json, base_delivery_fee_kobo, per_km_delivery_fee_kobo,
        estimated_prep_mins, status, rating_avg, review_count, featured, created_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const r1 = (await tdb.run(retSql, 'Ewet Housing Gas Hub', 'ewet-housing-gas-hub', 'Mr. Bassey Ekpo', '+234 809 301 1120', 'ops@ewetgashub.ng', 'Plot 14 G-Line, Ewet Housing Estate, Uyo', 'Ewet Housing', 'Uyo', 'Akwa Ibom', 5.0198, 7.9462, '', '/images/depot-ewet.jpg', 'High-capacity digital-scale LPG refilling depot serving Ewet Housing, Oron Road, Osongama Estate, and Shelter Afrique with sealed cooking gas.', defaultHours, 1, 8.5, JSON.stringify(['Ewet Housing', 'Oron Road', 'Osongama Estate', 'Four Lanes', 'Shelter Afrique', 'Ifa Ikot Okpon']), 85000, 10000, 12, 'APPROVED_ACTIVE', 4.9, 46, 1, adminId)).lastInsertRowid;
    const r2 = (await tdb.run(retSql, 'Oron Road Energy Depot', 'oron-road-energy-depot', 'Mrs. Ekaette Udoh', '+234 809 301 2245', 'desk@oronroadenergy.ng', '142 Oron Road, opposite Four Lanes Junction, Uyo', 'Oron Road', 'Uyo', 'Akwa Ibom', 5.0268, 7.9345, '', '/images/depot-oron-road.jpg', 'Express central Uyo LPG station specializing in rapid household refills, SON-certified cylinders, and genuine brass regulators.', defaultHours, 1, 9.0, JSON.stringify(['Oron Road', 'Four Lanes', 'Ewet Housing', 'Udo Udoma', 'Shelter Afrique', 'Nwaniba', 'Uyo Urban']), 90000, 10500, 10, 'APPROVED_ACTIVE', 4.8, 34, 1, adminId)).lastInsertRowid;
    const r3 = (await tdb.run(retSql, 'Ikot Ekpene Road Prime LPG', 'ikot-ekpene-road-prime-lpg', 'Mr. Udeme Akpan', '+234 803 551 9902', 'plant@ikotekpeneprimelpg.ng', '88 Ikot Ekpene Road, near Uniuyo Town Campus, Uyo', 'Ikot Ekpene Road', 'Uyo', 'Akwa Ibom', 5.0435, 7.9178, '', '/images/depot-ikot-ekpene-rd.jpg', 'Trusted Uyo refilling plant offering the sharpest per-kg pricing across Ikot Ekpene Road, Uniuyo Town Campus, Itam, and Ibom Plaza.', defaultHours, 1, 9.5, JSON.stringify(['Ikot Ekpene Road', 'Uniuyo Town Campus', 'Itam', 'Aka Road', 'Uyo Urban', 'Ibom Plaza', 'Ikpa Road']), 80000, 9500, 13, 'APPROVED_ACTIVE', 4.9, 59, 1, adminId)).lastInsertRowid;
    const r4 = (await tdb.run(retSql, 'Abak Road Flame Station', 'abak-road-flame-station', 'Mr. Iniobong Ita', '+234 802 440 8821', 'service@abakroadflame.ng', '64 Abak Road, by Federal Secretariat Junction, Uyo', 'Abak Road', 'Uyo', 'Akwa Ibom', 5.0289, 7.9042, '', '/images/depot-abak-road.jpg', 'Reliable west-Uyo cooking gas hub serving residential compounds, restaurants, and offices along Abak Road, Aka Road, and Ring Road III.', defaultHours, 1, 9.0, JSON.stringify(['Abak Road', 'Uyo Village Road', 'Aka Road', 'Ibom Plaza', 'Ring Road III', 'Ekom Iman', 'Ikot Oku Ikono']), 85000, 10000, 14, 'APPROVED_ACTIVE', 4.7, 31, 1, adminId)).lastInsertRowid;
    const r5 = (await tdb.run(retSql, 'Shelter Afrique CleanGas Plant', 'shelter-afrique-cleangas', 'Mrs. Imeobong Effiong', '+234 805 612 7390', 'hello@shelterafriquegas.ng', 'Plot 22 Shelter Afrique Estate, off Oron Road, Uyo', 'Shelter Afrique', 'Uyo', 'Akwa Ibom', 5.0042, 7.9588, '', '/images/depot-shelter-afrique.jpg', 'Precision electronic-scale LPG plant tailored for Shelter Afrique, Ewet Housing, Osongama Estate, and Mbiabong households.', defaultHours, 1, 8.5, JSON.stringify(['Shelter Afrique', 'Ewet Housing', 'Osongama Estate', 'Oron Road', 'Mbiabong', 'Udo Udoma']), 85000, 10000, 12, 'APPROVED_ACTIVE', 4.8, 38, 1, adminId)).lastInsertRowid;
    const r6 = (await tdb.run(retSql, 'Nwaniba Express LPG Depot', 'nwaniba-express-lpg', 'Mr. Effiong Usoro', '+234 818 209 3412', 'info@nwanibaexpresslpg.ng', '118 Nwaniba Road, near Uniuyo Permanent Site, Uyo', 'Nwaniba', 'Uyo', 'Akwa Ibom', 5.0392, 7.9615, '', '/images/depot-nwaniba.jpg', 'Fast-turnaround LPG plant along Nwaniba Road serving Uniuyo Permanent Site, Use Offot, Ifa Atai, and the Ibom Icon corridor.', defaultHours, 1, 9.0, JSON.stringify(['Nwaniba', 'Uniuyo Permanent Site', 'Use Offot', 'Ifa Atai', 'Ewet Housing', 'Ibom Icon Axis']), 85000, 10000, 14, 'APPROVED_ACTIVE', 4.7, 25, 0, adminId)).lastInsertRowid;
    const r7 = (await tdb.run(retSql, 'Aka & Itam Gas Point', 'aka-itam-gas-point', 'Mr. Victor Etim', '+234 806 392 5501', 'ops@akaitamgas.ng', '95 Aka Road, near Aka Etinan Junction, Uyo', 'Aka Road', 'Uyo', 'Akwa Ibom', 5.0215, 7.9165, '', '/images/depot-aka-itam.jpg', 'Neighbourhood cooking gas plant covering Aka Road, Aka Offot, Itam, Ibom Plaza, and Ring Road III with rapid motorbike dispatch.', defaultHours, 1, 8.5, JSON.stringify(['Aka Road', 'Itam', 'Abak Road', 'Ibom Plaza', 'Aka Offot', 'Ring Road III', 'Ikot Ekpene Road']), 80000, 9500, 14, 'APPROVED_ACTIVE', 4.7, 27, 0, adminId)).lastInsertRowid;
    const r8 = (await tdb.run(retSql, 'Osongama Estate LPG Hub', 'osongama-estate-lpg-hub', 'Mrs. Comfort Essien', '+234 809 774 6120', 'depot@osongamagas.ng', 'Plot 9 Osongama Estate, off Udo Udoma Avenue, Uyo', 'Osongama Estate', 'Uyo', 'Akwa Ibom', 5.0095, 7.9348, '', '/images/depot-osongama.jpg', 'Clean estate LPG refilling hub serving Osongama Estate, Udo Udoma Banking Layout, Ewet Housing, and Shelter Afrique.', defaultHours, 1, 8.5, JSON.stringify(['Osongama Estate', 'Udo Udoma', 'Ewet Housing', 'Shelter Afrique', 'Aka Road', 'Oron Road']), 85000, 10000, 13, 'APPROVED_ACTIVE', 4.8, 33, 0, adminId)).lastInsertRowid;

    // Pending retailer — Admin ONLY
    await tdb.run(retSql, 'Ring Road III Reserve LPG (Pending Inspection)', 'ring-road-iii-reserve-lpg', 'Mr. Mkpoikanke Sunday', '+234 809 998 4011', 'compliance@ringroadlpg.ng', 'Km 4 Ring Road III, by Godswill Akpabio Stadium Axis, Uyo', 'Ring Road III', 'Uyo', 'Akwa Ibom', 5.0025, 7.8965, '', '/images/depot-ring-road.jpg', 'Awaiting final digital scale calibration and Operations Director activation before appearing publicly on the Uyo map.', defaultHours, 0, 8.0, JSON.stringify(['Ring Road III', 'Abak Road', 'Aka Road', 'Ekom Iman']), 85000, 10000, 15, 'PENDING_APPROVAL', 5.0, 0, 0, adminId);

    await tdb.run('INSERT INTO favourite_retailers (user_id, retailer_id) VALUES (?, ?)', c1, r1);
    await tdb.run('INSERT INTO favourite_retailers (user_id, retailer_id) VALUES (?, ?)', c1, r2);

    // 7. Categories & 13 Products — 13 100% UNIQUE PRODUCT PHOTOS (ZERO REPEATS!)
    const catRefill = (await tdb.run('INSERT INTO product_categories (name, slug, type, description, sort_order) VALUES (?, ?, ?, ?, ?)', 'Cooking Gas Refills', 'cooking-gas-refills', 'GAS_REFILL', 'Digitally weighed domestic & commercial LPG gas refills across Uyo', 1)).lastInsertRowid;
    const catCylinders = (await tdb.run('INSERT INTO product_categories (name, slug, type, description, sort_order) VALUES (?, ?, ?, ?, ?)', 'Gas Cylinders', 'gas-cylinders', 'CYLINDER', 'SON-certified brand new steel LPG cylinders', 2)).lastInsertRowid;
    const catAcc = (await tdb.run('INSERT INTO product_categories (name, slug, type, description, sort_order) VALUES (?, ?, ?, ?, ?)', 'Gas Accessories', 'gas-accessories', 'ACCESSORY', 'Safety-tested brass regulators, reinforced hoses, and camp burners', 3)).lastInsertRowid;

    const prodSql = 'INSERT INTO products (category_id, name, slug, size_kg, unit_label, description, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const p1kg = (await tdb.run(prodSql, catRefill, '1kg Cooking Gas Refill', 'gas-refill-1kg', 1, '1kg', 'Quick 1kg LPG top-up for compact camp cylinders.', '/images/prod-refill-1kg.jpg')).lastInsertRowid;
    const p2kg = (await tdb.run(prodSql, catRefill, '2kg Cooking Gas Refill', 'gas-refill-2kg', 2, '2kg', 'Measured 2kg domestic LPG cooking gas refill.', '/images/prod-refill-2kg.jpg')).lastInsertRowid;
    const p3kg = (await tdb.run(prodSql, catRefill, '3kg Cooking Gas Refill', 'gas-refill-3kg', 3, '3kg', 'Popular 3kg camp-gas refill for student and studio kitchens in Uyo.', '/images/prod-refill-3kg.jpg')).lastInsertRowid;
    const p5kg = (await tdb.run(prodSql, catRefill, '5kg Cooking Gas Refill', 'gas-refill-5kg', 5, '5kg', 'Precision-weighed 5kg domestic LPG refill.', '/images/prod-refill-5kg.jpg')).lastInsertRowid;
    const p6kg = (await tdb.run(prodSql, catRefill, '6kg Cooking Gas Refill', 'gas-refill-6kg', 6, '6kg', 'Standard 6kg compact household LPG cylinder refill.', '/images/prod-refill-6kg.jpg')).lastInsertRowid;
    const p12kg = (await tdb.run(prodSql, catRefill, '12.5kg Cooking Gas Refill', 'gas-refill-12-5kg', 12.5, '12.5kg', 'Nigeria’s most popular family-size 12.5kg cooking gas refill, digitally weighed.', '/images/prod-refill-12-5kg.jpg')).lastInsertRowid;
    const p25kg = (await tdb.run(prodSql, catRefill, '25kg Cooking Gas Refill', 'gas-refill-25kg', 25, '25kg', 'Large household & catering 25kg LPG refill.', '/images/prod-refill-25kg.jpg')).lastInsertRowid;
    const p50kg = (await tdb.run(prodSql, catRefill, '50kg Cooking Gas Refill', 'gas-refill-50kg', 50, '50kg', 'Commercial kitchen, bakery & hotel 50kg industrial LPG refill.', '/images/prod-refill-50kg.jpg')).lastInsertRowid;
    const pCyl6 = (await tdb.run(prodSql, catCylinders, '6kg New Steel Gas Cylinder', 'cylinder-6kg-new', 6, '6kg Cylinder', 'SON-certified empty 6kg powder-coated steel LPG cylinder with brass valve.', '/images/prod-cylinder-6kg.jpg')).lastInsertRowid;
    const pCyl12 = (await tdb.run(prodSql, catCylinders, '12.5kg New Steel Gas Cylinder', 'cylinder-12-5kg-new', 12.5, '12.5kg Cylinder', 'Heavy-duty SON-approved 12.5kg domestic steel LPG cylinder (empty, ready to fill).', '/images/prod-cylinder-12-5kg.webp')).lastInsertRowid;
    const pReg = (await tdb.run(prodSql, catAcc, 'High-Pressure Brass Gas Regulator', 'brass-gas-regulator', null, '1 Unit', 'Safety pressure-gauge LPG regulator compatible with standard Nigerian valves.', '/images/prod-regulator.jpg')).lastInsertRowid;
    const pHose = (await tdb.run(prodSql, catAcc, 'Reinforced 2m Gas Hose & Clamps', 'reinforced-gas-hose-2m', null, '2m Set', 'Heavy-duty double-layer anti-kink LPG hose with stainless steel jubilee clips.', '/images/prod-hose.jpg')).lastInsertRowid;
    const pBurner = (await tdb.run(prodSql, catAcc, 'Cast-Iron Camp Burner Head', 'camp-burner-head', null, '1 Unit', 'Durable screw-on burner top for 3kg/5kg/6kg camp cylinders.', '/images/prod-burner.jpg')).lastInsertRowid;

    // 8. Independent Retailer Pricing Matrix
    const retailerPriceConfigs = [
      { retailerId: r1, perKgNaira: 1160, supplyRatio: 0.91, accOffset: 0 },
      { retailerId: r2, perKgNaira: 1192, supplyRatio: 0.90, accOffset: 400 },
      { retailerId: r3, perKgNaira: 1144, supplyRatio: 0.92, accOffset: -300 },
      { retailerId: r4, perKgNaira: 1168, supplyRatio: 0.91, accOffset: -100 },
      { retailerId: r5, perKgNaira: 1184, supplyRatio: 0.91, accOffset: 200 },
      { retailerId: r6, perKgNaira: 1152, supplyRatio: 0.91, accOffset: -200 },
      { retailerId: r7, perKgNaira: 1176, supplyRatio: 0.91, accOffset: 100 },
      { retailerId: r8, perKgNaira: 1160, supplyRatio: 0.91, accOffset: 0 },
    ];

    const refillProducts = [
      { id: p1kg, kg: 1, stock: 60 },
      { id: p2kg, kg: 2, stock: 55 },
      { id: p3kg, kg: 3, stock: 50 },
      { id: p5kg, kg: 5, stock: 45 },
      { id: p6kg, kg: 6, stock: 40 },
      { id: p12kg, kg: 12.5, stock: 80 },
      { id: p25kg, kg: 25, stock: 22 },
      { id: p50kg, kg: 50, stock: 12 },
    ];

    const rpLookup = new Map<string, { id: number; sell: number; supply: number }>();
    const rpSql = `INSERT INTO retailer_products (retailer_id, product_id, selling_price_kobo, retailer_supply_cost_kobo, stock_quantity, is_available) VALUES (?, ?, ?, ?, ?, 1)`;

    for (const cfg of retailerPriceConfigs) {
      for (const p of refillProducts) {
        const sellNaira = Math.round((p.kg * cfg.perKgNaira) / 50) * 50;
        const sellKobo = sellNaira * 100;
        const supplyKobo = Math.round((sellNaira * cfg.supplyRatio) / 50) * 50 * 100;
        const id = (await tdb.run(rpSql, cfg.retailerId, p.id, sellKobo, supplyKobo, p.stock)).lastInsertRowid;
        rpLookup.set(`${cfg.retailerId}-${p.id}`, { id, sell: sellKobo, supply: supplyKobo });
      }
      const extras = [
        { id: pCyl6, sellNaira: 22000 + cfg.accOffset, stock: 10 },
        { id: pCyl12, sellNaira: 37500 + cfg.accOffset, stock: 14 },
        { id: pReg, sellNaira: 6200 + cfg.accOffset, stock: 25 },
        { id: pHose, sellNaira: 4000 + cfg.accOffset, stock: 30 },
        { id: pBurner, sellNaira: 5200 + cfg.accOffset, stock: 18 },
      ];
      for (const ex of extras) {
        const sellKobo = ex.sellNaira * 100;
        const supplyKobo = Math.round((ex.sellNaira * 0.86) / 100) * 100 * 100;
        const id = (await tdb.run(rpSql, cfg.retailerId, ex.id, sellKobo, supplyKobo, ex.stock)).lastInsertRowid;
        rpLookup.set(`${cfg.retailerId}-${ex.id}`, { id, sell: sellKobo, supply: supplyKobo });
      }
    }

    // 9. Promotions
    const promoSql = `INSERT INTO promotions (code, title, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, usage_limit, used_count, valid_from, valid_until, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
    await tdb.run(promoSql, 'WELCOME500', '₦500 Off First Uyo Gas Refill', 'Instant ₦500 discount on cooking gas orders of ₦10,000 or more in Uyo.', 'FIXED', 50000, 1000000, 50000, 500, 14, '2026-01-01', '2027-12-31');
    await tdb.run(promoSql, 'UYO5', '5% Uyo Wallet Refill Savings', 'Enjoy 5% off up to ₦1,500 on cooking gas refills across Uyo.', 'PERCENT', 5, 500000, 150000, 1000, 27, '2026-01-01', '2027-12-31');

    // 10. Wallet Funding Ledger
    const gwSql = `INSERT INTO gateway_transactions (reference, idempotency_key, user_id, purpose, order_id, provider, channel, amount_kobo, status, provider_response_json, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const wtxSql = `INSERT INTO wallet_transactions (wallet_id, user_id, reference, idempotency_key, type, direction, amount_kobo, balance_before_kobo, balance_after_kobo, status, payment_method, gateway_provider, gateway_reference, order_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await tdb.run(gwSql, 'BF-WLT-20261110-A101', 'SEED-WLT-1', c1, 'WALLET_FUNDING', null, 'PAYSTACK', 'CARD', 6000000, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'PAYSTACK', channel: 'card', last4: '4081', bank: 'Zenith Bank' }), '2026-11-10 09:15:00', '2026-11-10 09:14:30');
    await tdb.run(wtxSql, w1, c1, 'BF-WLT-20261110-A101', 'SEED-WLT-TX-1', 'FUNDING', 'CREDIT', 6000000, 0, 6000000, 'SUCCESS', 'CARD', 'PAYSTACK', 'BF-WLT-20261110-A101', null, 'Wallet funded via Paystack (Debit Card)', '2026-11-10 09:15:00');
    await tdb.run(gwSql, 'BF-WLT-20261112-B202', 'SEED-WLT-2', c2, 'WALLET_FUNDING', null, 'FLUTTERWAVE', 'BANK_TRANSFER', 3500000, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'FLUTTERWAVE', channel: 'bank_transfer', bank: 'First Bank' }), '2026-11-12 14:22:00', '2026-11-12 14:20:00');
    await tdb.run(wtxSql, w2, c2, 'BF-WLT-20261112-B202', 'SEED-WLT-TX-2', 'FUNDING', 'CREDIT', 3500000, 0, 3500000, 'SUCCESS', 'BANK_TRANSFER', 'FLUTTERWAVE', 'BF-WLT-20261112-B202', null, 'Wallet funded via Flutterwave (Bank Transfer)', '2026-11-12 14:22:00');
    await tdb.run(`INSERT INTO financial_audit_logs (event_type, actor_user_id, actor_role, entity_type, entity_id, reference, amount_kobo, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 'WALLET_FUNDED_VERIFIED', c1, 'CUSTOMER', 'wallet', String(w1), 'BF-WLT-20261110-A101', 6000000, JSON.stringify({ provider: 'PAYSTACK', city: 'Uyo' }), '2026-11-10 09:15:00');

    // 11. Realistic Uyo Orders
    const ordSql = `
      INSERT INTO orders (
        order_reference, customer_id, retailer_id, dispatcher_id, status, payment_method, payment_status,
        payment_reference, gateway_provider, delivery_address, delivery_neighbourhood, delivery_city, delivery_state,
        delivery_lat, delivery_lng, delivery_instructions, distance_km, estimated_delivery_mins,
        subtotal_kobo, retailer_supply_total_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo,
        total_amount_kobo, platform_margin_kobo, delivery_confirmation_code, proof_of_delivery_note,
        failure_reason, failure_notes, assigned_at, accepted_at, collected_at, in_transit_at, delivered_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const oiSql = `INSERT INTO order_items (order_id, retailer_product_id, product_id, product_name, size_kg, quantity, unit_price_kobo, unit_supply_cost_kobo, line_total_kobo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const histSql = `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const stlSql = `INSERT INTO retailer_settlements (retailer_id, order_id, product_sale_kobo, agreed_retailer_payout_kobo, platform_margin_kobo, status, settlement_reference, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const earnSql = `INSERT INTO dispatcher_earnings (dispatcher_id, order_id, compensation_model, base_amount_kobo, distance_bonus_kobo, admin_bonus_kobo, total_earning_kobo, status, payout_reference, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // Order 1: DELIVERED (Ewet Housing)
    const r1_12 = rpLookup.get(`${r1}-${p12kg}`)!;
    const ord1Id = (await tdb.run(ordSql, 'BF-ORD-20261111-1001', c1, r1, d1, 'DELIVERED', 'WALLET', 'PAID', 'BF-WLP-20261111-E01', null, 'House 18, F-Line, Ewet Housing Estate, Uyo', 'Ewet Housing', 'Uyo', 'Akwa Ibom', 5.0176, 7.9435, 'Call at Ewet Housing main gate', 0.4, 22, r1_12.sell, r1_12.supply, 95000, 29000, 0, r1_12.sell + 95000 + 29000, r1_12.sell - r1_12.supply + 29000, '4829', 'Customer confirmed digital weight seal and signed off with PIN 4829.', '', '', '2026-11-11 10:12:00', '2026-11-11 10:15:00', '2026-11-11 10:25:00', '2026-11-11 10:28:00', '2026-11-11 10:38:00', '2026-11-11 10:08:00')).lastInsertRowid;
    await tdb.run(oiSql, ord1Id, r1_12.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r1_12.sell, r1_12.supply, r1_12.sell);
    await tdb.run(histSql, ord1Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', c1, 'SYSTEM', 'Paid via BlueFlame Wallet', '2026-11-11 10:08:05');
    await tdb.run(histSql, ord1Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Ubong Etim', '2026-11-11 10:12:00');
    await tdb.run(histSql, ord1Id, 'IN_TRANSIT', 'DELIVERED', d1, 'DISPATCHER', 'Delivered successfully in Ewet Housing with PIN 4829', '2026-11-11 10:38:00');
    await tdb.run(stlSql, r1, ord1Id, r1_12.sell, r1_12.supply, r1_12.sell - r1_12.supply, 'PAID', 'BF-STL-20261112-001', '2026-11-12 16:00:00', '2026-11-11 10:08:05');
    await tdb.run(earnSql, d1, ord1Id, 'FIXED_PLUS_DISTANCE', 75000, 3200, 0, 78200, 'PAID', 'BF-DSP-20261112-001', '2026-11-12 17:00:00', '2026-11-11 10:38:00');
    await tdb.run(wtxSql, w1, c1, 'BF-WLP-20261111-E01', 'SEED-WLP-1', 'ORDER_PAYMENT', 'DEBIT', r1_12.sell + 95000 + 29000, 6000000, 6000000 - (r1_12.sell + 95000 + 29000), 'SUCCESS', 'WALLET', null, null, ord1Id, 'Cooking gas order payment · BF-ORD-20261111-1001', '2026-11-11 10:08:05');
    await tdb.run(`INSERT INTO reviews (order_id, customer_id, retailer_id, dispatcher_id, retailer_rating, dispatcher_rating, comment, created_at) VALUES (?, ?, ?, ?, 5, 5, ?, '2026-11-11 11:20:00')`, ord1Id, c1, r1, d1, 'Exact 12.5kg digital weight and super polite Uyo dispatcher. Arrived faster than expected.');

    // Order 2: DELIVERED (Shelter Afrique)
    const r5_12 = rpLookup.get(`${r5}-${p12kg}`)!;
    const r5_reg = rpLookup.get(`${r5}-${pReg}`)!;
    const ord2Sub = r5_12.sell + r5_reg.sell;
    const ord2Sup = r5_12.supply + r5_reg.supply;
    const ord2Id = (await tdb.run(ordSql, 'BF-ORD-20261113-1002', c2, r5, d2, 'DELIVERED', 'WALLET', 'PAID', 'BF-WLP-20261113-E02', null, 'Plot 11, Phase 2, Shelter Afrique Estate, Uyo', 'Shelter Afrique', 'Uyo', 'Akwa Ibom', 5.0056, 7.9542, 'Ring intercom at blue compound gate', 0.5, 22, ord2Sub, ord2Sup, 95000, 42400, 0, ord2Sub + 95000 + 42400, ord2Sub - ord2Sup + 42400, '7314', 'Delivered 12.5kg refill + brass regulator; verified fit at kitchen door.', '', '', '2026-11-13 15:10:00', '2026-11-13 15:14:00', '2026-11-13 15:26:00', '2026-11-13 15:30:00', '2026-11-13 15:40:00', '2026-11-13 15:05:00')).lastInsertRowid;
    await tdb.run(oiSql, ord2Id, r5_12.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r5_12.sell, r5_12.supply, r5_12.sell);
    await tdb.run(oiSql, ord2Id, r5_reg.id, pReg, 'High-Pressure Brass Gas Regulator', null, 1, r5_reg.sell, r5_reg.supply, r5_reg.sell);
    await tdb.run(stlSql, r5, ord2Id, ord2Sub, ord2Sup, ord2Sub - ord2Sup, 'APPROVED', 'BF-STL-20261113-002', null, '2026-11-13 15:05:10');
    await tdb.run(earnSql, d2, ord2Id, 'FIXED_PLUS_DISTANCE', 80000, 3750, 0, 83750, 'APPROVED', 'BF-DSP-20261113-002', null, '2026-11-13 15:40:00');
    await tdb.run(`INSERT INTO reviews (order_id, customer_id, retailer_id, dispatcher_id, retailer_rating, dispatcher_rating, comment, created_at) VALUES (?, ?, ?, ?, 5, 5, ?, '2026-11-13 16:30:00')`, ord2Id, c2, r5, d2, 'Clean Shelter Afrique service and authentic brass regulator. Highly recommended in Uyo.');

    // Order 3: IN_TRANSIT (Oron Rd -> Ewet Housing)
    const r2_12 = rpLookup.get(`${r2}-${p12kg}`)!;
    const ord3Tot = r2_12.sell + 110000 + 29800;
    const ord3Id = (await tdb.run(ordSql, 'BF-ORD-20261116-1003', c1, r2, d1, 'IN_TRANSIT', 'DIRECT_ONLINE', 'PAID', 'BF-PAY-20261116-9041', 'PAYSTACK', 'House 18, F-Line, Ewet Housing Estate, Uyo', 'Ewet Housing', 'Uyo', 'Akwa Ibom', 5.0176, 7.9435, 'Call at Ewet Housing main gate; white duplex on left.', 1.4, 24, r2_12.sell, r2_12.supply, 110000, 29800, 0, ord3Tot, r2_12.sell - r2_12.supply + 29800, '6194', '', '', '', '2026-11-16 09:05:00', '2026-11-16 09:07:00', '2026-11-16 09:18:00', '2026-11-16 09:22:00', null, '2026-11-16 09:00:00')).lastInsertRowid;
    await tdb.run(oiSql, ord3Id, r2_12.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r2_12.sell, r2_12.supply, r2_12.sell);
    await tdb.run(gwSql, 'BF-PAY-20261116-9041', 'SEED-ORD-3', c1, 'ORDER_PAYMENT', ord3Id, 'PAYSTACK', 'CARD', ord3Tot, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'PAYSTACK', last4: '4081' }), '2026-11-16 09:00:12', '2026-11-16 09:00:00');
    await tdb.run(histSql, ord3Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', c1, 'SYSTEM', 'Verified Paystack card payment', '2026-11-16 09:00:12');
    await tdb.run(histSql, ord3Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Ubong Etim (closest Uyo dispatcher)', '2026-11-16 09:05:00');
    await tdb.run(histSql, ord3Id, 'ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', d1, 'DISPATCHER', 'Accepted job and heading to Oron Road Energy Depot', '2026-11-16 09:07:00');
    await tdb.run(histSql, ord3Id, 'ACCEPTED_BY_DISPATCHER', 'COLLECTED_FROM_RETAILER', d1, 'DISPATCHER', 'Collected sealed 12.5kg cylinder', '2026-11-16 09:18:00');
    await tdb.run(histSql, ord3Id, 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT', d1, 'DISPATCHER', 'Heading down Oron Road into Ewet Housing Estate', '2026-11-16 09:22:00');
    await tdb.run(stlSql, r2, ord3Id, r2_12.sell, r2_12.supply, r2_12.sell - r2_12.supply, 'PENDING', 'BF-STL-20261116-003', null, '2026-11-16 09:00:12');

    // Order 4: ASSIGNED_TO_DISPATCHER
    const r1_6 = rpLookup.get(`${r1}-${p6kg}`)!;
    const ord4Id = (await tdb.run(ordSql, 'BF-ORD-20261116-1004', c1, r1, d1, 'ASSIGNED_TO_DISPATCHER', 'WALLET', 'PAID', 'BF-WLP-20261116-9042', null, 'Plot 32 Banking Layout, Udo Udoma Avenue, Uyo', 'Udo Udoma', 'Uyo', 'Akwa Ibom', 5.0138, 7.9284, 'Drop at security reception post by main car park.', 2.1, 25, r1_6.sell, r1_6.supply, 115000, 20000, 0, r1_6.sell + 115000 + 20000, r1_6.sell - r1_6.supply + 20000, '3907', '', '', '', '2026-11-16 10:15:00', null, null, null, null, '2026-11-16 10:10:00')).lastInsertRowid;
    await tdb.run(oiSql, ord4Id, r1_6.id, p6kg, '6kg Cooking Gas Refill', 6, 1, r1_6.sell, r1_6.supply, r1_6.sell);
    await tdb.run(histSql, ord4Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', c1, 'SYSTEM', 'Paid via BlueFlame Wallet', '2026-11-16 10:10:05');
    await tdb.run(histSql, ord4Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Ubong Etim', '2026-11-16 10:15:00');
    await tdb.run(stlSql, r1, ord4Id, r1_6.sell, r1_6.supply, r1_6.sell - r1_6.supply, 'PENDING', 'BF-STL-20261116-004', null, '2026-11-16 10:10:05');

    // Order 5: AWAITING_DISPATCHER_ASSIGNMENT
    const r3_5 = rpLookup.get(`${r3}-${p5kg}`)!;
    const r3_hose = rpLookup.get(`${r3}-${pHose}`)!;
    const ord5Sub = r3_5.sell + r3_hose.sell;
    const ord5Sup = r3_5.supply + r3_hose.supply;
    const ord5Tot = ord5Sub + 140000 + 20000;
    const ord5Id = (await tdb.run(ordSql, 'BF-ORD-20261116-1005', c2, r3, null, 'AWAITING_DISPATCHER_ASSIGNMENT', 'DIRECT_ONLINE', 'PAID', 'BF-PAY-20261116-9055', 'FLUTTERWAVE', 'Plot 11, Phase 2, Shelter Afrique Estate, Uyo', 'Shelter Afrique', 'Uyo', 'Akwa Ibom', 5.0056, 7.9542, 'Ring intercom at blue compound gate.', 5.8, 32, ord5Sub, ord5Sup, 140000, 20000, 0, ord5Tot, ord5Sub - ord5Sup + 20000, '8251', '', '', '', null, null, null, null, null, '2026-11-16 10:42:00')).lastInsertRowid;
    await tdb.run(oiSql, ord5Id, r3_5.id, p5kg, '5kg Cooking Gas Refill', 5, 1, r3_5.sell, r3_5.supply, r3_5.sell);
    await tdb.run(oiSql, ord5Id, r3_hose.id, pHose, 'Reinforced 2m Gas Hose & Clamps', null, 1, r3_hose.sell, r3_hose.supply, r3_hose.sell);
    await tdb.run(gwSql, 'BF-PAY-20261116-9055', 'SEED-ORD-5', c2, 'ORDER_PAYMENT', ord5Id, 'FLUTTERWAVE', 'BANK_TRANSFER', ord5Tot, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'FLUTTERWAVE', channel: 'bank_transfer' }), '2026-11-16 10:42:10', '2026-11-16 10:42:00');
    await tdb.run(histSql, ord5Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', c2, 'SYSTEM', 'Verified Flutterwave bank transfer', '2026-11-16 10:42:10');
    await tdb.run(histSql, ord5Id, 'PAYMENT_CONFIRMED', 'AWAITING_DISPATCHER_ASSIGNMENT', c2, 'SYSTEM', 'Queued for Uyo Operations dispatcher assignment', '2026-11-16 10:42:11');
    await tdb.run(stlSql, r3, ord5Id, ord5Sub, ord5Sup, ord5Sub - ord5Sup, 'PENDING', 'BF-STL-20261116-005', null, '2026-11-16 10:42:10');

    // Order 6: DELIVERY_FAILED (Abak Road)
    const r4_12 = rpLookup.get(`${r4}-${p12kg}`)!;
    const ord6Id = (await tdb.run(ordSql, 'BF-ORD-20261115-1006', c3, r4, d3, 'DELIVERY_FAILED', 'WALLET', 'PAID', 'BF-WLP-20261115-8812', null, '48 Abak Road, opposite Federal Secretariat, Uyo', 'Abak Road', 'Uyo', 'Akwa Ibom', 5.0274, 7.9072, 'Flat 2 upstairs behind pharmacy plaza.', 0.4, 22, r4_12.sell, r4_12.supply, 95000, 29200, 0, r4_12.sell + 95000 + 29200, r4_12.sell - r4_12.supply + 29200, '5103', '', 'CUSTOMER_UNAVAILABLE', 'Called customer three times by Federal Secretariat gate and waited 20 minutes; neighbours confirmed flat occupant stepped out.', '2026-11-15 17:10:00', '2026-11-15 17:12:00', '2026-11-15 17:24:00', '2026-11-15 17:28:00', null, '2026-11-15 17:05:00')).lastInsertRowid;
    await tdb.run(oiSql, ord6Id, r4_12.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r4_12.sell, r4_12.supply, r4_12.sell);
    await tdb.run(histSql, ord6Id, 'IN_TRANSIT', 'DELIVERY_FAILED', d3, 'DISPATCHER', 'Reported: Customer unavailable at Abak Road delivery address', '2026-11-15 17:52:00');
    await tdb.run(stlSql, r4, ord6Id, r4_12.sell, r4_12.supply, r4_12.sell - r4_12.supply, 'PENDING', 'BF-STL-20261115-006', null, '2026-11-15 17:05:10');

    await tdb.run(`INSERT INTO complaints (ticket_number, customer_id, order_id, category, subject, description, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 'HIGH', '2026-11-15 19:10:00')`, 'BF-TKT-20261115-01', c3, ord6Id, 'DELIVERY_ISSUE', 'Missed delivery on Abak Road — please reschedule or refund', 'My phone battery died briefly while I stepped out to Plaza. Kindly reschedule the Uyo delivery for tomorrow morning or refund my BlueFlame wallet.');

    const notifSql = `INSERT INTO notifications (user_id, role_scope, title, message, type, channels_json, related_order_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await tdb.run(notifSql, c1, 'CUSTOMER', 'Your Cooking Gas Is On The Way!', 'Ubong Etim is heading along Oron Road toward Ewet Housing with order BF-ORD-20261116-1003. Have your confirmation PIN (6194) ready.', 'DELIVERY', '["IN_APP","SMS"]', ord3Id, 0, '2026-11-16 09:22:00');
    await tdb.run(notifSql, c1, 'CUSTOMER', 'Dispatcher Assigned to Your Order', 'Ubong Etim has been assigned to deliver your order BF-ORD-20261116-1004 to Udo Udoma Avenue.', 'DELIVERY', '["IN_APP"]', ord4Id, 0, '2026-11-16 10:15:00');
    await tdb.run(notifSql, d1, 'DISPATCHER', 'New Uyo Delivery Assignment', 'Order BF-ORD-20261116-1004: Collect 6kg refill from Ewet Housing Gas Hub and deliver to Plot 32 Banking Layout, Udo Udoma Ave.', 'DISPATCH', '["IN_APP","SMS"]', ord4Id, 0, '2026-11-16 10:15:00');
    await tdb.run(notifSql, adminId, 'ADMIN', 'New Direct-Paid Order Ready for Dispatch', 'Order BF-ORD-20261116-1005 (Flutterwave Verified · Ikot Ekpene Rd Prime LPG) is awaiting Uyo dispatcher assignment.', 'ORDER', '["IN_APP","EMAIL"]', ord5Id, 0, '2026-11-16 10:42:10');
    await tdb.run(notifSql, adminId, 'ADMIN', 'Failed Delivery Requires Action', 'Dispatcher Anietie Essien reported CUSTOMER_UNAVAILABLE on Abak Road order BF-ORD-20261115-1006.', 'ALERT', '["IN_APP","EMAIL"]', ord6Id, 0, '2026-11-15 17:52:00');
  });

  console.log('[BlueFlame] Seeded Uyo, Akwa Ibom State cooking gas marketplace database.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabaseIfEmpty()
    .then(() => console.log('[BlueFlame] Seed check complete.'))
    .catch((err) => {
      console.error('[BlueFlame] Seed error:', err);
      process.exit(1);
    });
}
