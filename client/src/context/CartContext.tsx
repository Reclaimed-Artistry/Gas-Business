import React, { createContext, useContext, useState } from 'react';
import type { CartItem } from '../types';

const CART_KEY = 'blueflame_cart_v1';

interface CartContextValue {
  items: CartItem[];
  retailerId: number | null;
  retailerName: string | null;
  totalItems: number;
  subtotalKobo: number;
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => { switchedRetailer: boolean };
  updateQuantity: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);

  const persist = (next: CartItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const addItem = (item: Omit<CartItem, 'quantity'>, quantity = 1): { switchedRetailer: boolean } => {
    let switchedRetailer = false;
    setItems((prev) => {
      let base = prev;
      if (prev.length > 0 && prev[0].retailerId !== item.retailerId) {
        switchedRetailer = true;
        base = [];
      }
      const existing = base.find((i) => i.productId === item.productId);
      let next: CartItem[];
      if (existing) {
        next = base.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: Math.min(i.maxStock, i.quantity + quantity) }
            : i
        );
      } else {
        next = [...base, { ...item, quantity: Math.min(item.maxStock, quantity) }];
      }
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    return { switchedRetailer };
  };

  const updateQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      persist(items.filter((i) => i.productId !== productId));
      return;
    }
    persist(items.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(i.maxStock, quantity) } : i)));
  };

  const removeItem = (productId: number) => {
    persist(items.filter((i) => i.productId !== productId));
  };

  const clearCart = () => {
    persist([]);
  };

  const retailerId = items.length > 0 ? items[0].retailerId : null;
  const retailerName = items.length > 0 ? items[0].retailerName : null;
  const totalItems = items.reduce((acc, i) => acc + i.quantity, 0);
  const subtotalKobo = items.reduce((acc, i) => acc + i.sellingPriceKobo * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        retailerId,
        retailerName,
        totalItems,
        subtotalKobo,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
