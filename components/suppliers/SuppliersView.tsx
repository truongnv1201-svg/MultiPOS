'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { toast } from '@/lib/notify';
import { Supplier } from '@/lib/types';
import type { StockMovement } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Truck,
  Plus,
  Search,
  Phone,
  Building2,
  DollarSign,
  AlertCircle,
  FileText,
  CreditCard,
  CheckCircle2,
  X,
  History,
} from 'lucide-react';
import { NumberInput } from '@/components/common/NumberInput';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, downloadExcelTemplate, readExcelFile, parseExcelNum, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';

export function SuppliersView() {
  const { suppliers, addSupplier, updateSupplier, paySupplierDebt, stockMovements, cashbook } = useStore();

  const [search, setSearch] = useState('');
  const [debtFilter, setDebtFilter] = useState<'all' | 'debt' | 'clean'>('all');
  const [activeTab, setActiveTab] = useState<'list' | 'history'>('list');
  // Sắp xếp 2 bảng: bấm header để đảo chiều
  const { sortKey: supSortKey, sortDir: supSortDir, toggleSort: toggleSupSort } = useSortState();
  const { sortKey: impSortKey, sortDir: impSortDir, toggleSort: toggleImpSort } = useSortState();

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer'>('transfer');
  const [payNote, setPayNote] = useState('');

  // New Supplier Form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [category, setCategory] = useState('Kính & Gương nguyên khổ');
  const [initialDebt, setInitialDebt] = useState(0);
  const [importing, setImporting] = useState(false);

  const filteredSuppliers = suppliers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.phone.includes(search);
    const matchesDebt =
      debtFilter === 'all'
        ? true
        : debtFilter === 'debt'
        ? s.current_debt > 0
        : s.current_debt === 0;
    return matchesSearch && matchesDebt;
  });

  const totalDebt = suppliers.reduce((sum, s) => sum + s.current_debt, 0);

  // ---- Xuất / Nhập / In Excel ----
  const supplierToRow = (s: Supplier): Record<string, unknown> => ({
    'Mã NCC': s.code,
    'Tên NCC *': s.name,
    'SĐT': s.phone,
    'Địa chỉ': s.address || '',
    'Mã số thuế': s.tax_code || '',
    'Hạn mức công nợ': s.credit_limit ?? '',
    'Đang nợ': s.current_debt,
  });

  const handleExportExcel = () => {
    if (sortedSuppliers.length === 0) {
      toast('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('nha-cung-cap', [{ name: 'NhaCungCap', rows: sortedSuppliers.map(supplierToRow) }]);
  };

  const handlePrint = () => {
    if (sortedSuppliers.length === 0) {
      toast('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Danh sách nhà cung cấp',
      meta: [`${sortedSuppliers.length} NCC`, `Tổng nợ phải trả: ${formatVND(totalDebt)}`],
      columns: [
        { header: 'Mã NCC' },
        { header: 'Tên NCC' },
        { header: 'SĐT' },
        { header: 'Mã số thuế' },
        { header: 'Đang nợ', align: 'right' },
      ],
      rows: sortedSuppliers.slice(0, 1000).map((s) => [s.code, s.name, s.phone, s.tax_code || '', s.current_debt.toLocaleString('vi-VN')]),
      footer: ['Tổng', '', '', '', totalDebt.toLocaleString('vi-VN')],
    });
  };

  const handleDownloadTemplate = () => {
    downloadExcelTemplate('nha-cung-cap', ['Tên NCC *', 'SĐT', 'Địa chỉ', 'Mã số thuế', 'Hạn mức công nợ'], {
      'Tên NCC *': 'Kính Hải Long',
      'SĐT': '0909876543',
      'Địa chỉ': 'KCN Tân Tạo, Bình Tân',
      'Mã số thuế': '0312345678',
      'Hạn mức công nợ': 50000000,
    });
  };

  const handleImportExcel = async (file: File) => {
    setImporting(true);
    try {
      const { rows } = await readExcelFile(file);
      if (rows.length === 0) {
        toast('File không có dữ liệu!', 'error');
        return;
      }
      let created = 0;
      let updated = 0;
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const lineNo = i + 2;
        try {
          const name = (r['Tên NCC *'] || r['Tên NCC'] || '').trim();
          if (!name) throw new Error('thiếu Tên NCC');
          const phone = (r['SĐT'] || '').trim();
          const payload = {
            name,
            phone,
            address: (r['Địa chỉ'] || '').trim() || undefined,
            tax_code: (r['Mã số thuế'] || '').trim() || undefined,
            credit_limit: r['Hạn mức công nợ'] !== '' ? Math.max(0, Math.round(parseExcelNum(r['Hạn mức công nợ']))) : undefined,
          };
          const existing =
            (phone && suppliers.find((s) => s.phone === phone)) ||
            suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase());
          if (existing) {
            await updateSupplier(existing.id, payload);
            updated++;
          } else {
            await addSupplier({ ...payload, current_debt: 0 });
            created++;
          }
        } catch (err: any) {
          errors.push(`Dòng ${lineNo}: ${err?.message || 'lỗi không rõ'}`);
          if (errors.length >= 10) {
            errors.push('… (chỉ hiện 10 lỗi đầu)');
            break;
          }
        }
      }
      toast(`Nhập xong: ${created} tạo mới, ${updated} cập nhật${errors.length > 0 ? `\nLỗi:\n${errors.join('\n')}` : ''}`, errors.length > 0 ? 'error' : 'success');
    } catch (err: any) {
      toast(`Đọc file thất bại: ${err?.message || err}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const sortedSuppliers = (() => {
    if (!supSortKey) return filteredSuppliers;
    const getters: Record<string, (s: Supplier) => unknown> = {
      code: (s) => s.code,
      name: (s) => s.name,
      phone: (s) => s.phone,
      address: (s) => s.address,
      tax_code: (s) => s.tax_code,
      current_debt: (s) => s.current_debt,
    };
    const get = getters[supSortKey];
    if (!get) return filteredSuppliers;
    return sortRows(filteredSuppliers, get, supSortDir);
  })();

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    await addSupplier({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      tax_code: taxCode.trim() || undefined,
      current_debt: initialDebt,
      credit_limit: 100000000,
    });

    setIsAddModalOpen(false);
    setName('');
    setPhone('');
    setAddress('');
    setTaxCode('');
    setInitialDebt(0);
  };

  const handleExecutePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingSupplier || payAmount <= 0) return;

    const success = await paySupplierDebt(
      payingSupplier.id,
      payAmount,
      payMethod,
      payNote || `Thanh toán công nợ vật tư cho ${payingSupplier.name}`
    );

    if (success) {
      setPayingSupplier(null);
      setPayAmount(0);
      setPayNote('');
    }
  };

  const importMovements = stockMovements.filter((m) => m.movement_type === 'import');

  const sortedImports = (() => {
    if (!impSortKey) return importMovements;
    const getters: Record<string, (m: StockMovement) => unknown> = {
      created_at: (m) => m.created_at,
      reference_code: (m) => m.reference_code,
      product_name: (m) => m.product_name,
      quantity: (m) => m.quantity,
      previous_stock: (m) => m.previous_stock,
      new_stock: (m) => m.new_stock,
      note: (m) => m.note,
    };
    const get = getters[impSortKey];
    if (!get) return importMovements;
    return sortRows(importMovements, get, impSortDir);
  })();

  // ---- Xuất Excel / In lịch sử nhập kho ----
  const handleExportImports = () => {
    if (sortedImports.length === 0) {
      toast('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('lich-su-nhap-kho', [
      {
        name: 'LichSuNhap',
        rows: sortedImports.map((m) => ({
          'Thời gian': new Date(m.created_at).toLocaleString('vi-VN'),
          'Mã phiếu nhập': m.reference_code,
          'Hàng hóa vật tư': m.product_name,
          'Số lượng': m.quantity,
          'Tồn trước': m.previous_stock,
          'Tồn sau': m.new_stock,
          'Ghi chú & đối tác': m.note,
        })),
      },
    ]);
  };

  const handlePrintImports = () => {
    if (sortedImports.length === 0) {
      toast('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Lịch sử nhập kho',
      meta: [`${sortedImports.length} phiếu nhập`],
      columns: [
        { header: 'Thời gian' },
        { header: 'Mã phiếu' },
        { header: 'Hàng hóa vật tư' },
        { header: 'Số lượng', align: 'right' },
        { header: 'Tồn trước', align: 'right' },
        { header: 'Tồn sau', align: 'right' },
        { header: 'Ghi chú' },
      ],
      rows: sortedImports.slice(0, 1000).map((m) => [
        new Date(m.created_at).toLocaleString('vi-VN'),
        m.reference_code,
        m.product_name,
        String(m.quantity),
        String(m.previous_stock),
        String(m.new_stock),
        m.note,
      ]),
    });
  };

  return (
    <div id="suppliers-view" className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              Nhà Cung Cấp & Công Nợ Mua Hàng
            </h2>
            <p className="text-[11px] text-slate-500">
              Quản lý đối tác cung ứng vật tư nhôm, kính, phụ kiện và thanh toán công nợ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-xs">
            <span className="text-rose-700 font-medium">Tổng nợ phải trả:</span>
            <span className="font-bold font-mono tnum text-rose-700">{formatVND(totalDebt)}</span>
          </div>

          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Chuyển danh sách / lịch sử nhập"
            options={[
              { value: 'list', label: `Danh sách (${suppliers.length})` },
              { value: 'history', label: `Lịch sử nhập (${importMovements.length})` },
            ]}
          />

          <Button
            id="btn-add-supplier"
            onClick={() => setIsAddModalOpen(true)}
            variant="primary"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm NCC mới</span>
          </Button>
          {activeTab === 'list' ? (
            <TableTools
              onExportExcel={handleExportExcel}
              onPrint={handlePrint}
              onImportExcel={handleImportExcel}
              onDownloadTemplate={handleDownloadTemplate}
              importing={importing}
            />
          ) : (
            <TableTools onExportExcel={handleExportImports} onPrint={handlePrintImports} />
          )}
        </div>
      </div>

      {activeTab === 'list' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {/* Filter Bar — gộp chung khối với bảng (chuẩn mọi trang) */}
            <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm theo Tên NCC, Mã, Số điện thoại..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <SegmentedControl
                variant="pills"
                value={debtFilter}
                onChange={setDebtFilter}
                ariaLabel="Lọc công nợ"
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'debt', label: 'Đang còn nợ' },
                  { value: 'clean', label: 'Hết nợ' },
                ]}
              />
            </div>

            {/* Suppliers Table */}
            <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold sticky top-0 z-10">
                    <SortableTh className="py-2.5 px-3" label="Mã NCC" sortKey="code" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <SortableTh className="py-2.5 px-3" label="Tên Nhà Cung Cấp" sortKey="name" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <SortableTh className="py-2.5 px-3" label="Số Điện Thoại" sortKey="phone" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <SortableTh className="py-2.5 px-3" label="Địa Chỉ" sortKey="address" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <SortableTh className="py-2.5 px-3" label="Mã Số Thuế" sortKey="tax_code" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <SortableTh className="py-2.5 px-3 text-right" label="Dư Nợ Phải Trả" sortKey="current_debt" activeKey={supSortKey} dir={supSortDir} onSort={toggleSupSort} />
                    <th className="py-2.5 px-3 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedSuppliers.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState message="Không tìm thấy nhà cung cấp nào" />
                      </td>
                    </tr>
                  ) : (
                    sortedSuppliers.map((sup) => (
                      <tr key={sup.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-700">{sup.code}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{sup.name}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{sup.phone || '-'}</td>
                        <td className="py-2.5 px-3 text-slate-600 truncate max-w-[200px]">
                          {sup.address || '-'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{sup.tax_code || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold tnum">
                          {sup.current_debt > 0 ? (
                            <Badge tone="rose">
                              {formatVND(sup.current_debt)}
                            </Badge>
                          ) : (
                            <Badge tone="emerald">0 đ</Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {sup.current_debt > 0 ? (
                            <Button
                              onClick={() => {
                                setPayingSupplier(sup);
                                setPayAmount(sup.current_debt);
                              }}
                              variant="success"
                              title="Tạo phiếu chi trả nợ NCC"
                            >
                              Trả nợ
                            </Button>
                          ) : (
                            <Badge tone="emerald">Đã thanh toán</Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-slate-600">
                <strong className="text-slate-900 tnum">{sortedImports.length}</strong> phiếu nhập kho
              </span>
            </div>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold sticky top-0 z-10">
                  <SortableTh className="py-2.5 px-3" label="Thời Gian" sortKey="created_at" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3" label="Mã Phiếu Nhập" sortKey="reference_code" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3" label="Hàng Hóa Vật Tư" sortKey="product_name" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Số Lượng" sortKey="quantity" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tồn Trước" sortKey="previous_stock" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tồn Sau" sortKey="new_stock" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  <SortableTh className="py-2.5 px-3" label="Ghi Chú & Đối Tác" sortKey="note" activeKey={impSortKey} dir={impSortDir} onSort={toggleImpSort} />
                  </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedImports.length === 0 ? (
                  <tr>
                      <td colSpan={7}>
                        <EmptyState message="Chưa có lịch sử nhập kho nào" />
                      </td>
                  </tr>
                ) : (
                  sortedImports.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-slate-500 font-mono">
                        {new Date(m.created_at).toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-blue-600">{m.reference_code}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">{m.product_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                        +{formatNumber(m.quantity)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {formatNumber(m.previous_stock)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                        {formatNumber(m.new_stock)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{m.note}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Add Supplier */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-400" />
                Thêm Nhà Cung Cấp Mới
              </span>
              <Button
                onClick={() => setIsAddModalOpen(false)}
                variant="ghost-light"
                size="icon"
                aria-label="Đóng"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateSupplier} className="p-4 space-y-3">
              <Field label="Tên Nhà Cung Cấp / Công Ty" required>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Công ty TNHH Nhôm Kính Xingfa Hải Phòng"
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Số điện thoại">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </Field>
                <Field label="Mã số thuế">
                  <input
                    type="text"
                    value={taxCode}
                    onChange={(e) => setTaxCode(e.target.value)}
                    placeholder="010..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </Field>
              </div>

              <Field label="Địa chỉ kho / trụ sở">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Khu công nghiệp, Đường..."
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </Field>

              <Field label="Dư nợ ban đầu (nếu có)">
                <NumberInput
                  min={0}
                  value={initialDebt}
                  onChange={(val) => setInitialDebt(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 text-xs font-mono border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </Field>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  variant="ghost"
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                >
                  Lưu nhà cung cấp
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Pay Supplier Debt */}
      {payingSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-400" />
                Phiếu Chi Trả Nợ Nhà Cung Cấp
              </span>
              <Button
                onClick={() => setPayingSupplier(null)}
                variant="ghost"
                size="icon"
                aria-label="Đóng"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleExecutePayment} className="p-4 space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-800">{payingSupplier.name}</div>
                <div className="flex justify-between items-center text-xs mt-1">
                  <span className="text-slate-500">Mã NCC: {payingSupplier.code}</span>
                  <span className="text-rose-600 font-bold font-mono tnum">
                    Đang nợ: {formatVND(payingSupplier.current_debt)}
                  </span>
                </div>
              </div>

              <Field label="Số tiền chi trả (VNĐ)" required>
                <NumberInput
                  required
                  min={1000}
                  max={payingSupplier.current_debt}
                  value={payAmount}
                  onChange={(val) => setPayAmount(val)}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm font-bold font-mono text-emerald-700 border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </Field>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Phương thức thanh toán (Hạch toán quỹ)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => setPayMethod('transfer')}
                    variant={payMethod === 'transfer' ? 'outline-info' : 'secondary'}
                    className="flex-1"
                  >
                    Tài khoản ngân hàng
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setPayMethod('cash')}
                    variant={payMethod === 'cash' ? 'outline-info' : 'secondary'}
                    className="flex-1"
                  >
                    Tiền mặt tại két
                  </Button>
                </div>
              </div>

              <Field label="Ghi chú phiếu chi">
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="VD: Trả tiền lô kính cường lực tuần trước..."
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </Field>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  onClick={() => setPayingSupplier(null)}
                  variant="ghost"
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  variant="success"
                  size="md"
                >
                  Xác nhận chi {formatVND(payAmount)}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
