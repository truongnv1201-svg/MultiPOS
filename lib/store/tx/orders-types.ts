// P3-tx/orders-types: pure types cho slice đơn hàng (tách verbatim từ tx/orders.tsx).
// Không chứa hook/logic — chỉ interfaces để các sub-hook + composer dùng chung.
import type { Order, CashbookEntry, Shift } from '../../types';
import type { CartTab, ReturnResult } from '../types';

export interface TxOrdersDeps {
  activeCart: CartTab;
  calculatedTotals: {
    subtotal: number;
    discount_amount: number;
    shipping_fee: number;
    vat_amount: number;
    vat_percent: number;
    cash_rounding: number;
    payable: number;
    change_amount: number;
    debt_amount: number;
  };
  clearActiveCart: () => void;
  setReceiptModalOrder: (order: Order | null) => void;
  setShiftModalOpen: (open: boolean) => void;
  currentShift: Shift;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
}

export interface TxOrders {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  pendingQueue: Order[];
  setPendingQueue: React.Dispatch<React.SetStateAction<Order[]>>;
  checkoutActiveOrder: (isDeposit?: boolean) => Promise<Order | null>;
  refreshServerOrders: () => Promise<boolean>;
  syncPendingOrders: () => Promise<void>;
  resolveServerOrderId: (order: Order) => Promise<string | null>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  returnOrder: (orderId: string, refundItems: { itemId: string; quantity: number; amount: number }[]) => Promise<ReturnResult>;
}
