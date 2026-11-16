import { getDb, runInTransaction } from './database.js';
import { hashPassword } from '../middleware/auth.js';

export function seedDatabaseIfEmpty(): void {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount > 0) {
    return;
  }

  runInTransaction((tdb) => {
    // 1. Platform Settings & Homepage CMS Content
    const insertSetting = tdb.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json) VALUES (?, ?)');
    insertSetting.run(
      'commercial_fees',
      JSON.stringify({
        serviceFeePercent: 2.0,
        minServiceFeeKobo: 20000,
        maxServiceFeeKobo: 150000,
        defaultBaseDeliveryFeeKobo: 100000,
        defaultPerKmDeliveryFeeKobo: 12000,
        defaultDispatcherBaseRateKobo: 80000,
        defaultDispatcherPerKmRateKobo: 8000,
        currency: 'NGN',
        cashOnDeliveryAllowed: false,
      })
    );
    insertSetting.run(
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
    insertSetting.run(
      'homepage_cms',
      JSON.stringify({
        announcementBanner:
          '100% Cashless Verified Cooking Gas Delivery across Lagos & Abuja · Use code WELCOME500 for ₦500 off orders above ₦10,000',
        heroTitle: 'Compare Nearby Cooking Gas Prices. Order & Track Fast Delivery.',
        heroSubtitle:
          'Discover verified LPG retailers near your location, compare transparent gas refill prices and delivery charges, pay securely online or via wallet, and track your dedicated dispatcher to your doorstep.',
        supportPhone: '+234 800 258 3352',
        supportEmail: 'support@blueflame.ng',
        supportHours: 'Daily, 6:30 AM – 9:30 PM WAT',
        faqs: [
          {
            question: 'How does BlueFlame guarantee accurate gas weight and pricing?',
            answer:
              'Every participating gas retailer on BlueFlame is vetted, registered, and centrally managed by our operations team. Product prices and refill weights are verified and published transparently before you pay.',
          },
          {
            question: 'Can I pay cash on delivery to the dispatcher?',
            answer:
              'No. BlueFlame operates a strictly cashless electronic payment system for customer safety and transparent auditing. You can pay instantly using your funded BlueFlame Digital Wallet or via Paystack/Flutterwave (card, bank transfer, or USSD). Dispatchers never collect cash.',
          },
          {
            question: 'How does delivery coverage work?',
            answer:
              'Each retailer serves specific neighbourhoods and a defined maximum delivery radius set by BlueFlame Operations. When you select your delivery pin or address, we automatically verify which retailers can deliver to you and calculate exact delivery charges.',
          },
          {
            question: 'How do I know when my cooking gas will arrive?',
            answer:
              'Once your electronic payment is confirmed, Operations assigns a vetted dispatcher. You receive real-time notifications at every stage — from retailer pickup to live on-map transit — plus a 4-digit confirmation PIN for safe handover.',
          },
          {
            question: 'What happens if a retailer runs out of stock or delivery fails?',
            answer:
              'Dispatchers report any collection or delivery issue directly to BlueFlame Operations. Our team either reassigns your order promptly or processes an audited refund directly to your BlueFlame Wallet.',
          },
        ],
        testimonials: [
          {
            name: 'Mrs. Folake Adeyemi',
            location: 'Lekki Phase 1, Lagos',
            rating: 5,
            quote:
              'I compared two stations near Admiralty Way, saved ₦700 on my 12.5kg refill, paid from my wallet in seconds, and watched the dispatcher arrive in 32 minutes.',
          },
          {
            name: 'Engr. Ibrahim Danjuma',
            location: 'Ikeja GRA, Lagos',
            rating: 5,
            quote:
              'Zero arguments about cash change or inflated prices. The electronic receipt, verified cylinder seal, and delivery PIN make BlueFlame feel truly professional.',
          },
          {
            name: 'Chidinma Eze',
            location: 'Surulere, Lagos',
            rating: 5,
            quote:
              'Ordered a 6kg refill and a replacement brass regulator on Sunday evening. Clear pricing upfront and the dispatcher followed my estate gate instructions perfectly.',
          },
        ],
      })
    );

    // 2. Users (Strictly CUSTOMER, DISPATCHER, ADMIN — NEVER retailers)
    const adminHash = hashPassword('Admin@BlueFlame2026');
    const customerHash = hashPassword('Customer@2026');
    const dispatcherHash = hashPassword('Dispatch@2026');

    const insertUser = tdb.prepare(`
      INSERT INTO users (role, full_name, email, phone, password_hash, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `);

    const adminId = Number(
      insertUser.run('ADMIN', 'Chinedu Okafor', 'admin@blueflame.ng', '+234 809 100 0001', adminHash).lastInsertRowid
    );
    const customer1Id = Number(
      insertUser.run('CUSTOMER', 'Amaka Nwosu', 'amaka.nwosu@example.com', '+234 803 412 8821', customerHash)
        .lastInsertRowid
    );
    const customer2Id = Number(
      insertUser.run('CUSTOMER', 'Tunde Balogun', 'tunde.balogun@example.com', '+234 805 771 3904', customerHash)
        .lastInsertRowid
    );
    const customer3Id = Number(
      insertUser.run('CUSTOMER', 'Zainab Bello', 'zainab.bello@example.com', '+234 812 904 1152', customerHash)
        .lastInsertRowid
    );

    const dispatcher1Id = Number(
      insertUser.run('DISPATCHER', 'Emeka Obi', 'emeka.dispatch@blueflame.ng', '+234 814 220 5510', dispatcherHash)
        .lastInsertRowid
    );
    const dispatcher2Id = Number(
      insertUser.run('DISPATCHER', 'Musa Ibrahim', 'musa.dispatch@blueflame.ng', '+234 816 845 7723', dispatcherHash)
        .lastInsertRowid
    );
    const dispatcher3Id = Number(
      insertUser.run('DISPATCHER', 'Segun Adeyemi', 'segun.dispatch@blueflame.ng', '+234 802 619 4480', dispatcherHash)
        .lastInsertRowid
    );

    // 3. Dispatcher Profiles
    const insertDisp = tdb.prepare(`
      INSERT INTO dispatcher_profiles (
        user_id, vehicle_type, plate_number, license_number, zone, availability_status,
        current_lat, current_lng, location_tracking_enabled, location_updated_at,
        compensation_model, base_rate_kobo, per_km_rate_kobo, rating_avg, completed_deliveries_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `);
    insertDisp.run(
      dispatcher1Id,
      'Heavy-Duty Delivery Motorcycle',
      'LND-482-QA',
      'LAG-DRV-90218',
      'Lekki / VI / Ikoyi',
      'BUSY',
      6.4395,
      3.4495,
      1,
      'FIXED_PLUS_DISTANCE',
      85000,
      9000,
      4.9,
      64
    );
    insertDisp.run(
      dispatcher2Id,
      'Compact LPG Delivery Van',
      'IKJ-915-BC',
      'LAG-DRV-74109',
      'Ikeja / Yaba / Gbagada',
      'ONLINE',
      6.5882,
      3.3578,
      0,
      'FIXED_PLUS_DISTANCE',
      90000,
      8500,
      4.8,
      51
    );
    insertDisp.run(
      dispatcher3Id,
      'Cargo Delivery Tricycle',
      'KJA-331-DF',
      'LAG-DRV-61832',
      'Surulere / Mainland / Festac',
      'ONLINE',
      6.5021,
      3.3624,
      0,
      'ZONE',
      80000,
      8000,
      4.7,
      38
    );

    // 4. Customer Wallets
    const insertWallet = tdb.prepare('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, ?)');
    const wallet1Id = Number(insertWallet.run(customer1Id, 4500000).lastInsertRowid); // ₦45,000
    const wallet2Id = Number(insertWallet.run(customer2Id, 1850000).lastInsertRowid); // ₦18,500
    const wallet3Id = Number(insertWallet.run(customer3Id, 3200000).lastInsertRowid); // ₦32,000

    // 5. Saved Customer Addresses
    const insertAddr = tdb.prepare(`
      INSERT INTO customer_addresses (user_id, label, address_line, neighbourhood, city, state, lat, lng, delivery_instructions, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAddr.run(
      customer1Id,
      'Home (Lekki Phase 1)',
      '14B Admiralty Road, off Admiralty Way, Lekki Phase 1',
      'Lekki Phase 1',
      'Lagos',
      'Lagos',
      6.4432,
      3.4658,
      'Call at estate security gate 2; apartment on 1st floor.',
      1
    );
    insertAddr.run(
      customer1Id,
      'Office (Victoria Island)',
      '28 Saka Tinubu Street, Victoria Island',
      'Victoria Island',
      'Lagos',
      'Lagos',
      6.4272,
      3.4254,
      'Drop at service reception bay behind main building.',
      0
    );
    insertAddr.run(
      customer2Id,
      'Home (Ikeja GRA)',
      '7 Joel Ogunnaike Street, Ikeja GRA',
      'Ikeja GRA',
      'Lagos',
      'Lagos',
      6.5833,
      3.3569,
      'Ring intercom 4B at the main gate.',
      1
    );
    insertAddr.run(
      customer3Id,
      'Home (Surulere)',
      '42 Bode Thomas Street, Surulere',
      'Surulere',
      'Lagos',
      'Lagos',
      6.4951,
      3.3588,
      'Flat 3, blue compound gate opposite pharmacy.',
      1
    );

    // 6. Retailers (Centrally Registered & Controlled by Admin — NO Retailer Logins)
    const defaultHours = JSON.stringify({
      mon_fri: '07:00 - 20:30',
      sat: '07:30 - 20:00',
      sun: '09:00 - 18:00',
    });

    const insertRetailer = tdb.prepare(`
      INSERT INTO retailers (
        business_name, slug, contact_person, phone, email, address, neighbourhood, city, state,
        lat, lng, logo_url, cover_image_url, description, operating_hours_json, is_open_now,
        max_delivery_radius_km, coverage_areas_json, base_delivery_fee_kobo, per_km_delivery_fee_kobo,
        estimated_prep_mins, status, rating_avg, review_count, featured, created_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = Number(
      insertRetailer.run(
        'Lekki Gas Hub',
        'lekki-gas-hub',
        'Mr. Babatunde Ogunleye',
        '+234 809 301 1120',
        'ops@lekkigashub.ng',
        'Plot 19 Admiralty Way, Lekki Phase 1',
        'Lekki Phase 1',
        'Lagos',
        'Lagos',
        6.4478,
        3.4723,
        '',
        '/images/retailer-depot.jpg',
        'High-capacity digital-scale LPG refilling depot serving Lekki Phase 1, Oniru, Ikoyi, and Victoria Island with certified clean cooking gas.',
        defaultHours,
        1,
        10.0,
        JSON.stringify(['Lekki Phase 1', 'Victoria Island', 'Ikoyi', 'Oniru', 'Jakande', 'Chevron']),
        100000,
        12000,
        12,
        'APPROVED_ACTIVE',
        4.9,
        42,
        1,
        adminId
      ).lastInsertRowid
    );

    const r2 = Number(
      insertRetailer.run(
        'Victoria Energy Depot',
        'victoria-energy-depot',
        'Mrs. Nkechi Umeh',
        '+234 809 301 2245',
        'desk@victoriaenergy.ng',
        '44 Adeola Odeku Street, Victoria Island',
        'Victoria Island',
        'Lagos',
        'Lagos',
        6.4281,
        3.4219,
        '',
        '/images/retailer-depot.jpg',
        'Express island LPG station specializing in fast household refills, safety-tested cylinders, and genuine brass regulators.',
        defaultHours,
        1,
        8.5,
        JSON.stringify(['Victoria Island', 'Ikoyi', 'Lekki Phase 1', 'Oniru', 'Marina', 'Lagos Island']),
        110000,
        13000,
        10,
        'APPROVED_ACTIVE',
        4.8,
        31,
        1,
        adminId
      ).lastInsertRowid
    );

    const r3 = Number(
      insertRetailer.run(
        'Ikeja Prime LPG',
        'ikeja-prime-lpg',
        'Alhaji Sani Abdullahi',
        '+234 803 551 9902',
        'plant@ikejaprimelpg.ng',
        '82 Allen Avenue, Ikeja',
        'Ikeja',
        'Lagos',
        'Lagos',
        6.6018,
        3.3515,
        '',
        '/images/retailer-depot.jpg',
        'Trusted mainland LPG refilling plant offering competitive per-kg pricing across Ikeja GRA, Opebi, Maryland, Ogba, and Magodo.',
        defaultHours,
        1,
        12.0,
        JSON.stringify(['Ikeja', 'Ikeja GRA', 'Opebi', 'Maryland', 'Ogba', 'Magodo', 'Alausa', 'Ojodu']),
        90000,
        10000,
        14,
        'APPROVED_ACTIVE',
        4.9,
        58,
        1,
        adminId
      ).lastInsertRowid
    );

    const r4 = Number(
      insertRetailer.run(
        'Mainland Flame Station',
        'mainland-flame-station',
        'Mr. Olumide Kolawole',
        '+234 802 440 8821',
        'service@mainlandflame.ng',
        '215 Herbert Macaulay Way, Yaba',
        'Yaba',
        'Lagos',
        'Lagos',
        6.5095,
        3.3711,
        '',
        '/images/retailer-depot.jpg',
        'Central Yaba cooking gas hub serving academic estates, residential apartments, and restaurants across Yaba, Surulere, and Ebute Metta.',
        defaultHours,
        1,
        10.0,
        JSON.stringify(['Yaba', 'Surulere', 'Ebute Metta', 'Gbagada', 'Somolu', 'Akoka', 'Anthony']),
        95000,
        11000,
        15,
        'APPROVED_ACTIVE',
        4.7,
        29,
        1,
        adminId
      ).lastInsertRowid
    );

    const r5 = Number(
      insertRetailer.run(
        'Surulere CleanGas Plant',
        'surulere-cleangas-plant',
        'Mrs. Bukola Fashola',
        '+234 805 612 7390',
        'hello@surulerecleangas.ng',
        '67 Bode Thomas Street, Surulere',
        'Surulere',
        'Lagos',
        'Lagos',
        6.4972,
        3.3566,
        '',
        '/images/retailer-depot.jpg',
        'Accurate electronic-scale gas refills and inspected household accessories serving Surulere, Iponri, Aguda, Yaba, and Festac.',
        defaultHours,
        1,
        9.5,
        JSON.stringify(['Surulere', 'Yaba', 'Iponri', 'Aguda', 'Mushin', 'Festac', 'Amuwo Odofin']),
        90000,
        10500,
        13,
        'APPROVED_ACTIVE',
        4.8,
        36,
        0,
        adminId
      ).lastInsertRowid
    );

    const r6 = Number(
      insertRetailer.run(
        'Gbagada Express LPG',
        'gbagada-express-lpg',
        'Mr. Emeka Nwankwo',
        '+234 818 209 3412',
        'info@gbagadaexpresslpg.ng',
        '18 Diya Street, Gbagada Phase 2',
        'Gbagada',
        'Lagos',
        'Lagos',
        6.5568,
        3.3912,
        '',
        '/images/retailer-depot.jpg',
        'Fast turnaround LPG depot strategically located off Gbagada Expressway serving Gbagada, Anthony, Maryland, Ogudu, and Bariga.',
        defaultHours,
        1,
        10.5,
        JSON.stringify(['Gbagada', 'Anthony', 'Maryland', 'Ogudu', 'Bariga', 'Yaba', 'Ikeja']),
        95000,
        11500,
        15,
        'APPROVED_ACTIVE',
        4.6,
        19,
        0,
        adminId
      ).lastInsertRowid
    );

    const r7 = Number(
      insertRetailer.run(
        'Ajah Coastal Gas Depot',
        'ajah-coastal-gas-depot',
        'Mr. Victor Etim',
        '+234 806 392 5501',
        'ops@ajahcoastalgas.ng',
        'Km 22 Lekki-Epe Expressway, Ajah',
        'Ajah',
        'Lagos',
        'Lagos',
        6.4698,
        3.5852,
        '',
        '/images/retailer-depot.jpg',
        'Reliable cooking gas supply station covering Ajah, VGC, Chevron, Sangotedo, and Abraham Adesanya estates.',
        defaultHours,
        1,
        12.0,
        JSON.stringify(['Ajah', 'VGC', 'Chevron', 'Sangotedo', 'Abraham Adesanya', 'Badore']),
        100000,
        12000,
        16,
        'APPROVED_ACTIVE',
        4.7,
        24,
        0,
        adminId
      ).lastInsertRowid
    );

    const r8 = Number(
      insertRetailer.run(
        'Wuse Central LPG',
        'wuse-central-lpg',
        'Hajiya Amina Suleiman',
        '+234 809 774 6120',
        'depot@wusecentrallpg.ng',
        'Plot 512 Aminu Kano Crescent, Wuse II',
        'Wuse II',
        'Abuja',
        'FCT Abuja',
        9.0765,
        7.4812,
        '',
        '/images/retailer-depot.jpg',
        'Abuja flagship cooking gas refilling hub delivering verified LPG refills and cylinders across Wuse, Maitama, Garki, Utako, and Gwarinpa.',
        defaultHours,
        1,
        15.0,
        JSON.stringify(['Wuse II', 'Wuse', 'Maitama', 'Garki', 'Utako', 'Jabi', 'Gwarinpa']),
        105000,
        11000,
        15,
        'APPROVED_ACTIVE',
        4.9,
        33,
        1,
        adminId
      ).lastInsertRowid
    );

    // Unapproved/pending retailer — MUST ONLY be visible to Admin, NEVER on Customer Map!
    insertRetailer.run(
      'Ikoyi Reserve LPG Point (Pending Inspection)',
      'ikoyi-reserve-lpg-point',
      'Mr. Damilola Sowore',
      '+234 809 998 4011',
      'compliance@ikoyireservelpg.ng',
      '12 Awolowo Road, Ikoyi',
      'Ikoyi',
      'Lagos',
      'Lagos',
      6.4452,
      3.4287,
      '',
      '/images/retailer-depot.jpg',
      'Awaiting final safety calibration and Operations Director activation before appearing publicly on the customer map.',
      defaultHours,
      0,
      7.0,
      JSON.stringify(['Ikoyi', 'Victoria Island']),
      110000,
      12000,
      15,
      'PENDING_APPROVAL',
      5.0,
      0,
      0,
      adminId
    );

    // Save favourite retailers for Amaka
    tdb.prepare('INSERT INTO favourite_retailers (user_id, retailer_id) VALUES (?, ?)').run(customer1Id, r1);
    tdb.prepare('INSERT INTO favourite_retailers (user_id, retailer_id) VALUES (?, ?)').run(customer1Id, r2);

    // 7. Product Categories & Products
    const insertCat = tdb.prepare(`
      INSERT INTO product_categories (name, slug, type, description, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    const catRefill = Number(
      insertCat.run('Cooking Gas Refills', 'cooking-gas-refills', 'GAS_REFILL', 'Weighed domestic & commercial LPG gas refills', 1)
        .lastInsertRowid
    );
    const catCylinders = Number(
      insertCat.run('Gas Cylinders', 'gas-cylinders', 'CYLINDER', 'SON-certified brand new steel LPG cylinders', 2)
        .lastInsertRowid
    );
    const catAcc = Number(
      insertCat.run('Gas Accessories', 'gas-accessories', 'ACCESSORY', 'Safety-tested regulators, hoses, burners, and seals', 3)
        .lastInsertRowid
    );

    const insertProd = tdb.prepare(`
      INSERT INTO products (category_id, name, slug, size_kg, unit_label, description, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const p1kg = Number(insertProd.run(catRefill, '1kg Cooking Gas Refill', 'gas-refill-1kg', 1, '1kg', 'Quick 1kg LPG top-up for compact camp cylinders.', '/images/product-refill-small.jpg').lastInsertRowid);
    const p2kg = Number(insertProd.run(catRefill, '2kg Cooking Gas Refill', 'gas-refill-2kg', 2, '2kg', 'Measured 2kg domestic LPG cooking gas refill.', '/images/product-refill-small.jpg').lastInsertRowid);
    const p3kg = Number(insertProd.run(catRefill, '3kg Cooking Gas Refill', 'gas-refill-3kg', 3, '3kg', 'Popular 3kg camp-gas refill for student and studio kitchens.', '/images/product-refill-small.jpg').lastInsertRowid);
    const p5kg = Number(insertProd.run(catRefill, '5kg Cooking Gas Refill', 'gas-refill-5kg', 5, '5kg', 'Precision-weighed 5kg domestic LPG refill.', '/images/product-refill-small.jpg').lastInsertRowid);
    const p6kg = Number(insertProd.run(catRefill, '6kg Cooking Gas Refill', 'gas-refill-6kg', 6, '6kg', 'Standard 6kg compact household LPG cylinder refill.', '/images/product-refill-small.jpg').lastInsertRowid);
    const p12kg = Number(insertProd.run(catRefill, '12.5kg Cooking Gas Refill', 'gas-refill-12-5kg', 12.5, '12.5kg', 'Nigeria’s most popular family-size 12.5kg cooking gas refill, digitally weighed.', '/images/product-refill-12kg.jpg').lastInsertRowid);
    const p25kg = Number(insertProd.run(catRefill, '25kg Cooking Gas Refill', 'gas-refill-25kg', 25, '25kg', 'Large household & catering 25kg LPG refill.', '/images/product-refill-large.jpg').lastInsertRowid);
    const p50kg = Number(insertProd.run(catRefill, '50kg Cooking Gas Refill', 'gas-refill-50kg', 50, '50kg', 'Commercial kitchen, bakery & hotel 50kg industrial LPG refill.', '/images/product-refill-large.jpg').lastInsertRowid);

    const pCyl6 = Number(insertProd.run(catCylinders, '6kg New Steel Gas Cylinder', 'cylinder-6kg-new', 6, '6kg Cylinder', 'SON-certified empty 6kg powder-coated steel LPG cylinder with brass valve.', '/images/product-refill-small.jpg').lastInsertRowid);
    const pCyl12 = Number(insertProd.run(catCylinders, '12.5kg New Steel Gas Cylinder', 'cylinder-12-5kg-new', 12.5, '12.5kg Cylinder', 'Heavy-duty SON-approved 12.5kg domestic steel LPG cylinder (empty, ready to fill).', '/images/product-refill-12kg.jpg').lastInsertRowid);

    const pReg = Number(insertProd.run(catAcc, 'High-Pressure Brass Gas Regulator', 'brass-gas-regulator', null, '1 Unit', 'Safety pressure-gauge LPG regulator compatible with standard Nigerian valves.', '/images/product-accessories.jpg').lastInsertRowid);
    const pHose = Number(insertProd.run(catAcc, 'Reinforced 2m Gas Hose & Clamps', 'reinforced-gas-hose-2m', null, '2m Set', 'Heavy-duty double-layer anti-kink LPG hose with stainless steel jubilee clips.', '/images/product-accessories.jpg').lastInsertRowid);
    const pBurner = Number(insertProd.run(catAcc, 'Cast-Iron Camp Burner Head', 'camp-burner-head', null, '1 Unit', 'Durable cast-iron screw-on burner top for 3kg/5kg/6kg camp cylinders.', '/images/product-accessories.jpg').lastInsertRowid);

    // 8. Independent Retailer Pricing Matrix (Prices vary genuinely across retailers!)
    // Base per-kg selling prices vary by retailer (e.g., ₦1,160/kg to ₦1,240/kg)
    const retailerPriceConfigs: { retailerId: number; perKgNaira: number; supplyRatio: number; accOffset: number }[] = [
      { retailerId: r1, perKgNaira: 1184, supplyRatio: 0.91, accOffset: 0 },     // Lekki Gas Hub: 12.5kg = ₦14,800, 5kg = ₦5,920 -> rounded ₦6,000
      { retailerId: r2, perKgNaira: 1216, supplyRatio: 0.90, accOffset: 500 },   // Victoria Energy: 12.5kg = ₦15,200
      { retailerId: r3, perKgNaira: 1160, supplyRatio: 0.92, accOffset: -300 },  // Ikeja Prime: 12.5kg = ₦14,500
      { retailerId: r4, perKgNaira: 1176, supplyRatio: 0.91, accOffset: -100 },  // Mainland Flame: 12.5kg = ₦14,700
      { retailerId: r5, perKgNaira: 1168, supplyRatio: 0.91, accOffset: -200 },  // Surulere CleanGas: 12.5kg = ₦14,600
      { retailerId: r6, perKgNaira: 1192, supplyRatio: 0.91, accOffset: 0 },     // Gbagada Express: 12.5kg = ₦14,900
      { retailerId: r7, perKgNaira: 1180, supplyRatio: 0.91, accOffset: 100 },   // Ajah Coastal: 12.5kg = ₦14,750
      { retailerId: r8, perKgNaira: 1200, supplyRatio: 0.90, accOffset: 200 },   // Wuse Central Abuja: 12.5kg = ₦15,000
    ];

    const insertRP = tdb.prepare(`
      INSERT INTO retailer_products (retailer_id, product_id, selling_price_kobo, retailer_supply_cost_kobo, stock_quantity, is_available)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

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

    for (const cfg of retailerPriceConfigs) {
      for (const p of refillProducts) {
        const sellNaira = Math.round((p.kg * cfg.perKgNaira) / 50) * 50;
        const sellKobo = sellNaira * 100;
        const supplyKobo = Math.round((sellNaira * cfg.supplyRatio) / 50) * 50 * 100;
        const id = Number(
          insertRP.run(cfg.retailerId, p.id, sellKobo, supplyKobo, p.stock, 1).lastInsertRowid
        );
        rpLookup.set(`${cfg.retailerId}-${p.id}`, { id, sell: sellKobo, supply: supplyKobo });
      }

      // Cylinders & Accessories
      const extras = [
        { id: pCyl6, sellNaira: 22500 + cfg.accOffset, stock: 10 },
        { id: pCyl12, sellNaira: 38500 + cfg.accOffset, stock: 14 },
        { id: pReg, sellNaira: 6500 + cfg.accOffset, stock: 25 },
        { id: pHose, sellNaira: 4200 + cfg.accOffset, stock: 30 },
        { id: pBurner, sellNaira: 5500 + cfg.accOffset, stock: 18 },
      ];
      for (const ex of extras) {
        const sellKobo = ex.sellNaira * 100;
        const supplyKobo = Math.round((ex.sellNaira * 0.86) / 100) * 100 * 100;
        const id = Number(
          insertRP.run(cfg.retailerId, ex.id, sellKobo, supplyKobo, ex.stock, 1).lastInsertRowid
        );
        rpLookup.set(`${cfg.retailerId}-${ex.id}`, { id, sell: sellKobo, supply: supplyKobo });
      }
    }

    // 9. Promotions
    const insertPromo = tdb.prepare(`
      INSERT INTO promotions (code, title, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, usage_limit, used_count, valid_from, valid_until, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insertPromo.run(
      'WELCOME500',
      '₦500 Off First Gas Refill',
      'Instant ₦500 discount on cooking gas orders of ₦10,000 or more.',
      'FIXED',
      50000,
      1000000,
      50000,
      500,
      14,
      '2026-01-01',
      '2027-12-31'
    );
    insertPromo.run(
      'REFILL5',
      '5% Wallet Refill Savings',
      'Enjoy 5% off up to ₦1,500 on cooking gas refills.',
      'PERCENT',
      5,
      500000,
      150000,
      1000,
      27,
      '2026-01-01',
      '2027-12-31'
    );

    // 10. Seed Wallet Funding Ledger + Gateway Transactions
    const insertGw = tdb.prepare(`
      INSERT INTO gateway_transactions (reference, idempotency_key, user_id, purpose, order_id, provider, channel, amount_kobo, status, provider_response_json, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertWtx = tdb.prepare(`
      INSERT INTO wallet_transactions (wallet_id, user_id, reference, idempotency_key, type, direction, amount_kobo, balance_before_kobo, balance_after_kobo, status, payment_method, gateway_provider, gateway_reference, order_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAudit = tdb.prepare(`
      INSERT INTO financial_audit_logs (event_type, actor_user_id, actor_role, entity_type, entity_id, reference, amount_kobo, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertGw.run(
      'BF-WLT-20261110-A101',
      'SEED-WLT-1',
      customer1Id,
      'WALLET_FUNDING',
      null,
      'PAYSTACK',
      'CARD',
      6000000,
      'VERIFIED_SUCCESS',
      JSON.stringify({ provider: 'PAYSTACK', channel: 'card', last4: '4081', bank: 'GTBank' }),
      '2026-11-10 09:15:00',
      '2026-11-10 09:14:30'
    );
    insertWtx.run(
      wallet1Id,
      customer1Id,
      'BF-WLT-20261110-A101',
      'SEED-WLT-TX-1',
      'FUNDING',
      'CREDIT',
      6000000,
      0,
      6000000,
      'SUCCESS',
      'CARD',
      'PAYSTACK',
      'BF-WLT-20261110-A101',
      null,
      'Wallet funded via Paystack (Debit Card)',
      '2026-11-10 09:15:00'
    );
    insertAudit.run(
      'WALLET_FUNDED_VERIFIED',
      customer1Id,
      'CUSTOMER',
      'wallet',
      String(wallet1Id),
      'BF-WLT-20261110-A101',
      6000000,
      JSON.stringify({ provider: 'PAYSTACK' }),
      '2026-11-10 09:15:00'
    );

    insertGw.run(
      'BF-WLT-20261112-B202',
      'SEED-WLT-2',
      customer2Id,
      'WALLET_FUNDING',
      null,
      'FLUTTERWAVE',
      'BANK_TRANSFER',
      3500000,
      'VERIFIED_SUCCESS',
      JSON.stringify({ provider: 'FLUTTERWAVE', channel: 'bank_transfer', bank: 'Access Bank' }),
      '2026-11-12 14:22:00',
      '2026-11-12 14:20:00'
    );
    insertWtx.run(
      wallet2Id,
      customer2Id,
      'BF-WLT-20261112-B202',
      'SEED-WLT-TX-2',
      'FUNDING',
      'CREDIT',
      3500000,
      0,
      3500000,
      'SUCCESS',
      'BANK_TRANSFER',
      'FLUTTERWAVE',
      'BF-WLT-20261112-B202',
      null,
      'Wallet funded via Flutterwave (Bank Transfer)',
      '2026-11-12 14:22:00'
    );

    // 11. Realistic Seeded Orders across lifecycle stages
    const insertOrder = tdb.prepare(`
      INSERT INTO orders (
        order_reference, customer_id, retailer_id, dispatcher_id, status, payment_method, payment_status,
        payment_reference, gateway_provider, delivery_address, delivery_neighbourhood, delivery_city, delivery_state,
        delivery_lat, delivery_lng, delivery_instructions, distance_km, estimated_delivery_mins,
        subtotal_kobo, retailer_supply_total_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo,
        total_amount_kobo, platform_margin_kobo, delivery_confirmation_code, proof_of_delivery_note,
        failure_reason, failure_notes, assigned_at, accepted_at, collected_at, in_transit_at, delivered_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrderItem = tdb.prepare(`
      INSERT INTO order_items (order_id, retailer_product_id, product_id, product_name, size_kg, quantity, unit_price_kobo, unit_supply_cost_kobo, line_total_kobo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertHist = tdb.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSettlement = tdb.prepare(`
      INSERT INTO retailer_settlements (retailer_id, order_id, product_sale_kobo, agreed_retailer_payout_kobo, platform_margin_kobo, status, settlement_reference, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEarning = tdb.prepare(`
      INSERT INTO dispatcher_earnings (dispatcher_id, order_id, compensation_model, base_amount_kobo, distance_bonus_kobo, admin_bonus_kobo, total_earning_kobo, status, payout_reference, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Order 1: DELIVERED (Amaka -> Lekki Gas Hub, Emeka delivered)
    const r1_12kg = rpLookup.get(`${r1}-${p12kg}`)!;
    const ord1Sub = r1_12kg.sell;
    const ord1Sup = r1_12kg.supply;
    const ord1Del = 115000;
    const ord1Svc = 30000;
    const ord1Tot = ord1Sub + ord1Del + ord1Svc;
    const ord1Margin = ord1Sub - ord1Sup + ord1Svc;

    const ord1Id = Number(
      insertOrder.run(
        'BF-ORD-20261111-1001',
        customer1Id,
        r1,
        dispatcher1Id,
        'DELIVERED',
        'WALLET',
        'PAID',
        'BF-WLP-20261111-E01',
        null,
        '14B Admiralty Road, off Admiralty Way, Lekki Phase 1',
        'Lekki Phase 1',
        'Lagos',
        'Lagos',
        6.4432,
        3.4658,
        'Call at estate gate 2',
        0.9,
        24,
        ord1Sub,
        ord1Sup,
        ord1Del,
        ord1Svc,
        0,
        ord1Tot,
        ord1Margin,
        '4829',
        'Customer confirmed weight seal and signed off with PIN 4829.',
        '',
        '',
        '2026-11-11 10:12:00',
        '2026-11-11 10:15:00',
        '2026-11-11 10:28:00',
        '2026-11-11 10:31:00',
        '2026-11-11 10:44:00',
        '2026-11-11 10:08:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord1Id, r1_12kg.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r1_12kg.sell, r1_12kg.supply, ord1Sub);
    insertHist.run(ord1Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', customer1Id, 'SYSTEM', 'Paid via Customer Wallet', '2026-11-11 10:08:05');
    insertHist.run(ord1Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Emeka Obi', '2026-11-11 10:12:00');
    insertHist.run(ord1Id, 'IN_TRANSIT', 'DELIVERED', dispatcher1Id, 'DISPATCHER', 'Delivered successfully with confirmation PIN', '2026-11-11 10:44:00');
    insertSettlement.run(r1, ord1Id, ord1Sub, ord1Sup, ord1Sub - ord1Sup, 'PAID', 'BF-STL-20261112-001', '2026-11-12 16:00:00', '2026-11-11 10:08:05');
    insertEarning.run(dispatcher1Id, ord1Id, 'FIXED_PLUS_DISTANCE', 85000, 8100, 0, 93100, 'PAID', 'BF-DSP-20261112-001', '2026-11-12 17:00:00', '2026-11-11 10:44:00');
    insertWtx.run(wallet1Id, customer1Id, 'BF-WLP-20261111-E01', 'SEED-WLP-1', 'ORDER_PAYMENT', 'DEBIT', ord1Tot, 6000000, 6000000 - ord1Tot, 'SUCCESS', 'WALLET', null, null, ord1Id, 'Cooking gas order payment · BF-ORD-20261111-1001', '2026-11-11 10:08:05');
    tdb.prepare('UPDATE wallets SET balance_kobo = ? WHERE id = ?').run(4500000, wallet1Id);

    // Review for Order 1
    tdb.prepare(`
      INSERT INTO reviews (order_id, customer_id, retailer_id, dispatcher_id, retailer_rating, dispatcher_rating, comment, created_at)
      VALUES (?, ?, ?, ?, 5, 5, ?, '2026-11-11 11:20:00')
    `).run(ord1Id, customer1Id, r1, dispatcher1Id, 'Exact 12.5kg digital weight and super polite dispatcher. Arrived faster than expected.');

    // Order 2: DELIVERED (Tunde -> Ikeja Prime LPG, Musa delivered)
    const r3_12kg = rpLookup.get(`${r3}-${p12kg}`)!;
    const r3_reg = rpLookup.get(`${r3}-${pReg}`)!;
    const ord2Sub = r3_12kg.sell + r3_reg.sell;
    const ord2Sup = r3_12kg.supply + r3_reg.supply;
    const ord2Del = 115000;
    const ord2Svc = 41500;
    const ord2Tot = ord2Sub + ord2Del + ord2Svc;

    const ord2Id = Number(
      insertOrder.run(
        'BF-ORD-20261113-1002',
        customer2Id,
        r3,
        dispatcher2Id,
        'DELIVERED',
        'WALLET',
        'PAID',
        'BF-WLP-20261113-E02',
        null,
        '7 Joel Ogunnaike Street, Ikeja GRA',
        'Ikeja GRA',
        'Lagos',
        'Lagos',
        6.5833,
        3.3569,
        'Ring intercom 4B',
        2.1,
        29,
        ord2Sub,
        ord2Sup,
        ord2Del,
        ord2Svc,
        0,
        ord2Tot,
        ord2Sub - ord2Sup + ord2Svc,
        '7314',
        'Delivered 12.5kg refill + regulator; tested fit at customer kitchen door.',
        '',
        '',
        '2026-11-13 15:10:00',
        '2026-11-13 15:14:00',
        '2026-11-13 15:30:00',
        '2026-11-13 15:35:00',
        '2026-11-13 15:48:00',
        '2026-11-13 15:05:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord2Id, r3_12kg.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r3_12kg.sell, r3_12kg.supply, r3_12kg.sell);
    insertOrderItem.run(ord2Id, r3_reg.id, pReg, 'High-Pressure Brass Gas Regulator', null, 1, r3_reg.sell, r3_reg.supply, r3_reg.sell);
    insertSettlement.run(r3, ord2Id, ord2Sub, ord2Sup, ord2Sub - ord2Sup, 'APPROVED', 'BF-STL-20261113-002', null, '2026-11-13 15:05:10');
    insertEarning.run(dispatcher2Id, ord2Id, 'FIXED_PLUS_DISTANCE', 90000, 17850, 0, 107850, 'APPROVED', 'BF-DSP-20261113-002', null, '2026-11-13 15:48:00');
    tdb.prepare(`
      INSERT INTO reviews (order_id, customer_id, retailer_id, dispatcher_id, retailer_rating, dispatcher_rating, comment, created_at)
      VALUES (?, ?, ?, ?, 5, 5, ?, '2026-11-13 16:30:00')
    `).run(ord2Id, customer2Id, r3, dispatcher2Id, 'Best gas price in Ikeja and clean brass regulator. Highly recommended.');

    // Order 3: ACTIVE IN_TRANSIT (Amaka -> Victoria Energy Depot, Emeka currently en route with Live Tracking ON!)
    const r2_12kg = rpLookup.get(`${r2}-${p12kg}`)!;
    const ord3Sub = r2_12kg.sell;
    const ord3Sup = r2_12kg.supply;
    const ord3Del = 145000;
    const ord3Svc = 30500;
    const ord3Tot = ord3Sub + ord3Del + ord3Svc;

    const ord3Id = Number(
      insertOrder.run(
        'BF-ORD-20261116-1003',
        customer1Id,
        r2,
        dispatcher1Id,
        'IN_TRANSIT',
        'DIRECT_ONLINE',
        'PAID',
        'BF-PAY-20261116-9041',
        'PAYSTACK',
        '14B Admiralty Road, off Admiralty Way, Lekki Phase 1',
        'Lekki Phase 1',
        'Lagos',
        'Lagos',
        6.4432,
        3.4658,
        'Call at estate security gate 2; apartment on 1st floor.',
        5.1,
        34,
        ord3Sub,
        ord3Sup,
        ord3Del,
        ord3Svc,
        0,
        ord3Tot,
        ord3Sub - ord3Sup + ord3Svc,
        '6194',
        '',
        '',
        '',
        '2026-11-16 09:05:00',
        '2026-11-16 09:07:00',
        '2026-11-16 09:20:00',
        '2026-11-16 09:24:00',
        null,
        '2026-11-16 09:00:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord3Id, r2_12kg.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r2_12kg.sell, r2_12kg.supply, ord3Sub);
    insertGw.run('BF-PAY-20261116-9041', 'SEED-ORD-3', customer1Id, 'ORDER_PAYMENT', ord3Id, 'PAYSTACK', 'CARD', ord3Tot, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'PAYSTACK', last4: '4081' }), '2026-11-16 09:00:12', '2026-11-16 09:00:00');
    insertHist.run(ord3Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', customer1Id, 'SYSTEM', 'Verified Paystack card payment', '2026-11-16 09:00:12');
    insertHist.run(ord3Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Emeka Obi (closest online dispatcher)', '2026-11-16 09:05:00');
    insertHist.run(ord3Id, 'ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', dispatcher1Id, 'DISPATCHER', 'Accepted job and heading to Victoria Energy Depot', '2026-11-16 09:07:00');
    insertHist.run(ord3Id, 'ACCEPTED_BY_DISPATCHER', 'COLLECTED_FROM_RETAILER', dispatcher1Id, 'DISPATCHER', 'Collected sealed 12.5kg cylinder', '2026-11-16 09:20:00');
    insertHist.run(ord3Id, 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT', dispatcher1Id, 'DISPATCHER', 'Crossing Lekki-Ikoyi link road towards Admiralty Way', '2026-11-16 09:24:00');
    insertSettlement.run(r2, ord3Id, ord3Sub, ord3Sup, ord3Sub - ord3Sup, 'PENDING', 'BF-STL-20261116-003', null, '2026-11-16 09:00:12');

    // Order 4: ASSIGNED_TO_DISPATCHER (Waiting for Emeka Obi to accept in Dispatcher Dashboard!)
    const r1_6kg = rpLookup.get(`${r1}-${p6kg}`)!;
    const ord4Sub = r1_6kg.sell;
    const ord4Sup = r1_6kg.supply;
    const ord4Del = 120000;
    const ord4Svc = 20000;
    const ord4Tot = ord4Sub + ord4Del + ord4Svc;

    const ord4Id = Number(
      insertOrder.run(
        'BF-ORD-20261116-1004',
        customer1Id,
        r1,
        dispatcher1Id,
        'ASSIGNED_TO_DISPATCHER',
        'WALLET',
        'PAID',
        'BF-WLP-20261116-9042',
        null,
        '28 Saka Tinubu Street, Victoria Island',
        'Victoria Island',
        'Lagos',
        'Lagos',
        6.4272,
        3.4254,
        'Drop at service reception bay behind main building.',
        5.6,
        35,
        ord4Sub,
        ord4Sup,
        ord4Del,
        ord4Svc,
        0,
        ord4Tot,
        ord4Sub - ord4Sup + ord4Svc,
        '3907',
        '',
        '',
        '',
        '2026-11-16 10:15:00',
        null,
        null,
        null,
        null,
        '2026-11-16 10:10:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord4Id, r1_6kg.id, p6kg, '6kg Cooking Gas Refill', 6, 1, r1_6kg.sell, r1_6kg.supply, ord4Sub);
    insertHist.run(ord4Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', customer1Id, 'SYSTEM', 'Paid via BlueFlame Wallet', '2026-11-16 10:10:05');
    insertHist.run(ord4Id, 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER', adminId, 'ADMIN', 'Assigned to Emeka Obi', '2026-11-16 10:15:00');
    insertSettlement.run(r1, ord4Id, ord4Sub, ord4Sup, ord4Sub - ord4Sup, 'PENDING', 'BF-STL-20261116-004', null, '2026-11-16 10:10:05');

    // Order 5: AWAITING_DISPATCHER_ASSIGNMENT (Ready for Admin Manual or Auto Assignment!)
    const r3_5kg = rpLookup.get(`${r3}-${p5kg}`)!;
    const r3_hose = rpLookup.get(`${r3}-${pHose}`)!;
    const ord5Sub = r3_5kg.sell + r3_hose.sell;
    const ord5Sup = r3_5kg.supply + r3_hose.supply;
    const ord5Del = 110000;
    const ord5Svc = 20000;
    const ord5Tot = ord5Sub + ord5Del + ord5Svc;

    const ord5Id = Number(
      insertOrder.run(
        'BF-ORD-20261116-1005',
        customer2Id,
        r3,
        null,
        'AWAITING_DISPATCHER_ASSIGNMENT',
        'DIRECT_ONLINE',
        'PAID',
        'BF-PAY-20261116-9055',
        'FLUTTERWAVE',
        '7 Joel Ogunnaike Street, Ikeja GRA',
        'Ikeja GRA',
        'Lagos',
        'Lagos',
        6.5833,
        3.3569,
        'Ring intercom 4B at the main gate.',
        2.1,
        28,
        ord5Sub,
        ord5Sup,
        ord5Del,
        ord5Svc,
        0,
        ord5Tot,
        ord5Sub - ord5Sup + ord5Svc,
        '8251',
        '',
        '',
        '',
        null,
        null,
        null,
        null,
        null,
        '2026-11-16 10:42:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord5Id, r3_5kg.id, p5kg, '5kg Cooking Gas Refill', 5, 1, r3_5kg.sell, r3_5kg.supply, r3_5kg.sell);
    insertOrderItem.run(ord5Id, r3_hose.id, pHose, 'Reinforced 2m Gas Hose & Clamps', null, 1, r3_hose.sell, r3_hose.supply, r3_hose.sell);
    insertGw.run('BF-PAY-20261116-9055', 'SEED-ORD-5', customer2Id, 'ORDER_PAYMENT', ord5Id, 'FLUTTERWAVE', 'BANK_TRANSFER', ord5Tot, 'VERIFIED_SUCCESS', JSON.stringify({ provider: 'FLUTTERWAVE', channel: 'bank_transfer' }), '2026-11-16 10:42:10', '2026-11-16 10:42:00');
    insertHist.run(ord5Id, 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', customer2Id, 'SYSTEM', 'Verified Flutterwave bank transfer', '2026-11-16 10:42:10');
    insertHist.run(ord5Id, 'PAYMENT_CONFIRMED', 'AWAITING_DISPATCHER_ASSIGNMENT', customer2Id, 'SYSTEM', 'Queued for Operations dispatcher assignment', '2026-11-16 10:42:11');
    insertSettlement.run(r3, ord5Id, ord5Sub, ord5Sup, ord5Sub - ord5Sup, 'PENDING', 'BF-STL-20261116-005', null, '2026-11-16 10:42:10');

    // Order 6: DELIVERY_FAILED (So Admin can review failed delivery & either reassign or refund to wallet!)
    const r5_12kg = rpLookup.get(`${r5}-${p12kg}`)!;
    const ord6Sub = r5_12kg.sell;
    const ord6Sup = r5_12kg.supply;
    const ord6Del = 100000;
    const ord6Svc = 29200;
    const ord6Tot = ord6Sub + ord6Del + ord6Svc;

    const ord6Id = Number(
      insertOrder.run(
        'BF-ORD-20261115-1006',
        customer3Id,
        r5,
        dispatcher3Id,
        'DELIVERY_FAILED',
        'WALLET',
        'PAID',
        'BF-WLP-20261115-8812',
        null,
        '42 Bode Thomas Street, Surulere',
        'Surulere',
        'Lagos',
        'Lagos',
        6.4951,
        3.3588,
        'Flat 3, blue compound gate',
        0.4,
        22,
        ord6Sub,
        ord6Sup,
        ord6Del,
        ord6Svc,
        0,
        ord6Tot,
        ord6Sub - ord6Sup + ord6Svc,
        '5103',
        '',
        'CUSTOMER_UNAVAILABLE',
        'Called customer three times at the gate and waited 20 minutes; estate security confirmed flat occupants stepped out.',
        '2026-11-15 17:10:00',
        '2026-11-15 17:12:00',
        '2026-11-15 17:25:00',
        '2026-11-15 17:30:00',
        null,
        '2026-11-15 17:05:00'
      ).lastInsertRowid
    );
    insertOrderItem.run(ord6Id, r5_12kg.id, p12kg, '12.5kg Cooking Gas Refill', 12.5, 1, r5_12kg.sell, r5_12kg.supply, ord6Sub);
    insertHist.run(ord6Id, 'IN_TRANSIT', 'DELIVERY_FAILED', dispatcher3Id, 'DISPATCHER', 'Reported: Customer unavailable at delivery address', '2026-11-15 17:52:00');
    insertSettlement.run(r5, ord6Id, ord6Sub, ord6Sup, ord6Sub - ord6Sup, 'PENDING', 'BF-STL-20261115-006', null, '2026-11-15 17:05:10');

    // Open Complaint for Order 6
    tdb.prepare(`
      INSERT INTO complaints (ticket_number, customer_id, order_id, category, subject, description, status, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 'HIGH', '2026-11-15 19:10:00')
    `).run(
      'BF-TKT-20261115-01',
      customer3Id,
      ord6Id,
      'DELIVERY_ISSUE',
      'Missed delivery on Bode Thomas — please reschedule or refund',
      'My phone battery died briefly while I stepped out. Kindly reschedule the delivery for tomorrow morning or refund my BlueFlame wallet.',
    );

    // Seed Notifications across all 3 roles
    const insertNotif = tdb.prepare(`
      INSERT INTO notifications (user_id, role_scope, title, message, type, channels_json, related_order_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run(customer1Id, 'CUSTOMER', 'Your Cooking Gas Is On The Way!', 'Emeka Obi is in transit with order BF-ORD-20261116-1003. Have your confirmation PIN (6194) ready.', 'DELIVERY', '["IN_APP","SMS"]', ord3Id, 0, '2026-11-16 09:24:00');
    insertNotif.run(customer1Id, 'CUSTOMER', 'Dispatcher Assigned to Your Order', 'Emeka Obi has been assigned to deliver your order BF-ORD-20261116-1004.', 'DELIVERY', '["IN_APP"]', ord4Id, 0, '2026-11-16 10:15:00');
    insertNotif.run(dispatcher1Id, 'DISPATCHER', 'New Delivery Assignment', 'Order BF-ORD-20261116-1004: Collect 6kg refill from Lekki Gas Hub and deliver to 28 Saka Tinubu St, VI.', 'DISPATCH', '["IN_APP","SMS"]', ord4Id, 0, '2026-11-16 10:15:00');
    insertNotif.run(adminId, 'ADMIN', 'New Direct-Paid Order Ready for Dispatch', 'Order BF-ORD-20261116-1005 (Flutterwave Verified) is awaiting dispatcher assignment.', 'ORDER', '["IN_APP","EMAIL"]', ord5Id, 0, '2026-11-16 10:42:10');
    insertNotif.run(adminId, 'ADMIN', 'Failed Delivery Requires Action', 'Dispatcher Segun Adeyemi reported CUSTOMER_UNAVAILABLE on order BF-ORD-20261115-1006.', 'ALERT', '["IN_APP","EMAIL"]', ord6Id, 0, '2026-11-15 17:52:00');
  });

  console.log('[BlueFlame] Seeded initial Nigerian cooking gas marketplace database.');
}

// Allow standalone CLI invocation: npm run seed
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabaseIfEmpty();
  console.log('[BlueFlame] Seed check complete.');
}
