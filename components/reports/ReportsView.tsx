'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { formatVND } from '@/lib/format';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Boxes,
  Users,
  Percent,
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { TableTools } from '@/components/common/TableTools';
import { DataTableShell } from '@/components/common/DataTableShell';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Search } from 'lucide-react';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';
import type { Product, Customer } from '@/lib/types';

type TimeRange = 'today' | 'week' | 'month';

const RANGE_LABEL: Record<TimeRange, string> = {
  today: 'hôm nay',
  week: 'tuần này',
  month: 'tháng này',
};

function inTimeRange(iso: string, range: TimeRange, now = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  if (range === 'today') return d >= startOfDay;
  if (range === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  // week: Thứ 2 đầu tuần -> hiện tại
  const day = (now.getDay() + 6) % 7; // Mon=0
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - day);
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

export function ReportsView() {
  const { orders, products, customers, cashbook } = useStore();
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  // Sắp xếp 2 bảng mini: bấm header để đảo chiều (mặc định giữ nguyên thứ tự cũ).
  // Mỗi bảng có tìm kiếm + phân trang riêng để không vỡ layout khi dữ liệu lớn.
  const { sortKey: marginSortKey, sortDir: marginSortDir, toggleSort: toggleMarginSortRaw } = useSortState();
  const { sortKey: debtSortKey, sortDir: debtSortDir, toggleSort: toggleDebtSortRaw } = useSortState('current_debt', 'desc');
  const [marginSearch, setMarginSearch] = useState('');
  const [marginPage, setMarginPage] = useState(1);
  const [marginPageSize, setMarginPageSize] = useState(8);
  const [debtSearch, setDebtSearch] = useState('');
  const [debtPage, setDebtPage] = useState(1);
  const [debtPageSize, setDebtPageSize] = useState(8);

  const handleMarginSort = (key: string) => {
    toggleMarginSortRaw(key);
    setMarginPage(1);
  };
  const handleDebtSort = (key: string) => {
    toggleDebtSortRaw(key);
    setDebtPage(1);
  };

  const marginFiltered = useMemo(() => {
    const q = marginSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, marginSearch]);

  const sortedMargin = useMemo(() => {
    if (!marginSortKey) return marginFiltered;
    const getters: Record<string, (p: Product) => unknown> = {
      name: (p) => p.name,
      retail_price: (p) => p.retail_price,
      avg_cost: (p) => p.avg_cost,
      margin: (p) => p.retail_price - p.avg_cost,
      margin_pct: (p) => (p.retail_price > 0 ? ((p.retail_price - p.avg_cost) / p.retail_price) * 100 : 0),
    };
    const get = getters[marginSortKey];
    if (!get) return marginFiltered;
    return sortRows(marginFiltered, get, marginSortDir);
  }, [marginFiltered, marginSortKey, marginSortDir]);

  // Kẹp trang khi dữ liệu co lại (lọc/tìm kiếm) để không ra trang trắng
  const marginTotalPages = Math.max(1, Math.ceil(sortedMargin.length / marginPageSize));
  const safeMarginPage = Math.min(Math.max(1, marginPage), marginTotalPages);
  const marginRows = useMemo(() => {
    const start = (safeMarginPage - 1) * marginPageSize;
    return sortedMargin.slice(start, start + marginPageSize);
  }, [sortedMargin, safeMarginPage, marginPageSize]);

  const debtFiltered = useMemo(() => {
    const base = customers.filter((c) => c.current_debt > 0);
    const q = debtSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q),
    );
  }, [customers, debtSearch]);

  const sortedDebtors = useMemo(() => {
    if (!debtSortKey) return debtFiltered;
    const getters: Record<string, (c: Customer) => unknown> = {
      name: (c) => c.name,
      phone: (c) => c.phone,
      current_debt: (c) => c.current_debt,
      debt_limit: (c) => c.debt_limit,
      debt_rate: (c) => (c.debt_limit > 0 ? (c.current_debt / c.debt_limit) * 100 : 0),
    };
    const get = getters[debtSortKey];
    if (!get) return debtFiltered;
    return sortRows(debtFiltered, get, debtSortDir);
  }, [debtFiltered, debtSortKey, debtSortDir]);

  const debtTotalPages = Math.max(1, Math.ceil(sortedDebtors.length / debtPageSize));
  const safeDebtPage = Math.min(Math.max(1, debtPage), debtTotalPages);
  const debtorRows = useMemo(() => {
    const start = (safeDebtPage - 1) * debtPageSize;
    return sortedDebtors.slice(start, start + debtPageSize);
  }, [sortedDebtors, safeDebtPage, debtPageSize]);

  // ---- KPI theo kỳ Hôm nay / Tuần này / Tháng này ----
  const rangedOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        (o.status === 'completed' || o.status === 'deposit_order') &&
        inTimeRange(o.created_at, timeRange),
    );
  }, [orders, timeRange]);

  // Revenue computations (theo kỳ đã chọn)
  const totalRevenue = rangedOrders.reduce((sum, o) => sum + o.total_amount, 0);

  const totalCollected = rangedOrders.reduce((sum, o) => sum + o.paid_amount, 0);

  const totalDebtReceivable = customers.reduce((sum, c) => sum + c.current_debt, 0);

  const totalStockValue = products.reduce((sum, p) => {
    if (p.product_type === 'service') return sum;
    return sum + p.stock_quantity * p.avg_cost;
  }, 0);

  // Profit calculation on filtered orders
  const grossProfit = rangedOrders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => {
      // rough gross profit = items subtotal - cost
      const orderCost = o.items.reduce((costSum, it) => {
        const prod = products.find((p) => p.id === it.product_id);
        const unitCost = prod ? prod.avg_cost : it.unit_price * 0.7;
        return costSum + it.quantity * unitCost;
      }, 0);
      return sum + (o.total_amount - orderCost);
    }, 0);

  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // ---- VAT đầu ra theo tháng + đối chiếu sổ quỹ (P1) ----
  // Chỉ đơn hiệu lực (completed/deposit_order); đơn hủy/trả không tính VAT.
  // Đơn cũ (trước bản VAT) không có vat_amount -> tính 0, có footnote ở bảng.
  interface VatMonthRow {
    month: string; // YYYY-MM
    orderCount: number;
    revenue: number; // tổng total_amount đơn hiệu lực
    vatTotal: number;
    vatByRate: Record<string, number>; // '0' | '8' | '10' (+ rate lạ nếu có)
    booked: number; // sổ quỹ: receipt sales + deposit cùng tháng
  }
  const monthOf = (iso: string) => (iso || '').slice(0, 7);
  const vatMonthly: VatMonthRow[] = useMemo(() => {
    const map = new Map<string, VatMonthRow>();
    for (const o of orders) {
      if (o.status !== 'completed' && o.status !== 'deposit_order') continue;
      const m = monthOf(o.created_at);
      if (!/^\d{4}-\d{2}$/.test(m)) continue;
      let row = map.get(m);
      if (!row) {
        row = { month: m, orderCount: 0, revenue: 0, vatTotal: 0, vatByRate: {}, booked: 0 };
        map.set(m, row);
      }
      row.orderCount += 1;
      row.revenue += o.total_amount || 0;
      const vat = o.vat_amount || 0;
      row.vatTotal += vat;
      const rateKey = String(o.vat_percent ?? 0);
      row.vatByRate[rateKey] = (row.vatByRate[rateKey] || 0) + vat;
    }
    for (const e of cashbook) {
      if (e.type !== 'receipt') continue;
      if (e.category !== 'sales' && e.category !== 'deposit') continue; // loại thu nợ cũ
      const m = monthOf(e.created_at);
      const row = map.get(m);
      if (row) row.booked += e.amount || 0;
    }
    return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [orders, cashbook]);

  const thisMonthKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const thisMonthVat = vatMonthly.find((r) => r.month === thisMonthKey);
  const vatLabel = (ym: string) => `T${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

  const vatTotals = useMemo(() => {
    return vatMonthly.reduce(
      (acc, r) => {
        acc.revenue += r.revenue;
        acc.vat += r.vatTotal;
        acc.booked += r.booked;
        acc.diff += r.revenue - r.booked;
        return acc;
      },
      { revenue: 0, vat: 0, booked: 0, diff: 0 },
    );
  }, [vatMonthly]);

  // ---- Xuất Excel / In báo cáo ----
  const handleExportExcel = () => {
    exportToExcel('bao-cao-quan-tri', [
      {
        name: 'TongHop',
        rows: [
          { 'Chỉ tiêu': `Doanh thu đơn hàng (${RANGE_LABEL[timeRange]})`, 'Giá trị': totalRevenue },
          { 'Chỉ tiêu': 'Thực thu', 'Giá trị': totalCollected },
          { 'Chỉ tiêu': 'Công nợ phải thu', 'Giá trị': totalDebtReceivable },
          { 'Chỉ tiêu': 'Giá trị tồn kho', 'Giá trị': Math.round(totalStockValue) },
          { 'Chỉ tiêu': 'Lãi gộp ước tính', 'Giá trị': Math.round(grossProfit) },
        ],
      },
      {
        name: 'BienLoi',
        rows: sortedMargin.map((p) => ({
          'Sản phẩm': p.name,
          'Giá bán': p.retail_price,
          'Giá vốn': Math.round(p.avg_cost),
          'Biên lợi': Math.round(p.retail_price - p.avg_cost),
          'Biên lợi (%)': p.retail_price > 0 ? Math.round(((p.retail_price - p.avg_cost) / p.retail_price) * 10000) / 100 : 0,
        })),
      },
      {
        name: 'CongNo',
        rows: sortedDebtors.map((c) => ({
          'Khách hàng': c.name,
          'SĐT': c.phone,
          'Đang nợ': c.current_debt,
          'Hạn mức': c.debt_limit,
        })),
      },
      {
        name: 'VAT',
        rows: vatMonthly.map((r) => ({
          'Tháng': vatLabel(r.month),
          'Số đơn': r.orderCount,
          'Doanh thu đơn': r.revenue,
          'VAT 8%': Math.round(r.vatByRate['8'] || 0),
          'VAT 10%': Math.round(r.vatByRate['10'] || 0),
          'Tổng VAT': Math.round(r.vatTotal),
          'Sổ quỹ (bán + cọc)': r.booked,
          'Chênh lệch': r.revenue - r.booked,
        })),
      },
    ]);
  };

  const handlePrint = () => {
    printTable({
      title: 'Báo cáo quản trị',
      meta: [
        `Doanh thu (${RANGE_LABEL[timeRange]}): ${formatVND(totalRevenue)}`,
        `Thực thu: ${formatVND(totalCollected)}`,
        `Công nợ phải thu: ${formatVND(totalDebtReceivable)}`,
        `VAT đầu ra tháng này: ${formatVND(thisMonthVat?.vatTotal || 0)}`,
      ],
      columns: [
        { header: 'Khách hàng' },
        { header: 'SĐT' },
        { header: 'Đang nợ', align: 'right' },
        { header: 'Hạn mức', align: 'right' },
      ],
      rows: sortedDebtors.slice(0, 1000).map((c) => [c.name, c.phone, c.current_debt.toLocaleString('vi-VN'), c.debt_limit.toLocaleString('vi-VN')]),
      footer: ['Tổng', '', totalDebtReceivable.toLocaleString('vi-VN'), ''],
    });
  };

  return (
    <div id="reports-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      {/* Top Header — style chung mọi màn hình */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span>Báo cáo Quản trị & Phân tích Đa chiều</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
            {rangedOrders.length} đơn {RANGE_LABEL[timeRange]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-semibold">
            {(['today', 'week', 'month'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 rounded-md transition-all ${
                  timeRange === r ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'
                }`}
              >
                {r === 'today' ? 'Hôm nay' : r === 'week' ? 'Tuần này' : 'Tháng này'}
              </button>
            ))}
          </div>
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        </div>
      </div>

      {/* Overview Metric Cards — style chung (nền màu theo chỉ tiêu) */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 bg-white border-b border-slate-200">
        <div className="bg-blue-50/80 p-3.5 rounded-xl border border-blue-200">
          <div className="flex items-center justify-between text-xs text-blue-800 font-semibold mb-1">
            <span>DOANH THU ĐƠN HÀNG:</span>
            <DollarSign className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-extrabold text-blue-900 font-mono">
            {formatVND(totalRevenue)}
          </div>
          <div className="text-[10px] text-blue-600 mt-1">
            Thực thu: <strong className="font-mono">{formatVND(totalCollected)}</strong> • {RANGE_LABEL[timeRange]}
          </div>
        </div>

        <div className="bg-emerald-50/80 p-3.5 rounded-xl border border-emerald-200">
          <div className="flex items-center justify-between text-xs text-emerald-900 font-semibold mb-1">
            <span>LỢI NHUẬN GỘP DỰ TÍNH:</span>
            <TrendingUp className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-extrabold text-emerald-900 font-mono">
            {formatVND(grossProfit)}
          </div>
          <div className="text-[10px] text-emerald-700 mt-1">
            Biên lợi nhuận gộp: ~{grossMarginPct.toFixed(1)}%
          </div>
        </div>

        <div className="bg-rose-50/80 p-3.5 rounded-xl border border-rose-200">
          <div className="flex items-center justify-between text-xs text-rose-900 font-semibold mb-1">
            <span>TỔNG CÔNG NỢ PHẢI THU:</span>
            <Users className="w-4 h-4 text-rose-700" />
          </div>
          <div className="text-xl font-extrabold text-rose-900 font-mono">
            {formatVND(totalDebtReceivable)}
          </div>
          <div className="text-[10px] text-rose-700 mt-1">
            Của {customers.filter((c) => c.current_debt > 0).length} khách hàng đang nợ
          </div>
        </div>

        <div className="bg-amber-50/80 p-3.5 rounded-xl border border-amber-200">
          <div className="flex items-center justify-between text-xs text-amber-900 font-semibold mb-1">
            <span>GIÁ TRỊ TỒN KHO (VỐN MAC):</span>
            <Boxes className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-xl font-extrabold text-amber-900 font-mono">
            {formatVND(totalStockValue)}
          </div>
          <div className="text-[10px] text-amber-700 mt-1">
            {products.length} mã vật tư & hàng hóa
          </div>
        </div>

        <div className="bg-violet-50/80 p-3.5 rounded-xl border border-violet-200">
          <div className="flex items-center justify-between text-xs text-violet-900 font-semibold mb-1">
            <span>VAT ĐẦU RA (THÁNG NÀY):</span>
            <Percent className="w-4 h-4 text-violet-700" />
          </div>
          <div className="text-xl font-extrabold text-violet-900 font-mono">
            {formatVND(thisMonthVat?.vatTotal || 0)}
          </div>
          <div className="text-[10px] text-violet-700 mt-1">
            {thisMonthVat ? `${thisMonthVat.orderCount} đơn hiệu lực • 8%: ${formatVND(thisMonthVat.vatByRate['8'] || 0)} • 10%: ${formatVND(thisMonthVat.vatByRate['10'] || 0)}` : 'Chưa có đơn hiệu lực'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* VAT đầu ra theo tháng + đối chiếu sổ quỹ */}
        <DataTableShell>
          <div className="px-3 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
              <Percent className="w-4 h-4 text-violet-600" />
              <span>Thuế VAT Đầu Ra Theo Tháng (Đối Chiếu Sổ Quỹ)</span>
            </h3>
            <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-800 font-mono rounded">
              {vatMonthly.length} tháng • Tổng VAT {formatVND(vatTotals.vat)}
            </span>
          </div>

          <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between text-[11px] font-medium text-slate-600 gap-2">
            <span>
              Tổng doanh thu đơn: <strong className="font-mono text-slate-900 font-bold">{formatVND(vatTotals.revenue)}</strong>
            </span>
            <div className="flex items-center gap-4">
              <span>
                Sổ quỹ (bán + cọc):{' '}
                <strong className="font-mono text-emerald-700 font-bold">{formatVND(vatTotals.booked)}</strong>
              </span>
              <span>
                Chênh lệch:{' '}
                <strong className="font-mono text-amber-700 font-bold">{formatVND(vatTotals.diff)}</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <th className="py-2.5 px-3">Tháng</th>
                  <th className="py-2.5 px-3 text-center">Số đơn</th>
                  <th className="py-2.5 px-3 text-right">Doanh thu đơn</th>
                  <th className="py-2.5 px-3 text-right">VAT 8%</th>
                  <th className="py-2.5 px-3 text-right">VAT 10%</th>
                  <th className="py-2.5 px-3 text-right">Tổng VAT</th>
                  <th className="py-2.5 px-3 text-right">Sổ quỹ (bán + cọc)</th>
                  <th className="py-2.5 px-3 text-right">Chênh lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vatMonthly.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-slate-400">Chưa có đơn hiệu lực</td></tr>
                ) : (
                  vatMonthly.map((r) => {
                    const diff = r.revenue - r.booked;
                    return (
                      <tr key={r.month} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{vatLabel(r.month)}</td>
                        <td className="py-2.5 px-3 text-center font-mono">{r.orderCount}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">{formatVND(r.revenue)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">{formatVND(r.vatByRate['8'] || 0)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">{formatVND(r.vatByRate['10'] || 0)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-violet-700">{formatVND(r.vatTotal)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{formatVND(r.booked)}</td>
                        <td className="py-2.5 px-3 text-right">
                          {diff === 0 ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">—</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 font-mono">
                              {formatVND(diff)}
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
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
            * Chênh lệch (Doanh thu − Sổ quỹ) ≈ bán nợ chưa thu + cọc chưa quyết toán. Đơn hủy/trả không tính VAT.
            Đơn tạo trước bản VAT không có số VAT nên hiển thị 0.
          </div>
        </DataTableShell>

        {/* Detailed Breakdown Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Selling Products & Margin */}
          <DataTableShell>
            <div className="px-3 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-600" />
                <span>Hiệu Quả Kinh Doanh Từng Mặt Hàng (Giá Bán vs Giá Vốn MAC)</span>
              </h3>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
                {sortedMargin.length} mặt hàng
              </span>
            </div>

            <div className="p-2.5 bg-slate-50 border-b border-slate-200">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={marginSearch}
                  onChange={(e) => {
                    setMarginSearch(e.target.value);
                    setMarginPage(1);
                  }}
                  placeholder="Tìm mặt hàng theo tên..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Bấm tiêu đề cột để sắp xếp biên lợi</span>
              <span>
                Biên BQ:{' '}
                <strong className="font-mono text-emerald-700 font-bold">
                  {sortedMargin.length > 0
                    ? (
                        (sortedMargin.reduce((s, p) => s + (p.retail_price - p.avg_cost), 0) /
                          sortedMargin.reduce((s, p) => s + (p.retail_price || 1), 0)) *
                        100
                      ).toFixed(1)
                    : '0.0'}
                  %
                </strong>
              </span>
            </div>

            <div className="overflow-auto max-h-[360px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                    <SortableTh className="py-2.5 px-3" label="Tên sản phẩm" sortKey="name" activeKey={marginSortKey} dir={marginSortDir} onSort={handleMarginSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Giá bán" sortKey="retail_price" activeKey={marginSortKey} dir={marginSortDir} onSort={handleMarginSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Vốn MAC" sortKey="avg_cost" activeKey={marginSortKey} dir={marginSortDir} onSort={handleMarginSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Chênh lệch" sortKey="margin" activeKey={marginSortKey} dir={marginSortDir} onSort={handleMarginSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Tỷ suất lãi" sortKey="margin_pct" activeKey={marginSortKey} dir={marginSortDir} onSort={handleMarginSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marginRows.length === 0 ? (
                    <tr><td colSpan={5} className="py-12 text-center text-slate-400">Không tìm thấy mặt hàng nào phù hợp.</td></tr>
                  ) : (
                    marginRows.map((p) => {
                      const margin = p.retail_price - p.avg_cost;
                      const marginPct = p.retail_price > 0 ? (margin / p.retail_price) * 100 : 0;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-800 max-w-[180px] truncate" title={p.name}>
                            {p.name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">{formatVND(p.retail_price)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {formatVND(p.avg_cost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                            +{formatVND(margin)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 font-mono">
                              {marginPct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              currentPage={safeMarginPage}
              totalItems={sortedMargin.length}
              pageSize={marginPageSize}
              onPageChange={setMarginPage}
              onPageSizeChange={(s) => {
                setMarginPageSize(s);
                setMarginPage(1);
              }}
              pageSizeOptions={[8, 15, 25, 50]}
              itemName="mặt hàng"
            />
          </DataTableShell>

          {/* Debt Aging & Customers */}
          <DataTableShell>
            <div className="px-3 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-rose-600" />
                <span>Khách Hàng Có Dư Nợ Lớn Nhất</span>
              </h3>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
                {sortedDebtors.length} khách đang nợ
              </span>
            </div>

            <div className="p-2.5 bg-slate-50 border-b border-slate-200">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={debtSearch}
                  onChange={(e) => {
                    setDebtSearch(e.target.value);
                    setDebtPage(1);
                  }}
                  placeholder="Tìm khách nợ theo tên, SĐT..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Bấm tiêu đề cột để sắp xếp dư nợ</span>
              <span>
                Tổng dư nợ:{' '}
                <strong className="font-mono text-rose-600 font-bold">{formatVND(totalDebtReceivable)}</strong>
              </span>
            </div>

            <div className="overflow-auto max-h-[360px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                    <SortableTh className="py-2.5 px-3" label="Tên khách" sortKey="name" activeKey={debtSortKey} dir={debtSortDir} onSort={handleDebtSort} />
                    <SortableTh className="py-2.5 px-3" label="SĐT" sortKey="phone" activeKey={debtSortKey} dir={debtSortDir} onSort={handleDebtSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Dư nợ hiện hữu" sortKey="current_debt" activeKey={debtSortKey} dir={debtSortDir} onSort={handleDebtSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Hạn mức" sortKey="debt_limit" activeKey={debtSortKey} dir={debtSortDir} onSort={handleDebtSort} />
                    <SortableTh className="py-2.5 px-3 text-center" label="Tỷ lệ nợ" sortKey="debt_rate" activeKey={debtSortKey} dir={debtSortDir} onSort={handleDebtSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {debtorRows.length === 0 ? (
                    <tr><td colSpan={5} className="py-12 text-center text-slate-400">Không tìm thấy khách hàng nào phù hợp.</td></tr>
                  ) : (
                    debtorRows.map((c) => {
                      const debtRate = c.debt_limit > 0 ? (c.current_debt / c.debt_limit) * 100 : 0;
                      const overLimit = c.debt_limit > 0 && c.current_debt > c.debt_limit;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-800">{c.name}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">{c.phone}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                            {formatVND(c.current_debt)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {formatVND(c.debt_limit)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                overLimit
                                  ? 'bg-rose-100 text-rose-800'
                                  : debtRate >= 80
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {debtRate.toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              currentPage={safeDebtPage}
              totalItems={sortedDebtors.length}
              pageSize={debtPageSize}
              onPageChange={setDebtPage}
              onPageSizeChange={(s) => {
                setDebtPageSize(s);
                setDebtPage(1);
              }}
              pageSizeOptions={[8, 15, 25, 50]}
              itemName="khách hàng"
            />
          </DataTableShell>
        </div>
      </div>
    </div>
  );
}
