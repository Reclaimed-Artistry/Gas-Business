import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Phone, Mail, Clock, Lock } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export function Footer() {
  return (
    <footer className="bg-[#06265B] text-white mt-16 border-t border-[#073B8C] no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="space-y-4">
            <BrandLogo inverted />
            <p className="text-xs text-[#EAF3FF]/80 leading-relaxed">
              Uyo’s centrally verified cooking gas marketplace and managed LPG delivery network in Akwa Ibom State.
              Every listed depot is vetted, monitored, and price-verified by Gasflo Operations — built to expand
              across Akwa Ibom and neighbouring states.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#073B8C] border border-white/15 text-xs font-semibold text-[#EAF3FF]">
              <Lock className="w-3.5 h-3.5" />
              100% Cashless Verified Payments
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white mb-3">Marketplace</h4>
            <ul className="space-y-2 text-xs text-[#EAF3FF]/80">
              <li>
                <Link to="/explore" className="hover:text-white transition-colors">
                  Interactive Retailer Map
                </Link>
              </li>
              <li>
                <Link to="/explore?view=compare" className="hover:text-white transition-colors">
                  Compare Cooking Gas Prices
                </Link>
              </li>
              <li>
                <Link to="/dashboard?tab=wallet" className="hover:text-white transition-colors">
                  Customer Digital Wallet
                </Link>
              </li>
              <li>
                <Link to="/dashboard?tab=orders" className="hover:text-white transition-colors">
                  Track Active Delivery
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white mb-3">Active Coverage</h4>
            <ul className="space-y-2 text-xs text-[#EAF3FF]/80">
              <li>Uyo Central — Ewet Housing, Oron Rd, Udo Udoma</li>
              <li>Uyo South — Shelter Afrique, Osongama, Aka Rd</li>
              <li>Uyo North & East — Ikot Ekpene Rd, UNIUYO, Nwaniba, Abak Rd</li>
              <li className="text-[#EAF3FF]/60 pt-1">
                Currently serving Uyo, Akwa Ibom · Expanding next to Eket, Ikot Ekpene &amp; Calabar
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white mb-3">Customer Support</h4>
            <ul className="space-y-2.5 text-xs text-[#EAF3FF]/85">
              <li className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-[#EAF3FF]" />
                <span>+234 800 258 3352</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-[#EAF3FF]" />
                <span>support@blueflame.ng</span>
              </li>
              <li className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#EAF3FF]" />
                <span>Daily, 6:30 AM – 9:30 PM WAT</span>
              </li>
              <li className="flex items-center gap-2 pt-1 text-[#EAF3FF]/70">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Paystack & Flutterwave Secured</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#EAF3FF]/65">
          <p>© {new Date().getFullYear()} Gasflo. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span>Dispatchers never accept physical cash.</span>
            <span>·</span>
            <Link to="/login" className="hover:text-white">
              Staff & Customer Sign In
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
