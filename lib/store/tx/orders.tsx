// P3-tx/orders: composer mỏng — gom useTxOrdersSync + useTxCheckout + useTxOrderReturns
// thành shape TxOrders cũ. Giữ nguyên export API: TxOrdersDeps, TxOrders, useTxOrders.
'use client';

import { useTxOrdersSync } from './orders-sync';
import { useTxCheckout } from './checkout';
import { useTxOrderReturns } from './order-returns';
import type { TxOrdersDeps, TxOrders } from './orders-types';

export type { TxOrdersDeps, TxOrders } from './orders-types';

export function useTxOrders({
  activeCart,
  calculatedTotals,
  clearActiveCart,
  setReceiptModalOrder,
  setShiftModalOpen,
  currentShift,
  setCurrentShift,
  setCashbook,
}: TxOrdersDeps): TxOrders {
  const sync = useTxOrdersSync({ setCashbook });
  const checkout = useTxCheckout({
    activeCart,
    calculatedTotals,
    clearActiveCart,
    setReceiptModalOrder,
    setShiftModalOpen,
    currentShift,
    setCurrentShift,
    setCashbook,
    setOrders: sync.setOrders,
    setPendingQueue: sync.setPendingQueue,
  });
  const returns = useTxOrderReturns({
    orders: sync.orders,
    setOrders: sync.setOrders,
    setPendingQueue: sync.setPendingQueue,
    currentShift,
    setCashbook,
    resolveServerOrderId: sync.resolveServerOrderId,
  });

  return {
    orders: sync.orders,
    setOrders: sync.setOrders,
    pendingQueue: sync.pendingQueue,
    setPendingQueue: sync.setPendingQueue,
    checkoutActiveOrder: checkout.checkoutActiveOrder,
    refreshServerOrders: sync.refreshServerOrders,
    syncPendingOrders: sync.syncPendingOrders,
    resolveServerOrderId: sync.resolveServerOrderId,
    cancelOrder: returns.cancelOrder,
    returnOrder: returns.returnOrder,
  };
}
