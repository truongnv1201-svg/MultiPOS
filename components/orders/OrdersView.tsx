'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Order } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Search,
  Filter,
  Eye,
  Printer,
  RotateCcw,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Truck,
  ArrowDownRight,
  Plus,
  CreditCard,
  Receipt,
} from 'lucide-react';
import { PaginationBar } from '@/components/common/PaginationBar';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';

export function OrdersView() {
  const {
    orders,
    setReceiptModalOrder,
    cancelOrder,
    returnOrder,
    setCurrentScreen,
  } = useStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  // Sắp xếp: bấm header để đảo chiều; đổi sort -> về trang 1
  const { sortKey, sortDir, toggleSort } = useSortState();
  const handleSort = (key: string) => {
    toggleSort(key);
    setCurrentPage(1);
  };

  // P2-2: chỉ lưu id đang chọn, bản detail luôn suy từ orders mới nhất qua useMemo
  // (vừa khỏi stale sau hủy/trả, vừa không cần setState trong effect).
  // Reset lựa chọn khi đổi bộ lọc/trang làm trực tiếp trong các handler bên dưới.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(orders[0]?.id ?? null);
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return orders.find((o) => o.id === selectedOrderId) ?? null;
  }, [orders, selectedOrderId]);

  // P2-1: modal trả 1 phần — chọn dòng + SL trả, tiền hoàn phân bổ theo tỉ trọng dòng
  const [returnTarget, setReturnTarget] = useState<Order | null>(null);
  const [returnSel, setReturnSel] = useState<Record<string, { checked: boolean; qty: number }>>({});

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        o.order_code.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        (o.customer_phone && o.customer_phone.includes(search));
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchesDate = matchesDateFilter(o.created_at, dateFilter);

      let matchesPayment = true;
      if (paymentFilter === 'cash') matchesPayment = (o.payments || []).some(p => p.method === 'cash');
      else if (paymentFilter === 'transfer') matchesPayment = (o.payments || []).some(p => p.method === 'transfer');
      else if (paymentFilter === 'debt') matchesPayment = o.debt_amount > 0 || (o.payments || []).some(p => p.method === 'debt');

      return matchesSearch && matchesStatus && matchesDate && matchesPayment;
    });
  }, [orders, search, statusFilter, dateFilter, paymentFilter]);

  // Aggregate stats for filtered orders
  const stats = useMemo(() => {
    return filteredOrders.reduce(
      (acc, cur) => {
        acc.totalSales += cur.total_amount;
        acc.totalPaid += cur.paid_amount;
        acc.totalDebt += cur.debt_amount;
        return acc;
      },
      { totalSales: 0, totalPaid: 0, totalDebt: 0 }
    );
  }, [filteredOrders]);

  // Paginated records
  const sortedOrders = useMemo(() => {
    if (!sortKey) return filteredOrders;
    const getters: Record<string, (o: Order) => unknown> = {
      order_code: (o) => o.order_code,
      created_at: (o) => o.created_at,
      customer_name: (o) => o.customer_name,
      total_amount: (o) => o.total_amount,
      paid_amount: (o) => o.paid_amount,
      debt_amount: (o) => o.debt_amount,
      status: (o) => o.status,
    };
    const get = getters[sortKey];
    if (!get) return filteredOrders;
    return sortRows(filteredOrders, get, sortDir);
  }, [filteredOrders, sortKey, sortDir]);

  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedOrders.slice(start, start + pageSize);
  }, [sortedOrders, currentPage, pageSize]);

  // Reset page + bỏ chọn khi đổi bộ lọc (P2-2: khỏi bấm nhầm Hủy đơn khác trang)
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
    setSelectedOrderId(null);
  };

  const handleStatusChange = (val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
    setSelectedOrderId(null);
  };

  const handlePaymentChange = (val: string) => {
    setPaymentFilter(val);
    setCurrentPage(1);
    setSelectedOrderId(null);
  };

  const handleDateChange = (val: DateFilterState) => {
    setDateFilter(val);
    setCurrentPage(1);
    setSelectedOrderId(null);
  };

  const handleCancelOrder = async (orderId: string) => {
    const okConfirm = await confirmDialog('Thao tác này sẽ hoàn trả tồn kho và quỹ tiền.\nTiếp tục HỦY đơn hàng?', {
      title: 'Hủy đơn hàng',
      confirmLabel: 'Hủy đơn',
      danger: true,
    });
    if (okConfirm) {
      const ok = await cancelOrder(orderId);
      if (ok) alert('Đã hủy đơn hàng thành công và hạch toán hoàn quỹ tương ứng.');
    }
  };

  // ---- Xuất Excel / In bảng ----
  const ORDER_STATUS_LABEL: Record<string, string> = {
    pending: 'Chờ xử lý',
    deposit_order: 'Đặt hàng / Nhận cọc',
    completed: 'Hoàn tất',
    cancelled: 'Đã hủy',
    returned: 'Đã trả hàng',
  };

  const orderToRow = (o: Order): Record<string, unknown> => ({
    'Mã đơn': o.order_code,
    'Ngày': new Date(o.created_at).toLocaleString('vi-VN'),
    'Khách hàng': o.customer_name,
    'SĐT': o.customer_phone || '',
    'Số mặt hàng': o.items.length,
    'Tạm tính': o.subtotal,
    'Giảm giá': o.discount_amount,
    'Phí ship': o.shipping_fee,
    'Tổng tiền': o.total_amount,
    'Đã thu': o.paid_amount,
    'Còn nợ': o.debt_amount,
    'Trạng thái': ORDER_STATUS_LABEL[o.status] || o.status,
    'Thu ngân': o.cashier_name,
  });

  const handleExportExcel = () => {
    if (sortedOrders.length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }
    exportToExcel('don-hang', [{ name: 'DonHang', rows: sortedOrders.map(orderToRow) }]);
  };

  const handlePrint = () => {
    if (sortedOrders.length === 0) {
      alert('Không có dữ liệu để in!');
      return;
    }
    printTable({
      title: 'Danh sách hóa đơn & đơn hàng',
      meta: [`${sortedOrders.length} đơn`, `Tổng thu: ${formatVND(stats.totalPaid)}`],
      columns: [
        { header: 'Mã đơn' },
        { header: 'Khách hàng' },
        { header: 'Tổng tiền', align: 'right' },
        { header: 'Đã thu', align: 'right' },
        { header: 'Còn nợ', align: 'right' },
        { header: 'Trạng thái' },
      ],
      rows: sortedOrders.slice(0, 1000).map((o) => [
        o.order_code,
        o.customer_name,
        o.total_amount.toLocaleString('vi-VN'),
        o.paid_amount.toLocaleString('vi-VN'),
        o.debt_amount.toLocaleString('vi-VN'),
        ORDER_STATUS_LABEL[o.status] || o.status,
      ]),
      footer: ['Tổng', '', stats.totalSales.toLocaleString('vi-VN'), stats.totalPaid.toLocaleString('vi-VN'), stats.totalDebt.toLocaleString('vi-VN'), ''],
    });
  };

  // P2-1: mở modal trả hàng (cho cả đơn hoàn tất lẫn đơn cọc — server 0032 tách nhánh cọc)
  const handleReturnOrder = (order: Order) => {
    if (order.status !== 'completed' && order.status !== 'deposit_order') {
      alert('Chỉ đơn hàng đã hoàn tất / đơn cọc mới có thể thực hiện trả hàng!');
      return;
    }
    const init: Record<string, { checked: boolean; qty: number }> = {};
    for (const it of order.items) init[it.id] = { checked: true, qty: it.quantity };
    setReturnSel(init);
    setReturnTarget(order);
  };

  // Tiền hoàn 1 dòng theo SL trả (tỉ trọng subtotal dòng, làm tròn nguyên)
  const lineRefund = (order: Order, itemId: string): number => {
    const it = order.items.find((x) => x.id === itemId);
    const sel = returnSel[itemId];
    if (!it || !sel?.checked || sel.qty <= 0) return 0;
    if (!it.quantity || sel.qty >= it.quantity) return it.subtotal || 0;
    return Math.round(((it.subtotal || 0) * sel.qty) / it.quantity);
  };
  const returnTotal = returnTarget
    ? returnTarget.items.reduce((s, it) => s + lineRefund(returnTarget, it.id), 0)
    : 0;

  const confirmReturnOrder = async () => {
    if (!returnTarget) return;
    const picked = returnTarget.items.filter((it) => returnSel[it.id]?.checked && returnSel[it.id].qty > 0);
    if (picked.length === 0) {
      alert('Chưa chọn dòng hàng nào để trả!');
      return;
    }
    for (const it of picked) {
      const q = returnSel[it.id].qty;
      if (!(q > 0) || q > it.quantity) {
        alert(`SL trả của "${it.name}" không hợp lệ (tối đa ${it.quantity} ${it.unit})!`);
        return;
      }
    }
    let items = picked.map((it) => ({
      itemId: it.id,
      quantity: returnSel[it.id].qty,
      amount: lineRefund(returnTarget, it.id),
    }));
    // Chênh lệch làm tròn có thể vượt tổng đơn vài đồng -> trừ vào dòng lớn nhất
    const sum = items.reduce((s, r) => s + r.amount, 0);
    if (sum > returnTarget.total_amount) {
      const over = sum - returnTarget.total_amount;
      let bi = 0;
      for (let i = 1; i < items.length; i++) if (items[i].amount > items[bi].amount) bi = i;
      items[bi] = { ...items[bi], amount: items[bi].amount - over };
    }

    const res = await returnOrder(returnTarget.id, items);
    if (res.ok) {
      const inLines =
        res.restocked.length > 0
          ? ` Nhập lại kho: ${res.restocked.map((l) => `${l.sku} x${l.quantity}`).join(', ')}.`
          : ' Không có hàng nhập lại kho.';
      const skipLines =
        res.skipped.length > 0
          ? ` Bỏ qua (không nhập): ${res.skipped.map((l) => `${l.sku} (${l.reason})`).join(', ')}.`
          : '';
      alert(`Đã xử lý trả hàng: công nợ khấu trừ tối đa, phần dôi hoàn tiền mặt (FIN-ERR-03).${inLines}${skipLines}`);
      setReturnTarget(null);
    }
  };

  return (
    <div id="orders-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] bg-slate-100 overflow-hidden">
      {/* Top Action Bar */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>Quản lý Hóa đơn & Đơn hàng</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
            {orders.length} đơn hàng
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentScreen('pos')}
            className="px-3 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo đơn bán hàng (F2)</span>
          </button>
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        </div>
      </div>

      {/* Main Content: Table + Detail Preview */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Left: Orders Table */}
        <div className="flex-1 flex flex-col bg-slate-100 min-w-0 min-h-0">
          <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden min-h-0">
          {/* Filters Bar */}
          <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Mã đơn, tên khách, SĐT..."
                className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            {/* Date filter */}
            <DateFilter value={dateFilter} onChange={handleDateChange} />

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="completed">Hoàn tất (Đã xuất hàng)</option>
              <option value="deposit_order">Đặt hàng / Nhận cọc</option>
              <option value="returned">Đã trả hàng</option>
              <option value="cancelled">Đã hủy</option>
            </select>

            {/* Payment Method Filter */}
            <select
              value={paymentFilter}
              onChange={(e) => handlePaymentChange(e.target.value)}
              className="h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="all">Tất cả hình thức</option>
              <option value="cash">Tiền mặt</option>
              <option value="transfer">Chuyển khoản (VietQR)</option>
              <option value="debt">Chưa thanh toán đủ (Ghi nợ)</option>
            </select>
          </div>

          {/* Aggregate Summary Strip */}
          <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
            <div className="flex items-center gap-4">
              <span>
                Doanh số lọc:{' '}
                <strong className="font-mono text-slate-900">{formatVND(stats.totalSales)}</strong>
              </span>
              <span className="text-emerald-700">
                Thực thu:{' '}
                <strong className="font-mono text-emerald-800">{formatVND(stats.totalPaid)}</strong>
              </span>
              <span className="text-rose-600">
                Còn nợ:{' '}
                <strong className="font-mono text-rose-700">{formatVND(stats.totalDebt)}</strong>
              </span>
            </div>
          </div>

          {/* Orders Table */}
          <div className="flex-1 min-h-0 overflow-hidden">
              <div className="h-full min-h-0 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <SortableTh className="py-2.5 px-3" label="Mã đơn" sortKey="order_code" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Thời gian" sortKey="created_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Khách hàng" sortKey="customer_name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tổng tiền" sortKey="total_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Đã trả" sortKey="paid_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Còn nợ" sortKey="debt_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="Trạng thái" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Không tìm thấy đơn hàng nào phù hợp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((ord) => {
                    const isSelected = selectedOrder?.id === ord.id;
                    return (
                      <tr
                        key={ord.id}
                        onClick={() => setSelectedOrderId(ord.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/80 font-medium' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                          {ord.order_code}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                          {new Date(ord.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <div>{ord.customer_name}</div>
                          {ord.customer_phone && (
                            <div className="text-[10px] text-slate-400">{ord.customer_phone}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatVND(ord.total_amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                          {formatVND(ord.paid_amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-600 font-semibold">
                          {ord.debt_amount > 0 ? formatVND(ord.debt_amount) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {ord.status === 'completed' && (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                              Hoàn tất
                            </span>
                          )}
                          {ord.status === 'deposit_order' && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold">
                              Đã nhận cọc
                            </span>
                          )}
                          {ord.status === 'returned' && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-[10px] font-bold">
                              Đã trả hàng
                            </span>
                          )}
                          {ord.status === 'cancelled' && (
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-bold">
                              Đã hủy
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
</table>
              </div>

              {/* Pagination */}
              <PaginationBar
                currentPage={currentPage}
                totalItems={filteredOrders.length}
                pageSize={pageSize}
                onPageChange={(p) => {
                  setCurrentPage(p);
                  setSelectedOrderId(null);
                }}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setCurrentPage(1);
                  setSelectedOrderId(null);
                }}
                itemName="hóa đơn"
              />
          </div>
          </div>
        </div>

        {/* Right: Selected Order Detail Preview */}
        {selectedOrder ? (
          <div className="w-full md:w-96 bg-slate-100 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs p-3 flex flex-col overflow-y-auto">
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 font-mono">
                    {selectedOrder.order_code}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {new Date(selectedOrder.created_at).toLocaleString('vi-VN')}
                  </p>
                </div>
                  <button
                  onClick={() => setReceiptModalOrder(selectedOrder)}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-md font-medium text-slate-700 flex items-center gap-1.5 shadow-2xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In lại</span>
                </button>
              </div>

              {/* Customer info */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <div className="text-slate-500 text-[11px]">Thông tin khách hàng:</div>
                <div className="font-semibold text-slate-800">{selectedOrder.customer_name}</div>
                {selectedOrder.customer_phone && (
                  <div className="text-slate-600 font-mono">{selectedOrder.customer_phone}</div>
                )}
                <div className="text-[11px] text-slate-400">
                  Thu ngân: {selectedOrder.cashier_name} • {selectedOrder.branch_name}
                  </div>
              </div>

              {/* Line items list */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700">Chi tiết mặt hàng ({selectedOrder.items.length}):</div>
                <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {selectedOrder.items.map((it) => (
                    <div key={it.id} className="p-2.5 space-y-1">
                      <div className="flex justify-between font-medium">
                        <span className="font-bold text-slate-800">{it.name}</span>
                        <span className="font-mono text-slate-900">{formatVND(it.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>
                          {it.quantity} {it.unit} x {formatVND(it.unit_price)}
                        </span>
                        {it.processing_fee > 0 && (
                          <span className="text-amber-700 font-medium">
                            Phí gia công: +{formatVND(it.processing_fee)}
                          </span>
                        )}
                      </div>

                      {/* Area m2 details */}
                      {it.dimension_details && (
                        <div className="text-[10px] text-slate-600 bg-slate-50 p-1.5 rounded space-y-0.5">
                          {it.dimension_details.map((d, dIdx) => (
                            <div key={dIdx} className="flex justify-between font-mono">
                              <span>
                                • {d.quantity} tấm ({d.length}m x {d.width}m = {d.actual_m2} m²)
                              </span>
                              <span>Phí: {formatVND(d.processing_fee)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial summary */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Tiền hàng:</span>
                  <span>{formatVND(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.discount_amount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Giảm giá:</span>
                    <span>-{formatVND(selectedOrder.discount_amount)}</span>
                  </div>
                )}
                {(selectedOrder.shipping_fee || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Phí ship:</span>
                    <span>+{formatVND(selectedOrder.shipping_fee)}</span>
                  </div>
                )}
                {(selectedOrder.vat_amount || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>VAT ({selectedOrder.vat_percent || 0}%):</span>
                    <span>+{formatVND(selectedOrder.vat_amount || 0)}</span>
                  </div>
                )}
                {selectedOrder.cash_rounding > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Làm tròn tiền mặt:</span>
                    <span>-{formatVND(selectedOrder.cash_rounding)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-sm">
                  <span>Tổng cộng:</span>
                  <span>{formatVND(selectedOrder.total_amount)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Đã thanh toán:</span>
                  <span>{formatVND(selectedOrder.paid_amount)}</span>
                </div>
                {selectedOrder.debt_amount > 0 && (
                  <div className="flex justify-between text-rose-600 font-bold">
                    <span>Còn nợ:</span>
                    <span>{formatVND(selectedOrder.debt_amount)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-auto pt-3 border-t border-slate-200 space-y-2">
              {(selectedOrder.status === 'completed' || selectedOrder.status === 'deposit_order') && (
                <button
                  onClick={() => handleReturnOrder(selectedOrder)}
                  className="w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Trả hàng & Hoàn tiền (Khấu trừ nợ)</span>
                </button>
              )}

              {selectedOrder.status !== 'cancelled' && (
                <button
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Hủy hóa đơn & Hoàn quỹ</span>
                </button>
              )}
            </div>
          </div>
          </div>
        ) : (
          <div className="w-96 m-4 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 text-xs">
            Chọn đơn hàng để xem chi tiết
          </div>
        )}
      </div>

      {/* P2-1: Modal trả 1 phần */}
      {returnTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setReturnTarget(null)}>
          <div
            className="bg-white rounded-xl shadow-xl w-[560px] max-w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Trả hàng đơn {returnTarget.order_code}</h3>
                <p className="text-[11px] text-slate-500">
                  {returnTarget.status === 'deposit_order'
                    ? 'Đơn cọc — hoàn theo tiền đã thu, phần nợ còn lại được xóa.'
                    : 'Tích chọn dòng cần trả, sửa SL nếu trả thiếu. Hàng cắt/dịch vụ không nhập lại kho.'}
                </p>
              </div>
              <button onClick={() => setReturnTarget(null)} className="px-2 py-0.5 text-xl leading-none text-slate-400 hover:text-slate-700" title="Đóng">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {returnTarget.items.map((it) => {
                const sel = returnSel[it.id] || { checked: false, qty: 0 };
                const noRestock = it.product_type === 'area' || it.product_type === 'service';
                return (
                  <label key={it.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={sel.checked}
                      onChange={(e) => setReturnSel((prev) => ({ ...prev, [it.id]: { ...sel, checked: e.target.checked } }))}
                      className="w-4 h-4 accent-purple-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{it.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {it.sku} • đã bán {it.quantity} {it.unit} • {formatVND(it.subtotal)}
                        {noRestock ? ' • không nhập lại' : ' • được nhập lại kho'}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={it.quantity}
                      step={it.product_type === 'area' ? 0.001 : 1}
                      value={sel.qty}
                      onChange={(e) =>
                        setReturnSel((prev) => ({
                          ...prev,
                          [it.id]: { ...sel, qty: Math.max(0, parseFloat(e.target.value) || 0) },
                        }))
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-20 h-7 px-1.5 text-right font-mono text-xs bg-white border border-slate-300 rounded focus:border-purple-500 focus:outline-hidden"
                      title={`SL trả (tối đa ${it.quantity})`}
                    />
                    <span className="w-24 text-right font-mono font-bold text-slate-900 shrink-0">
                      {formatVND(lineRefund(returnTarget, it.id))}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                Tổng hoàn: <strong className="font-mono text-purple-700">{formatVND(returnTotal)}</strong>
                <span className="text-slate-400"> / tối đa {formatVND(returnTarget.total_amount)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReturnTarget(null)}
                  className="px-3 h-8 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={confirmReturnOrder}
                  disabled={returnTotal <= 0 || returnTotal > returnTarget.total_amount}
                  className="px-3 h-8 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Xác nhận trả</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
