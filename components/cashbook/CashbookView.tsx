'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { CashbookEntry } from '@/lib/types';
import { formatVND } from '@/lib/format';
import {
  Wallet,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Banknote,
  QrCode,
  Filter,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { PaginationBar } from '@/components/common/PaginationBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SearchInput, FilterSelect } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty } from '@/components/ui/ListStates';
import { AppButton } from '@/components/ui/AppButton';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { NumberInput } from '@/components/common/NumberInput';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { notify } from '@/components/common/Toast';
import { sortRows } from '@/lib/sort';
import { DataTableShell } from '@/components/common/DataTableShell';

export function CashbookView() {
  const { cashbook, addCashbookEntry, employees, profile, addAdvanceVoucher, shop } = useStore();
  const isManager = profile?.role === 'admin' || profile?.role === 'manager';
  const [search, setSearch] = useState('');
  const [fundFilter, setFundFilter] = useState<'all' | 'cash' | 'bank'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'receipt' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: '7days' });
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  // Sắp xếp: bấm header để đảo chiều; đổi sort -> về trang 1
  // Mặc định mới nhất lên trên (khớp thứ tự server) để không nháy khi dữ liệu về.
  const { sortKey, sortDir, toggleSort } = useSortState('created_at', 'desc');
  const handleSort = (key: string) => {
    toggleSort(key);
    setPage(1);
  };

  // New voucher modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [voucherType, setVoucherType] = useState<'receipt' | 'expense'>('receipt');
  const [fundType, setFundType] = useState<'cash' | 'bank'>('cash');
  const [category, setCategory] = useState<CashbookEntry['category']>('other');
  const [amount, setAmount] = useState<number>(500000);
  const [partnerName, setPartnerName] = useState('');
  const [note, setNote] = useState('');
  // Nhân viên nhận tạm ứng (chỉ hiện khi Hạng mục = Tạm ứng lương)
  const [advanceEmpId, setAdvanceEmpId] = useState('');
  const isAdvanceVoucher = voucherType === 'expense' && category === 'advance';
  const activeEmployees = employees.filter((e) => e.status === 'active');

  // Total balance computations — cộng số dư đầu kỳ trong Cài đặt (mặc định 0).
  // Trước đây cộng cứng 2M/15M trong code nên project mới chưa phát sinh gì vẫn
  // hiện 17M tồn quỹ.
  const cashBalance = cashbook.reduce((sum, e) => {
    if (e.fund_type !== 'cash') return sum;
    return e.type === 'receipt' ? sum + e.amount : sum - e.amount;
  }, shop.openingCashBalance ?? 0);

  const bankBalance = cashbook.reduce((sum, e) => {
    if (e.fund_type !== 'bank') return sum;
    return e.type === 'receipt' ? sum + e.amount : sum - e.amount;
  }, shop.openingBankBalance ?? 0);

  const totalBalance = cashBalance + bankBalance;

  const filteredEntries = useMemo(() => {
    return cashbook.filter((e) => {
      const matchesSearch =
        e.code.toLowerCase().includes(search.toLowerCase()) ||
        (e.partner_name && e.partner_name.toLowerCase().includes(search.toLowerCase())) ||
        e.note.toLowerCase().includes(search.toLowerCase());
      const matchesFund = fundFilter === 'all' || e.fund_type === fundFilter;
      const matchesType = typeFilter === 'all' || e.type === typeFilter;
      const matchesCategory = categoryFilter === 'all' || e.category === categoryFilter;
      const matchesDate = matchesDateFilter(e.created_at, dateFilter);
      return matchesSearch && matchesFund && matchesType && matchesCategory && matchesDate;
    });
  }, [cashbook, search, fundFilter, typeFilter, categoryFilter, dateFilter]);

  const sortedEntries = useMemo(() => {
    if (!sortKey) return filteredEntries;
    const getters: Record<string, (e: CashbookEntry) => unknown> = {
      code: (e) => e.code,
      created_at: (e) => e.created_at,
      fund_type: (e) => e.fund_type,
      category: (e) => e.category,
      partner_name: (e) => e.partner_name,
      note: (e) => e.note,
      amount: (e) => e.amount,
    };
    const get = getters[sortKey];
    if (!get) return filteredEntries;
    return sortRows(filteredEntries, get, sortDir);
  }, [filteredEntries, sortKey, sortDir]);

  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedEntries.slice(start, start + pageSize);
  }, [sortedEntries, page, pageSize]);

  const filteredReceiptTotal = useMemo(() => {
    return filteredEntries.filter((e) => e.type === 'receipt').reduce((sum, e) => sum + e.amount, 0);
  }, [filteredEntries]);

  const filteredExpenseTotal = useMemo(() => {
    return filteredEntries.filter((e) => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  }, [filteredEntries]);

  const filteredNet = filteredReceiptTotal - filteredExpenseTotal;

  // ---- Xuất Excel / In bảng ----
  const CATEGORY_LABEL: Record<string, string> = {
    sales: 'Thu tiền bán hàng',
    deposit: 'Thu đặt cọc',
    debt_collection: 'Thu nợ khách',
    supplier_payment: 'Chi trả NCC',
    labor: 'Chi lương',
    material: 'Mua vật tư',
    advance: 'Tạm ứng lương',
    other: 'Thu/Chi khác',
  };

  const entryToRow = (e: CashbookEntry): Record<string, unknown> => ({
    'Mã phiếu': e.code,
    'Ngày': new Date(e.created_at).toLocaleString('vi-VN'),
    'Loại': e.type === 'receipt' ? 'Thu' : 'Chi',
    'Quỹ': e.fund_type === 'cash' ? 'Tiền mặt' : 'Ngân hàng',
    'Hạng mục': CATEGORY_LABEL[e.category] || e.category,
    'Đối tác': e.partner_name || '',
    'Tham chiếu': e.reference_order_code || '',
    'Số tiền': e.type === 'receipt' ? e.amount : -e.amount,
    'Ghi chú': e.note,
  });

  const handleExportExcel = () => {
    if (filteredEntries.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('so-quy-thu-chi', [{ name: 'SoQuy', rows: filteredEntries.map(entryToRow) }]);
  };

  const handlePrint = () => {
    if (filteredEntries.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Sổ quỹ thu - chi',
      meta: [`${filteredEntries.length} bút toán`, `Thu: ${formatVND(filteredReceiptTotal)}`, `Chi: ${formatVND(filteredExpenseTotal)}`],
      columns: [
        { header: 'Mã phiếu' },
        { header: 'Đối tác' },
        { header: 'Hạng mục' },
        { header: 'Thu', align: 'right' },
        { header: 'Chi', align: 'right' },
      ],
      rows: filteredEntries.slice(0, 1000).map((e) => [
        e.code,
        e.partner_name || '',
        CATEGORY_LABEL[e.category] || e.category,
        e.type === 'receipt' ? e.amount.toLocaleString('vi-VN') : '',
        e.type === 'expense' ? e.amount.toLocaleString('vi-VN') : '',
      ]),
      footer: ['Tổng', '', '', filteredReceiptTotal.toLocaleString('vi-VN'), filteredExpenseTotal.toLocaleString('vi-VN')],
    });
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;

    // Tạm ứng lương: bắt buộc chọn nhân viên để link vào bảng lương
    if (isAdvanceVoucher) {
      if (!isManager) {
        notify('Chỉ Admin/Quản lý được ghi tạm ứng lương!', 'error');
        return;
      }
      if (!advanceEmpId) {
        notify('Chọn nhân viên nhận tạm ứng để đưa vào bảng lương!', 'error');
        return;
      }
      const ok = await addAdvanceVoucher({
        employee_id: advanceEmpId,
        amount,
        fund_type: fundType,
        note: note || undefined,
      });
      if (!ok) return;
      setIsModalOpen(false);
      setPartnerName('');
      setNote('');
      setAdvanceEmpId('');
      notify('Đã ghi tạm ứng — tự trừ vào bảng lương tháng này.', 'success');
      return;
    }

    const ok = await addCashbookEntry({
      type: voucherType,
      fund_type: fundType,
      category,
      amount,
      partner_name: partnerName || undefined,
      note,
    });
    if (!ok) return;

    setIsModalOpen(false);
    setPartnerName('');
    setNote('');
      notify(`Đã lập ${voucherType === 'receipt' ? 'Phiếu thu' : 'Phiếu chi'} thành công!`, 'success');
  };

  return (
    <div id="cashbook-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      {/* Header */}
      <PageHeader
        icon={<Wallet className="w-5 h-5 text-blue-600" />}
        title="Sổ Quỹ Thu - Chi"
        count={`${cashbook.length} bút toán`}
        actions={
          <>
            <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
            <AppButton
              tone="emerald"
              onClick={() => {
                setVoucherType('receipt');
                setIsModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              <span>Lập Phiếu Thu (PT)</span>
            </AppButton>
            <AppButton
              tone="rose"
              onClick={() => {
                setVoucherType('expense');
                setIsModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              <span>Lập Phiếu Chi (PC)</span>
            </AppButton>
          </>
        }
      />

      {/* Overview Metric Cards — thẻ tổng hợp nằm thẳng trên nền trang (đồng bộ Reports).
          px-4 pt-4 (không pb) để khoảng cách giữa 2 khối = khoảng cách cạnh bên. */}
      <div className="px-4 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-blue-50/80 p-3.5 rounded-xl border border-blue-200">
          <div className="flex items-center justify-between text-xs text-blue-800 font-semibold mb-1">
            <span>TỔNG SỐ DƯ TỒN QUỸ:</span>
            <Wallet className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-extrabold text-blue-900 font-mono">
            {formatVND(totalBalance)}
          </div>
          <div className="text-[10px] text-blue-600 mt-1">Toàn bộ tiền mặt + ngân hàng</div>
        </div>

        <div className="bg-amber-50/80 p-3.5 rounded-xl border border-amber-200">
          <div className="flex items-center justify-between text-xs text-amber-900 font-semibold mb-1">
            <span>QUỸ TIỀN MẶT (KÉT QUẦY):</span>
            <Banknote className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-xl font-extrabold text-amber-900 font-mono">
            {formatVND(cashBalance)}
          </div>
          <div className="text-[10px] text-amber-700 mt-1">Khớp kiểm đếm ca F12</div>
        </div>

        <div className="bg-emerald-50/80 p-3.5 rounded-xl border border-emerald-200">
          <div className="flex items-center justify-between text-xs text-emerald-900 font-semibold mb-1">
            <span>QUỸ NGÂN HÀNG (VIETQR/MB):</span>
            <QrCode className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-extrabold text-emerald-900 font-mono">
            {formatVND(bankBalance)}
          </div>
          <div className="text-[10px] text-emerald-700 mt-1">Tài khoản thanh toán số</div>
        </div>
      </div>

      {/* Filter & Entries Table */}
      <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
        <DataTableShell>
        {/* Filters */}
        <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <SearchInput
            value={search}
            onChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            placeholder="Tìm theo Mã phiếu PT/PC, đối tác, nội dung..."
            minWidthClass="min-w-[200px]"
          />

          <div className="flex flex-wrap items-center gap-2">
            {/* Date Filter */}
            <DateFilter
              value={dateFilter}
              onChange={(val) => {
                setDateFilter(val);
                setPage(1);
              }}
            />

            <FilterSelect
              value={fundFilter}
              onChange={(val) => {
                setFundFilter(val as any);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả quỹ' },
                { value: 'cash', label: 'Tiền mặt' },
                { value: 'bank', label: 'Ngân hàng' },
              ]}
            />

            <FilterSelect
              value={typeFilter}
              onChange={(val) => {
                setTypeFilter(val as any);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'Thu & Chi' },
                { value: 'receipt', label: 'Phiếu Thu (+)' },
                { value: 'expense', label: 'Phiếu Chi (-)' },
              ]}
            />

            <FilterSelect
              value={categoryFilter}
              onChange={(val) => {
                setCategoryFilter(val);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả danh mục' },
                { value: 'sales', label: 'Thu tiền bán hàng' },
                { value: 'deposit', label: 'Thu đặt cọc' },
                { value: 'debt_collection', label: 'Thu nợ khách' },
                { value: 'supplier_payment', label: 'Chi trả NCC' },
                { value: 'labor', label: 'Chi lương' },
                { value: 'advance', label: 'Tạm ứng lương' },
                { value: 'other', label: 'Thu/Chi khác' },
              ]}
            />
          </div>
        </div>

        {/* Filtered Metrics Strip */}
        <SummaryStrip className="flex-wrap gap-2">
          <span>
            Tìm thấy <strong className="text-slate-900 font-mono">{filteredEntries.length}</strong> bút toán
          </span>
          <div className="flex items-center gap-4">
            <span>
              Tổng thu:{' '}
              <strong className="font-mono text-emerald-700 font-bold">+{formatVND(filteredReceiptTotal)}</strong>
            </span>
            <span>
              Tổng chi:{' '}
              <strong className="font-mono text-rose-700 font-bold">-{formatVND(filteredExpenseTotal)}</strong>
            </span>
            <span>
              Thu ròng:{' '}
              <strong
                className={`font-mono font-bold ${
                  filteredNet >= 0 ? 'text-blue-700' : 'text-rose-700'
                }`}
              >
                {filteredNet >= 0 ? '+' : ''}{formatVND(filteredNet)}
              </strong>
            </span>
          </div>
        </SummaryStrip>

        {/* Cashbook Table */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <SortableTh className="py-2.5 px-3" label="Mã chứng từ" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Thời gian" sortKey="created_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Loại quỹ" sortKey="fund_type" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Phân loại" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Người nộp / nhận" sortKey="partner_name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Nội dung ghi chú" sortKey="note" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-right" label="Số tiền (đ)" sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedEntries.length === 0 ? (
                <TableEmpty colSpan={7}>Không tìm thấy chứng từ thu chi nào phù hợp với bộ lọc.</TableEmpty>
              ) : (
                paginatedEntries.map((e) => {
                  const isReceipt = e.type === 'receipt';
                  return (
                    <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {e.code}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                        {new Date(e.created_at).toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge tone={e.fund_type === 'cash' ? 'amber' : 'emerald'} pill={false}>
                          {e.fund_type === 'cash' ? 'Tiền mặt' : 'VietQR / Bank'}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-medium">
                        {e.category === 'sales'
                          ? 'Thu tiền bán hàng'
                          : e.category === 'deposit'
                          ? 'Thu tiền đặt cọc'
                          : e.category === 'debt_collection'
                          ? 'Thu nợ khách'
                          : e.category === 'supplier_payment'
                          ? 'Chi trả NCC'
                          : e.category === 'labor'
                          ? 'Chi lương'
                          : e.category === 'advance'
                          ? 'Tạm ứng lương'
                          : e.category === 'material'
                          ? 'Mua vật tư'
                          : 'Thu/Chi khác'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {e.partner_name || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                        {e.note}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-sm">
                        <span className={isReceipt ? 'text-emerald-700' : 'text-rose-700'}>
                          {isReceipt ? '+' : '-'}{formatVND(e.amount)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <PaginationBar
          currentPage={page}
          totalItems={filteredEntries.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemName="bút toán sổ quỹ"
        />
        </DataTableShell>
      </div>

      {/* New Voucher Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleCreateVoucher}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div
              className={`px-4 py-3 text-white flex items-center justify-between ${
                voucherType === 'receipt' ? 'bg-emerald-700' : 'bg-rose-700'
              }`}
            >
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                {voucherType === 'receipt' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                {voucherType === 'receipt' ? 'Lập Phiếu Thu Tiền (PT)' : 'Lập Phiếu Chi Tiền (PC)'}
              </h3>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Loại quỹ</label>
                  <select
                    value={fundType}
                    onChange={(e) => setFundType(e.target.value as any)}
                    className="w-full h-8 px-2 border border-slate-300 rounded"
                  >
                    <option value="cash">Tiền mặt tại két</option>
                    <option value="bank">Tài khoản Ngân hàng</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Hạng mục</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full h-8 px-2 border border-slate-300 rounded"
                  >
                    {voucherType === 'receipt' ? (
                      <>
                        <option value="sales">Doanh thu bán lẻ</option>
                        <option value="deposit">Tiền cọc đơn hàng</option>
                        <option value="debt_collection">Thu hồi công nợ</option>
                        <option value="other">Thu nhập khác</option>
                      </>
                    ) : (
                      <>
                        <option value="supplier_payment">Thanh toán nhà cung cấp</option>
                        <option value="material">Mua vật tư gấp</option>
                        <option value="labor">Chi lương</option>
                        <option value="advance">Tạm ứng lương (khấu trừ bảng lương)</option>
                        <option value="other">Chi phí vận hành / khác</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Số tiền (đ) *</label>
                <NumberInput
                  required
                  min={1}
                  value={amount}
                  onChange={(val) => setAmount(val)}
                  placeholder="0"
                  className="w-full h-9 px-3 border border-slate-300 rounded font-mono font-bold text-base text-blue-700 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Người nộp / nhận tiền</label>
                {isAdvanceVoucher ? (
                  <>
                    <select
                      value={advanceEmpId}
                      onChange={(e) => setAdvanceEmpId(e.target.value)}
                      className="w-full h-8 px-2 border border-slate-300 rounded bg-white"
                    >
                      <option value="">— Chọn nhân viên nhận ứng * —</option>
                      {activeEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.code} — {emp.full_name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-amber-700 mt-1">Tạm ứng khấu trừ vào lương tháng hiện tại, tự hiện trong bảng lương.</p>
                  </>
                ) : (
                  <input
                    type="text"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    placeholder="Họ tên đối tác..."
                    className="w-full h-8 px-2.5 border border-slate-300 rounded"
                  />
                )}
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nội dung ghi chú</label>
                <textarea
                  required
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Lý do thu / chi tiền chi tiết..."
                  rows={2}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                className={`px-4 py-1.5 text-white rounded text-xs font-bold shadow-xs ${
                  voucherType === 'receipt' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                Lưu phiếu
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
