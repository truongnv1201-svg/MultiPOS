'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { formatVND, formatNumber } from '@/lib/format';
import {
  BarChart3,
  Boxes,
  Users,
  Wallet,
  Calendar,
  Download,
  PieChart,
  Percent,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { TableTools } from '@/components/common/TableTools';
import { Button } from '@/components/ui/Button';
import { Stat } from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';
import type { Product, Customer } from '@/lib/types';

export function ReportsView() {
  const {
    orders,
    products,
    customers,
    cashbook,
    currentShift,
    realtimeStatus,
    refreshAllRealtime,
  } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAllRealtime();
    } finally {
      setRefreshing(false);
    }
  };
  // Sắp xếp 2 bảng mini: bấm header để đảo chiều (mặc định giữ nguyên thứ tự cũ)
  const { sortKey: marginSortKey, sortDir: marginSortDir, toggleSort: toggleMarginSort } = useSortState();
  const { sortKey: debtSortKey, sortDir: debtSortDir, toggleSort: toggleDebtSort } = useSortState('current_debt', 'desc');

  const marginRows = useMemo(() => {
    const base = products.slice(0, 6);
    if (!marginSortKey) return base;
    const getters: Record<string, (p: Product) => unknown> = {
      name: (p) => p.name,
      retail_price: (p) => p.retail_price,
      avg_cost: (p) => p.avg_cost,
      margin: (p) => p.retail_price - p.avg_cost,
      margin_pct: (p) => (p.retail_price > 0 ? ((p.retail_price - p.avg_cost) / p.retail_price) * 100 : 0),
    };
    const get = getters[marginSortKey];
    if (!get) return base;
    return sortRows(base, get, marginSortDir);
  }, [products, marginSortKey, marginSortDir]);

  const debtorRows = useMemo(() => {
    const base = customers.filter((c) => c.current_debt > 0);
    if (!debtSortKey) return base;
    const getters: Record<string, (c: Customer) => unknown> = {
      name: (c) => c.name,
      phone: (c) => c.phone,
      current_debt: (c) => c.current_debt,
      debt_limit: (c) => c.debt_limit,
      debt_rate: (c) => (c.debt_limit > 0 ? (c.current_debt / c.debt_limit) * 100 : 0),
    };
    const get = getters[debtSortKey];
    if (!get) return base;
    return sortRows(base, get, debtSortDir);
  }, [customers, debtSortKey, debtSortDir]);

  // Revenue computations
  const totalRevenue = orders
    .filter((o) => o.status === 'completed' || o.status === 'deposit_order')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const totalCollected = orders
    .filter((o) => o.status === 'completed' || o.status === 'deposit_order')
    .reduce((sum, o) => sum + o.paid_amount, 0);

  const totalDebtReceivable = customers.reduce((sum, c) => sum + c.current_debt, 0);

  const totalStockValue = products.reduce((sum, p) => {
    if (p.product_type === 'service') return sum;
    return sum + p.stock_quantity * p.avg_cost;
  }, 0);

  // Profit calculation on completed orders
  const grossProfit = orders
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

  // ---- Xuất Excel / In báo cáo ----
  const handleExportExcel = () => {
    exportToExcel('bao-cao-quan-tri', [
      {
        name: 'TongHop',
        rows: [
          { 'Chỉ tiêu': 'Doanh thu đơn hàng', 'Giá trị': totalRevenue },
          { 'Chỉ tiêu': 'Thực thu', 'Giá trị': totalCollected },
          { 'Chỉ tiêu': 'Công nợ phải thu', 'Giá trị': totalDebtReceivable },
          { 'Chỉ tiêu': 'Giá trị tồn kho', 'Giá trị': Math.round(totalStockValue) },
          { 'Chỉ tiêu': 'Lãi gộp ước tính', 'Giá trị': Math.round(grossProfit) },
        ],
      },
      {
        name: 'BienLoi',
        rows: marginRows.map((p) => ({
          'Sản phẩm': p.name,
          'Giá bán': p.retail_price,
          'Giá vốn': Math.round(p.avg_cost),
          'Biên lợi': Math.round(p.retail_price - p.avg_cost),
          'Biên lợi (%)': p.retail_price > 0 ? Math.round(((p.retail_price - p.avg_cost) / p.retail_price) * 10000) / 100 : 0,
        })),
      },
      {
        name: 'CongNo',
        rows: debtorRows.map((c) => ({
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
        `Doanh thu: ${formatVND(totalRevenue)}`,
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
      rows: debtorRows.slice(0, 1000).map((c) => [c.name, c.phone, c.current_debt.toLocaleString('vi-VN'), c.debt_limit.toLocaleString('vi-VN')]),
      footer: ['Tổng', '', totalDebtReceivable.toLocaleString('vi-VN'), ''],
    });
  };

  return (
    <div id="reports-view" className="flex-1 flex flex-col h-[calc(100vh-56px)] bg-slate-100 overflow-hidden">
      {/* Top Header */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span>Báo cáo Quản trị & Phân tích Đa chiều</span>
          </h2>
          {realtimeStatus === 'connected' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Realtime: Đang kết nối</span>
            </span>
          )}
          {realtimeStatus === 'connecting' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              <span>Đang kết nối Realtime...</span>
            </span>
          )}
          {(realtimeStatus === 'disconnected' || realtimeStatus === 'error') && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>Ngoại tuyến</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="text-xs h-8 px-2 flex items-center gap-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 bg-white"
            title="Tải lại toàn bộ dữ liệu đơn hàng và sổ quỹ từ máy chủ"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
            <span>{refreshing ? 'Đang tải...' : 'Làm mới'}</span>
          </Button>

          <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-semibold">
            {(['today', 'week', 'month'] as const).map((r) => (
              <Button
                key={r}
                onClick={() => setTimeRange(r)}
                variant={timeRange === r ? 'secondary' : 'ghost'}
              >
                {r === 'today' ? 'Hôm nay' : r === 'week' ? 'Tuần này' : 'Tháng này'}
              </Button>
            ))}
          </div>
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <Stat
            label="DOANH THU ĐƠN HÀNG:"
            value={formatVND(totalRevenue)}
            sub={`Thực thu: ${formatVND(totalCollected)}`}
            tone="blue"
            icon={<Wallet className="w-3.5 h-3.5" />}
          />

          <Stat
            label="LỢI NHUẬN GỘP DỰ TÍNH:"
            value={formatVND(grossProfit)}
            sub={`Biên lợi nhuận gộp: ~${totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0}%`}
            tone="emerald"
            icon={<TrendingUp className="w-3.5 h-3.5" />}
          />

          <Stat
            label="TỔNG CÔNG NỢ PHẢI THU:"
            value={formatVND(totalDebtReceivable)}
            sub={`Của ${customers.filter((c) => c.current_debt > 0).length} khách hàng`}
            tone="rose"
            icon={<Users className="w-3.5 h-3.5" />}
          />

          <Stat
            label="GIÁ TRỊ TỒN KHO (VỐN MAC):"
            value={formatVND(totalStockValue)}
            sub={`${products.length} mã vật tư & hàng hóa`}
            tone="amber"
            icon={<Boxes className="w-3.5 h-3.5" />}
          />

          <Stat
            label="VAT ĐẦU RA (THÁNG NÀY):"
            value={formatVND(thisMonthVat?.vatTotal || 0)}
            sub={thisMonthVat ? `${thisMonthVat.orderCount} đơn hiệu lực • 8%: ${formatVND(thisMonthVat.vatByRate['8'] || 0)} • 10%: ${formatVND(thisMonthVat.vatByRate['10'] || 0)}` : 'Chưa có đơn hiệu lực'}
            tone="blue"
            icon={<Percent className="w-3.5 h-3.5" />}
          />
        </div>

        {/* VAT đầu ra theo tháng + đối chiếu sổ quỹ */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
            <Percent className="w-4 h-4 text-violet-600" />
            <span>Thuế VAT Đầu Ra Theo Tháng (Đối Chiếu Sổ Quỹ)</span>
          </h3>
          <div className="border border-slate-100 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2 px-3">Tháng</th>
                  <th className="py-2 px-3 text-center">Số đơn</th>
                  <th className="py-2 px-3 text-right">Doanh thu đơn</th>
                  <th className="py-2 px-3 text-right">VAT 8%</th>
                  <th className="py-2 px-3 text-right">VAT 10%</th>
                  <th className="py-2 px-3 text-right">Tổng VAT</th>
                  <th className="py-2 px-3 text-right">Sổ quỹ (bán + cọc)</th>
                  <th className="py-2 px-3 text-right">Chênh lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vatMonthly.length === 0 && (
                  <tr><td colSpan={8}>
                    <EmptyState message="Chưa có đơn hiệu lực" />
                  </td></tr>
                )}
                {vatMonthly.map((r) => {
                  const diff = r.revenue - r.booked;
                  return (
                    <tr key={r.month} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-bold text-slate-800">{vatLabel(r.month)}</td>
                      <td className="py-2 px-3 text-center font-mono tnum">{r.orderCount}</td>
                      <td className="py-2 px-3 text-right font-mono tnum">{formatVND(r.revenue)}</td>
                      <td className="py-2 px-3 text-right font-mono tnum text-slate-600">{formatVND(r.vatByRate['8'] || 0)}</td>
                      <td className="py-2 px-3 text-right font-mono tnum text-slate-600">{formatVND(r.vatByRate['10'] || 0)}</td>
                      <td className="py-2 px-3 text-right font-mono tnum font-bold text-violet-700">{formatVND(r.vatTotal)}</td>
                      <td className="py-2 px-3 text-right font-mono tnum text-emerald-700">{formatVND(r.booked)}</td>
                      <td className={`py-2 px-3 text-right font-mono tnum font-bold ${diff === 0 ? 'text-slate-400' : 'text-amber-700'}`}>
                        {diff === 0 ? '—' : formatVND(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            * Chênh lệch (Doanh thu − Sổ quỹ) ≈ bán nợ chưa thu + cọc chưa quyết toán. Đơn hủy/trả không tính VAT.
            Đơn tạo trước bản VAT không có số VAT nên hiển thị 0.
          </p>
        </div>

        {/* Detailed Breakdown Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Selling Products & Margin */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-600" />
              <span>Hiệu Quả Kinh Doanh Từng Mặt Hàng (Giá Bán vs Giá Vốn MAC)</span>
            </h3>

            <div className="border border-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <SortableTh className="py-2 px-3" label="Tên sản phẩm" sortKey="name" activeKey={marginSortKey} dir={marginSortDir} onSort={toggleMarginSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Giá bán" sortKey="retail_price" activeKey={marginSortKey} dir={marginSortDir} onSort={toggleMarginSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Vốn MAC" sortKey="avg_cost" activeKey={marginSortKey} dir={marginSortDir} onSort={toggleMarginSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Chênh lệch" sortKey="margin" activeKey={marginSortKey} dir={marginSortDir} onSort={toggleMarginSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Tỷ suất lãi" sortKey="margin_pct" activeKey={marginSortKey} dir={marginSortDir} onSort={toggleMarginSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marginRows.map((p) => {
                    const margin = p.retail_price - p.avg_cost;
                    const marginPct = p.retail_price > 0 ? (margin / p.retail_price) * 100 : 0;
  return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-800 truncate max-w-[160px]">
                          {p.name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum">{formatVND(p.retail_price)}</td>
                        <td className="py-2 px-3 text-right font-mono tnum text-slate-500">
                          {formatVND(p.avg_cost)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum font-bold text-emerald-700">
                          +{formatVND(margin)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                          {marginPct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Debt Aging & Customers */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-rose-600" />
              <span>Khách Hàng Có Dư Nợ Lớn Nhất</span>
            </h3>

            <div className="border border-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <SortableTh className="py-2 px-3" label="Tên khách" sortKey="name" activeKey={debtSortKey} dir={debtSortDir} onSort={toggleDebtSort} />
                    <SortableTh className="py-2 px-3" label="SĐT" sortKey="phone" activeKey={debtSortKey} dir={debtSortDir} onSort={toggleDebtSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Dư nợ hiện hữu" sortKey="current_debt" activeKey={debtSortKey} dir={debtSortDir} onSort={toggleDebtSort} />
                    <SortableTh className="py-2 px-3 text-right" label="Hạn mức" sortKey="debt_limit" activeKey={debtSortKey} dir={debtSortDir} onSort={toggleDebtSort} />
                    <SortableTh className="py-2 px-3 text-center" label="Tỷ lệ nợ" sortKey="debt_rate" activeKey={debtSortKey} dir={debtSortDir} onSort={toggleDebtSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {debtorRows
                    .map((c) => {
                      const debtRate = c.debt_limit > 0 ? (c.current_debt / c.debt_limit) * 100 : 0;
  return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold text-slate-800">{c.name}</td>
                          <td className="py-2 px-3 font-mono text-slate-500">{c.phone}</td>
                          <td className="py-2 px-3 text-right font-mono tnum font-bold text-rose-600">
                            {formatVND(c.current_debt)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tnum text-slate-500">
                            {formatVND(c.debt_limit)}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-slate-700">
                            {debtRate.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
