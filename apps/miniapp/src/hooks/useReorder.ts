import type { OrderDto } from '@istock/shared';
import { useNavigate } from 'react-router-dom';
import { cartStore } from '../lib/cart';
import { hapticImpact } from '../lib/telegram';

/** Puts the order's apps back into the cart (keeping what is already there) and opens it. */
export function useReorder(order: OrderDto): () => void {
  const navigate = useNavigate();
  return () => {
    hapticImpact('light');
    cartStore.addMany(order.items.map((item) => item.id));
    navigate('/cart');
  };
}
