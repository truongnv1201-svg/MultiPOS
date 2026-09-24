'use client';

import React, { useState, useMemo, useDeferredValue } from 'react';
import { useStore } from '@/lib/store';
import { formatVND } from '@/lib/format';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Boxes,
  Users,
  Percent,
  Search,
  Wallet,
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { DataTableShell } from '@/components/common/DataTableShell';
import { PaginationBar } from '@/components/common/PaginationBar';
import { notify } from '@/components/common/Toast';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';
import type { Product, Customer, Supplier } from '@/lib/types';

type ReportTab = 'overview' | 'vat' | 'margin' | 'debt';

// Nhãn kỳ báo cáo dùng chung (badge, Excel, In)
function rangeLabel(f: DateFilterState): string {
  switch (f.preset) {
    case 'today':
      return 'hôm nay';
    case 'yesterday':
      return 'hôm qua';
    case '7days':
      return '7 ngày qua';
    case 'this_month':
      return 'tháng này';
    case 'custom':
      return `${f.fromDate || '...'} → ${f.toDate || '...'}`;
    default:
      return 'toàn thời gian';
  }
}

// ---------- Biểu đồ SVG thuần (không thêm dependency) ----------
const formatCompactVND = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ`;
  if (abs >= 1_000_000) {
    const tr = v / 1_000_000;
    return `${Number.isInteger(tr) ? tr.toFixed(0) : tr.toFixed(1)} tr`;
  }
  if (abs >= 1_000) return `${Math.round(v / 1_000)}K`;
  return `${Math.round(v)}`;
};

interface RevenueDay {
  key: string;
  label: string;
  revenue: number;
  collected: number;
}

function RevenueBarChart({ days }: { days: RevenueDay[] }) {
  const W = 680;
  const H = 250;
  const padL = 46;
  const padB = 26;
  const padT = 14;
  const innerW = W - padL - 8;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, d.collected)));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const gw = innerW / Math.max(1, days.length);
  const bw = Math.min(14, gw * 0.28);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  if (days.every((d) => d.revenue === 0 && d.collected === 0)) {
    return <div className="h-[250px] flex items-center justify-center text-xs text-slate-400">Chưa có đơn hiệu lực trong 14 ngày qua.</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Doanh thu 14 ngày gần nhất">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? '' : '3 3'} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
            {formatCompactVND(t)}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const cx = padL + gw * i + gw / 2;
        const h1 = Math.max((d.revenue / max) * innerH, 2);
        const h2 = Math.max((d.collected / max) * innerH, 2);
        return (
          <g key={d.key}>
            <rect x={cx - bw - 1.5} y={y(d.revenue)} width={bw} height={h1} rx={2.5} fill="#2563eb">
              <title>{`${d.label} • Doanh thu: ${formatVND(d.revenue)}`}</title>
            </rect>
            <rect x={cx + 1.5} y={y(d.collected)} width={bw} height={h2} rx={2.5} fill="#10b981">
              <title>{`${d.label} • Thực thu: ${formatVND(d.collected)}`}</title>
            </rect>
            {i % 2 === 0 && (
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CashflowDonut({ receipt, expense }: { receipt: number; expense: number }) {
  const total = receipt + expense;
  const size = 180;
  const r = 68;
  const c = 2 * Math.PI * r;
  const segs = [
    { label: 'Thu', value: receipt, color: '#10b981' },
    { label: 'Chi', value: expense, color: '#f43f5e' },
  ];
  if (total <= 0) {
    return <div className="h-[180px] flex items-center justify-center text-xs text-slate-400">Chưa có thu chi trong tháng này.</div>;
  }
  let acc = 0;
  const net = receipt - expense;
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Dòng tiền sổ quỹ tháng này">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={26} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segs.map((s) => {
            const frac = s.value / total;
            const len = Math.max(frac * c - 2, 0.5);
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={26}
                strokeDasharray={`${len} ${c}`}
                strokeDashoffset={-acc * c}
              >
                <title>{`${s.label}: ${formatVND(s.value)}`}</title>
              </circle>
            );
            acc += frac;
            return el;
          })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="15" fontWeight={800} fill={net >= 0 ? '#047857' : '#e11d48'}>
          {net >= 0 ? '+' : ''}{formatCompactVND(net)}
        </text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fontSize="10" fill="#94a3b8">
          Thu ròng
        </text>
      </svg>
      <div className="w-full space-y-1.5 text-xs">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label} ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)
            </span>
            <strong className="font-mono text-slate-800">{formatVND(s.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReportsView() {
  const _s = useStore();
  // Báo cáo gom 5 nguồn (đơn/kho/KH/NCC/sổ quỹ) về muộn không cùng lúc sau mỗi pull
  // realtime -> thẻ + biểu đồ nhấp nháy qua các giá trị trung gian. Defer để UI
  // render 1 khung nhất quán khi dữ liệu đã ổn định.
  const orders = useDeferredValue(_s.orders);
  const products = useDeferredValue(_s.products);
  const customers = useDeferredValue(_s.customers);
  const suppliers = useDeferredValue(_s.suppliers);
  const cashbook = useDeferredValue(_s.cashbook);
  const isLiveStale =
    orders !== _s.orders ||
    products !== _s.products ||
    customers !== _s.customers ||
    suppliers !== _s.suppliers ||
    cashbook !== _s.cashbook;
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  // Kỳ báo cáo tab Tổng quan: dùng DateFilter chung (có Tùy chọn ngày)
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'today' });
  // Sắp xếp 2 bảng: bấm header để đảo chiều; đổi sort/tìm kiếm -> về trang 1
  const { sortKey: marginSortKey, sortDir: marginSortDir, toggleSort: toggleMarginSortRaw } = useSortState();
  const { sortKey: debtSortKey, sortDir: debtSortDir, toggleSort: toggleDebtSortRaw } = useSortState('current_debt', 'desc');
  const [marginSearch, setMarginSearch] = useState('');
  const [marginPage, setMarginPage] = useState(1);
  const [marginPageSize, setMarginPageSize] = useState(15);
  const [debtSearch, setDebtSearch] = useState('');
  const [debtPage, setDebtPage] = useState(1);
  const [debtPageSize, setDebtPageSize] = useState(15);
  // Công nợ 2 chiều: phải thu (KH) / phải trả (NCC) — mỗi chiều sort/search/page riêng
  const [debtSide, setDebtSide] = useState<'customer' | 'supplier'>('customer');
  const { sortKey: supSortKey, sortDir: supSortDir, toggleSort: toggleSupSortRaw } = useSortState('current_debt', 'desc');
  const [supSearch, setSupSearch] = useState('');
  const [supPage, setSupPage] = useState(1);
  const [supPageSize, setSupPageSize] = useState(15);

  const handleSupSort = (key: string) => {
    toggleSupSortRaw(key);
    setSupPage(1);
  };

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

  const supFiltered = useMemo(() => {
    const base = suppliers.filter((s) => s.current_debt > 0);
    const q = supSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.phone || '').includes(q),
    );
  }, [suppliers, supSearch]);

  const sortedSuppliers = useMemo(() => {
    if (!supSortKey) return supFiltered;
    const getters: Record<string, (s: Supplier) => unknown> = {
      name: (s) => s.name,
      phone: (s) => s.phone,
      current_debt: (s) => s.current_debt,
      credit_limit: (s) => s.credit_limit || 0,
      debt_rate: (s) => ((s.credit_limit || 0) > 0 ? (s.current_debt / (s.credit_limit || 1)) * 100 : 0),
    };
    const get = getters[supSortKey];
    if (!get) return supFiltered;
    return sortRows(supFiltered, get, supSortDir);
  }, [supFiltered, supSortKey, supSortDir]);

  const supTotalPages = Math.max(1, Math.ceil(sortedSuppliers.length / supPageSize));
  const safeSupPage = Math.min(Math.max(1, supPage), supTotalPages);
  const supRows = useMemo(() => {
    const start = (safeSupPage - 1) * supPageSize;
    return sortedSuppliers.slice(start, start + supPageSize);
  }, [sortedSuppliers, safeSupPage, supPageSize]);

  const totalSupplierDebt = suppliers.reduce((sum, s) => sum + (s.current_debt || 0), 0);
  const supplierDebtorCount = suppliers.filter((s) => s.current_debt > 0).length;

  // ---- KPI theo kỳ (DateFilter chung, có Tùy chọn ngày) ----
  const rangedOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        (o.status === 'completed' || o.status === 'deposit_order') &&
        matchesDateFilter(o.created_at, dateFilter),
    );
  }, [orders, dateFilter]);

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

  // ---- Dữ liệu biểu đồ tổng quan ----
  const revenue14d: RevenueDay[] = useMemo(() => {
    const days: RevenueDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      let revenue = 0;
      let collected = 0;
      for (const o of orders) {
        if (o.status !== 'completed' && o.status !== 'deposit_order') continue;
        const t = new Date(o.created_at).getTime();
        if (Number.isNaN(t) || t < d.getTime() || t >= next.getTime()) continue;
        revenue += o.total_amount || 0;
        collected += o.paid_amount || 0;
      }
      days.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        revenue,
        collected,
      });
    }
    return days;
  }, [orders]);

  const cashflowMonth = useMemo(() => {
    const now = new Date();
    let receipt = 0;
    let expense = 0;
    for (const e of cashbook) {
      const d = new Date(e.created_at);
      if (Number.isNaN(d.getTime())) continue;
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue;
      if (e.type === 'receipt') receipt += e.amount || 0;
      else expense += e.amount || 0;
    }
    return { receipt, expense };
  }, [cashbook]);

  // ---- Xuất Excel / In theo từng tab ----
  const summaryRows = [
    { 'Chỉ tiêu': `Doanh thu đơn hàng (${rangeLabel(dateFilter)})`, 'Giá trị': totalRevenue },
    { 'Chỉ tiêu': 'Thực thu', 'Giá trị': totalCollected },
    { 'Chỉ tiêu': 'Công nợ phải thu (KH)', 'Giá trị': totalDebtReceivable },
    { 'Chỉ tiêu': 'Công nợ phải trả (NCC)', 'Giá trị': totalSupplierDebt },
    { 'Chỉ tiêu': 'Giá trị tồn kho', 'Giá trị': Math.round(totalStockValue) },
    { 'Chỉ tiêu': 'Lãi gộp ước tính', 'Giá trị': Math.round(grossProfit) },
  ];
  const marginExcelRows = (list: Product[]) =>
    list.map((p) => ({
      'Sản phẩm': p.name,
      'Giá bán': p.retail_price,
      'Giá vốn': Math.round(p.avg_cost),
      'Biên lợi': Math.round(p.retail_price - p.avg_cost),
      'Biên lợi (%)': p.retail_price > 0 ? Math.round(((p.retail_price - p.avg_cost) / p.retail_price) * 10000) / 100 : 0,
    }));
  const debtExcelRows = (list: Customer[]) =>
    list.map((c) => ({
      'Khách hàng': c.name,
      'SĐT': c.phone,
      'Đang nợ': c.current_debt,
      'Hạn mức': c.debt_limit,
    }));
  const vatExcelRows = vatMonthly.map((r) => ({
    'Tháng': vatLabel(r.month),
    'Số đơn': r.orderCount,
    'Doanh thu đơn': r.revenue,
    'VAT 8%': Math.round(r.vatByRate['8'] || 0),
    'VAT 10%': Math.round(r.vatByRate['10'] || 0),
    'Tổng VAT': Math.round(r.vatTotal),
    'Sổ quỹ (bán + cọc)': r.booked,
    'Chênh lệch': r.revenue - r.booked,
  }));

  const handleExportOverview = () => {
    exportToExcel('bao-cao-quan-tri', [
      { name: 'TongHop', rows: summaryRows },
      { name: 'BienLoi', rows: marginExcelRows(sortedMargin) },
      { name: 'CongNo', rows: debtExcelRows(sortedDebtors) },
      {
        name: 'CongNoNCC',
        rows: sortedSuppliers.map((s) => ({
          'Nhà cung cấp': s.name,
          'SĐT': s.phone,
          'Đang nợ': s.current_debt,
          'Hạn mức': s.credit_limit || 0,
        })),
      },
      { name: 'VAT', rows: vatExcelRows },
    ]);
  };
  const handleExportVat = () => {
    if (vatMonthly.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('bao-cao-vat-dau-ra', [{ name: 'VAT', rows: vatExcelRows }]);
  };
  const handleExportMargin = () => {
    if (sortedMargin.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('bao-cao-bien-loi', [{ name: 'BienLoi', rows: marginExcelRows(sortedMargin) }]);
  };
  const handleExportDebtCustomer = () => {
    if (sortedDebtors.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('bao-cao-cong-no-phai-thu', [{ name: 'CongNoKH', rows: debtExcelRows(sortedDebtors) }]);
  };
  const handleExportDebtSupplier = () => {
    if (sortedSuppliers.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('bao-cao-cong-no-phai-tra', [
      {
        name: 'CongNoNCC',
        rows: sortedSuppliers.map((s) => ({
          'Nhà cung cấp': s.name,
          'SĐT': s.phone,
          'Đang nợ': s.current_debt,
          'Hạn mức': s.credit_limit || 0,
        })),
      },
    ]);
  };

  const handlePrintOverview = () => {
    printTable({
      title: `Báo cáo quản trị (${rangeLabel(dateFilter)})`,
      meta: [`In lúc ${new Date().toLocaleString('vi-VN')}`],
      columns: [{ header: 'Chỉ tiêu' }, { header: 'Giá trị', align: 'right' }],
      rows: summaryRows.map((r) => [String(r['Chỉ tiêu']), Number(r['Giá trị']).toLocaleString('vi-VN')]),
    });
  };
  const handlePrintVat = () => {
    if (vatMonthly.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Thuế VAT đầu ra theo tháng (đối chiếu sổ quỹ)',
      meta: [`Tổng VAT: ${formatVND(vatTotals.vat)}`, `Chênh lệch: ${formatVND(vatTotals.diff)}`],
      columns: [
        { header: 'Tháng' },
        { header: 'Số đơn', align: 'right' },
        { header: 'Doanh thu đơn', align: 'right' },
        { header: 'Tổng VAT', align: 'right' },
        { header: 'Sổ quỹ (bán + cọc)', align: 'right' },
        { header: 'Chênh lệch', align: 'right' },
      ],
      rows: vatMonthly.map((r) => [
        vatLabel(r.month),
        String(r.orderCount),
        Math.round(r.revenue).toLocaleString('vi-VN'),
        Math.round(r.vatTotal).toLocaleString('vi-VN'),
        Math.round(r.booked).toLocaleString('vi-VN'),
        Math.round(r.revenue - r.booked).toLocaleString('vi-VN'),
      ]),
      footer: ['Tổng', String(vatMonthly.reduce((s, r) => s + r.orderCount, 0)), Math.round(vatTotals.revenue).toLocaleString('vi-VN'), Math.round(vatTotals.vat).toLocaleString('vi-VN'), Math.round(vatTotals.booked).toLocaleString('vi-VN'), Math.round(vatTotals.diff).toLocaleString('vi-VN')],
    });
  };
  const handlePrintMargin = () => {
    if (sortedMargin.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Hiệu quả kinh doanh từng mặt hàng (giá bán vs vốn MAC)',
      meta: [`${sortedMargin.length} mặt hàng`],
      columns: [
        { header: 'Sản phẩm' },
        { header: 'Giá bán', align: 'right' },
        { header: 'Vốn MAC', align: 'right' },
        { header: 'Chênh lệch', align: 'right' },
        { header: 'Tỷ suất lãi', align: 'right' },
      ],
      rows: sortedMargin.slice(0, 1000).map((p) => {
        const margin = p.retail_price - p.avg_cost;
        const pct = p.retail_price > 0 ? (margin / p.retail_price) * 100 : 0;
        return [
          p.name,
          Math.round(p.retail_price).toLocaleString('vi-VN'),
          Math.round(p.avg_cost).toLocaleString('vi-VN'),
          Math.round(margin).toLocaleString('vi-VN'),
          `${pct.toFixed(1)}%`,
        ];
      }),
    });
  };
  const handlePrintDebtCustomer = () => {
    if (sortedDebtors.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Công nợ phải thu khách hàng',
      meta: [`${sortedDebtors.length} khách đang nợ`, `Tổng nợ: ${formatVND(totalDebtReceivable)}`],
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
  const handlePrintDebtSupplier = () => {
    if (sortedSuppliers.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Công nợ phải trả nhà cung cấp',
      meta: [`${sortedSuppliers.length} NCC đang nợ`, `Tổng nợ: ${formatVND(totalSupplierDebt)}`],
      columns: [
        { header: 'Nhà cung cấp' },
        { header: 'SĐT' },
        { header: 'Đang nợ', align: 'right' },
        { header: 'Hạn mức', align: 'right' },
      ],
      rows: sortedSuppliers.slice(0, 1000).map((s) => [s.name, s.phone, s.current_debt.toLocaleString('vi-VN'), (s.credit_limit || 0).toLocaleString('vi-VN')]),
      footer: ['Tổng', '', totalSupplierDebt.toLocaleString('vi-VN'), ''],
    });
  };

  const tabBadge =
    activeTab === 'overview'
      ? `${rangedOrders.length} đơn ${rangeLabel(dateFilter)}`
      : activeTab === 'vat'
        ? `${vatMonthly.length} tháng`
        : activeTab === 'margin'
          ? `${sortedMargin.length} mặt hàng`
          : `${sortedDebtors.length + sortedSuppliers.length} bên nợ (KH + NCC)`;

  const tabBtn = (key: ReportTab, label: string) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
        activeTab === key ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div id="reports-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      {/* Top bar — style chung: tiêu đề + Tab Switcher + tools theo tab */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span className="hidden md:inline">Báo cáo Quản trị & Phân tích Đa chiều</span>
            <span className="md:hidden">Báo cáo</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded whitespace-nowrap">
            {tabBadge}
          </span>
          {isLiveStale && (
            <span
              className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 font-mono rounded whitespace-nowrap"
              role="status"
              aria-live="polite"
            >
              Đang cập nhật số liệu…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {tabBtn('overview', 'Tổng quan')}
            {tabBtn('vat', `VAT đầu ra (${vatMonthly.length})`)}
            {tabBtn('margin', `Mặt hàng (${sortedMargin.length})`)}
            {tabBtn('debt', `Công nợ (${sortedDebtors.length + sortedSuppliers.length})`)}
          </div>
          {activeTab === 'overview' && <TableTools onExportExcel={handleExportOverview} onPrint={handlePrintOverview} />}
          {activeTab === 'vat' && <TableTools onExportExcel={handleExportVat} onPrint={handlePrintVat} />}
          {activeTab === 'margin' && <TableTools onExportExcel={handleExportMargin} onPrint={handlePrintMargin} />}
          {activeTab === 'debt' && debtSide === 'customer' && <TableTools onExportExcel={handleExportDebtCustomer} onPrint={handlePrintDebtCustomer} />}
          {activeTab === 'debt' && debtSide === 'supplier' && <TableTools onExportExcel={handleExportDebtSupplier} onPrint={handlePrintDebtSupplier} />}
        </div>
      </div>

      {/* Main content body — khung cố định, chân bảng sát lề dưới (chuẩn các trang khác) */}
      <div className="flex-1 p-4 overflow-hidden min-h-0">
        {activeTab === 'overview' && (
          <div className="h-full overflow-y-auto space-y-4">
            {/* Kỳ báo cáo — chỉ áp dụng cho cụm thẻ KPI bên dưới */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Kỳ báo cáo <span className="font-normal text-slate-400">(áp dụng cho 5 thẻ chỉ tiêu)</span>
              </span>
              <DateFilter value={dateFilter} onChange={setDateFilter} />
            </div>

            {/* Overview Metric Cards — nền màu theo chỉ tiêu */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <div className="bg-blue-50/80 p-3.5 rounded-xl border border-blue-200">
                <div className="flex items-center justify-between text-xs text-blue-800 font-semibold mb-1">
                  <span>DOANH THU ĐƠN HÀNG:</span>
                  <DollarSign className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-xl font-extrabold text-blue-900 font-mono">
                  {formatVND(totalRevenue)}
                </div>
                <div className="text-[10px] text-blue-600 mt-1">
                  Thực thu: <strong className="font-mono">{formatVND(totalCollected)}</strong> • {rangedOrders.length} đơn
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
                  {sortedDebtors.length} KH đang nợ • Nợ NCC: <strong className="font-mono">{formatVND(totalSupplierDebt)}</strong>
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

            {/* Biểu đồ trực quan */}
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 pb-1">
              <div className="xl:col-span-3 bg-white rounded-xl border border-slate-200 shadow-2xs p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <span>Doanh Thu 14 Ngày Gần Nhất</span>
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-600" /> Doanh thu
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Thực thu
                    </span>
                  </div>
                </div>
                <RevenueBarChart days={revenue14d} />
              </div>
              <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-2xs p-4">
                <h3 className="font-bold text-xs text-slate-800 flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span>Dòng Tiền Sổ Quỹ Tháng Này</span>
                </h3>
                <CashflowDonut receipt={cashflowMonth.receipt} expense={cashflowMonth.expense} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vat' && (
          <DataTableShell>
            {/* Dòng tổng hợp riêng, ngay trên tiêu đề cột */}
            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between text-[11px] font-medium text-slate-600 gap-2">
              <span>
                Tìm thấy <strong className="text-slate-900 font-mono">{vatMonthly.length}</strong> tháng • Tổng doanh thu:{' '}
                <strong className="font-mono text-slate-900 font-bold">{formatVND(vatTotals.revenue)}</strong>
              </span>
              <div className="flex items-center gap-4">
                <span>
                  Sổ quỹ (bán + cọc):{' '}
                  <strong className="font-mono text-emerald-700 font-bold">+{formatVND(vatTotals.booked)}</strong>
                </span>
                <span>
                  Chênh lệch:{' '}
                  <strong className="font-mono text-amber-700 font-bold">{formatVND(vatTotals.diff)}</strong>
                </span>
                <span>
                  Tổng VAT:{' '}
                  <strong className="font-mono text-violet-700 font-bold">{formatVND(vatTotals.vat)}</strong>
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
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
        )}

        {activeTab === 'margin' && (
          <DataTableShell>
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <div className="relative flex-1 min-w-[200px]">
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

            {/* Dòng tổng hợp riêng, ngay trên tiêu đề cột */}
            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between text-[11px] font-medium text-slate-600 gap-2">
              <span>
                Tìm thấy <strong className="text-slate-900 font-mono">{sortedMargin.length}</strong> mặt hàng
              </span>
              <div className="flex items-center gap-4">
                <span>
                  Tổng chênh lệch:{' '}
                  <strong className="font-mono text-emerald-700 font-bold">
                    +{formatVND(sortedMargin.reduce((s, p) => s + (p.retail_price - p.avg_cost), 0))}
                  </strong>
                </span>
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
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
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
                          <td className="py-2.5 px-3 font-semibold text-slate-800 max-w-[280px] truncate" title={p.name}>
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
              pageSizeOptions={[15, 25, 50, 100]}
              itemName="mặt hàng"
            />
          </DataTableShell>
        )}

        {activeTab === 'debt' && (
          <DataTableShell>
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={debtSide === 'customer' ? debtSearch : supSearch}
                  onChange={(e) => {
                    if (debtSide === 'customer') {
                      setDebtSearch(e.target.value);
                      setDebtPage(1);
                    } else {
                      setSupSearch(e.target.value);
                      setSupPage(1);
                    }
                  }}
                  placeholder={debtSide === 'customer' ? 'Tìm khách nợ theo tên, SĐT...' : 'Tìm NCC theo tên, SĐT...'}
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>
              {/* Chiều công nợ: phải thu (KH) / phải trả (NCC) */}
              <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
                <button
                  onClick={() => setDebtSide('customer')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    debtSide === 'customer' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Phải thu KH ({sortedDebtors.length})
                </button>
                <button
                  onClick={() => setDebtSide('supplier')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    debtSide === 'supplier' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Phải trả NCC ({sortedSuppliers.length})
                </button>
              </div>
            </div>

            {/* Dòng tổng hợp riêng, ngay trên tiêu đề cột */}
            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between text-[11px] font-medium text-slate-600 gap-2">
              <span>
                Tìm thấy{' '}
                <strong className="text-slate-900 font-mono">
                  {debtSide === 'customer' ? sortedDebtors.length : sortedSuppliers.length}
                </strong>{' '}
                {debtSide === 'customer' ? 'khách đang nợ' : 'NCC đang nợ'}
              </span>
              <div className="flex items-center gap-4">
                <span>
                  {debtSide === 'customer' ? 'Tổng phải thu:' : 'Tổng phải trả:'}{' '}
                  <strong className={`font-mono font-bold ${debtSide === 'customer' ? 'text-rose-600' : 'text-amber-700'}`}>
                    {formatVND(debtSide === 'customer' ? totalDebtReceivable : totalSupplierDebt)}
                  </strong>
                </span>
              </div>
            </div>

            {debtSide === 'customer' ? (
              <>
                <div className="flex-1 min-h-0 overflow-auto">
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
                  pageSizeOptions={[15, 25, 50, 100]}
                  itemName="khách hàng"
                />
              </>
            ) : (
              <>
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                        <SortableTh className="py-2.5 px-3" label="Nhà cung cấp" sortKey="name" activeKey={supSortKey} dir={supSortDir} onSort={handleSupSort} />
                        <SortableTh className="py-2.5 px-3" label="SĐT" sortKey="phone" activeKey={supSortKey} dir={supSortDir} onSort={handleSupSort} />
                        <SortableTh className="py-2.5 px-3 text-right" label="Nợ phải trả" sortKey="current_debt" activeKey={supSortKey} dir={supSortDir} onSort={handleSupSort} />
                        <SortableTh className="py-2.5 px-3 text-right" label="Hạn mức" sortKey="credit_limit" activeKey={supSortKey} dir={supSortDir} onSort={handleSupSort} />
                        <SortableTh className="py-2.5 px-3 text-center" label="Tỷ lệ nợ" sortKey="debt_rate" activeKey={supSortKey} dir={supSortDir} onSort={handleSupSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {supRows.length === 0 ? (
                        <tr><td colSpan={5} className="py-12 text-center text-slate-400">Không tìm thấy nhà cung cấp nào phù hợp.</td></tr>
                      ) : (
                        supRows.map((s) => {
                          const limit = s.credit_limit || 0;
                          const debtRate = limit > 0 ? (s.current_debt / limit) * 100 : 0;
                          const overLimit = limit > 0 && s.current_debt > limit;
                          return (
                            <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-slate-800">{s.name}</td>
                              <td className="py-2.5 px-3 font-mono text-slate-500">{s.phone}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                                {formatVND(s.current_debt)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                                {limit > 0 ? formatVND(limit) : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {limit > 0 ? (
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
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <PaginationBar
                  currentPage={safeSupPage}
                  totalItems={sortedSuppliers.length}
                  pageSize={supPageSize}
                  onPageChange={setSupPage}
                  onPageSizeChange={(s) => {
                    setSupPageSize(s);
                    setSupPage(1);
                  }}
                  pageSizeOptions={[15, 25, 50, 100]}
                  itemName="nhà cung cấp"
                />
              </>
            )}
          </DataTableShell>
        )}
      </div>
    </div>
  );
}
