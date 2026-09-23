'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Supplier } from '@/lib/types';
import type { StockMovement } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Truck,
  Plus,
  Search,
  Phone,
  Building2,
  MapPin,
  DollarSign,
  AlertCircle,
  FileText,
  CreditCard,
  CheckCircle2,
  X,
  History,
  Edit2,
  Trash2,
} from 'lucide-react';
import { NumberInput } from '@/components/common/NumberInput';
import { TableTools } from '@/components/common/TableTools';
import { DataTableShell } from '@/components/common/DataTableShell';
import { PaginationBar } from '@/components/common/PaginationBar';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { exportToExcel, downloadExcelTemplate, readExcelFile, parseExcelNum, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';

export function SuppliersView() {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier, paySupplierDebt, stockMovements, cashbook } = useStore();

  const [search, setSearch] = useState('');
  const [debtFilter, setDebtFilter] = useState<'all' | 'debt' | 'clean'>('all');
  const [activeTab, setActiveTab] = useState<'list' | 'history'>('list');
  // Phân trang 2 bảng (chuẩn Don hàng / Khách hàng)
  const [supPage, setSupPage] = useState(1);
  const [supPageSize, setSupPageSize] = useState(25);
  const [impPage, setImpPage] = useState(1);
  const [impPageSize, setImpPageSize] = useState(25);
  // Tìm kiếm + lọc ngày cho tab lịch sử nhập (chuẩn các bảng khác)
  const [impSearch, setImpSearch] = useState('');
  const [impDate, setImpDate] = useState<DateFilterState>({ preset: 'all' });
  // Sắp xếp 2 bảng: bấm header để đảo chiều
  const { sortKey: supSortKey, sortDir: supSortDir, toggleSort: toggleSupSort } = useSortState();
  const { sortKey: impSortKey, sortDir: impSortDir, toggleSort: toggleImpSort } = useSortState();

  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(suppliers[0] || null);
  const liveSelectedSupplier = suppliers.find((s) => s.id === selectedSupplier?.id) || selectedSupplier || suppliers[0] || null;

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
  const [category, setCategory] = useState('K�nh & Guong nguy�n kh?');
  const [initialDebt, setInitialDebt] = useState(0);
  const [importing, setImporting] = useState(false);
  // Edit supplier modal
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editTaxCode, setEditTaxCode] = useState('');

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setEditName(s.name);
    setEditPhone(s.phone || '');
    setEditAddress(s.address || '');
    setEditTaxCode(s.tax_code || '');
  };

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier || !editName.trim()) return;
    try {
      await updateSupplier(editingSupplier.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        address: editAddress.trim(),
        tax_code: editTaxCode.trim() || undefined,
      });
      if (payingSupplier?.id === editingSupplier.id) {
        setPayingSupplier({ ...payingSupplier, name: editName.trim() });
      }
      setEditingSupplier(null);
      notify('Đã lưu thay đổi nhà cung cấp!', 'success');
    } catch (err: any) {
      notify(`Không lưu được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

  const handleDeleteSupplier = async (s: Supplier) => {
    if (s.current_debt > 0) {
      alert(`Không thể xóa "${s.name}" vì còn nợ ${formatVND(s.current_debt)}. Hãy trả hết nợ trước khi xóa.`);
      return;
    }
    const ok = await confirmDialog(`Xóa vĩnh viễn "${s.name}" khỏi danh sách?\nThao tác đồng bộ lên server và không thể hoàn tác.`, {
      title: 'Xóa nhà cung cấp',
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSupplier(s.id);
      if (payingSupplier?.id === s.id) setPayingSupplier(null);
      if (selectedSupplier?.id === s.id) setSelectedSupplier(null);
      notify('Đã xóa nhà cung cấp!', 'success');
    } catch (err: any) {
      notify(`Không xóa được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

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
  const totalFilteredDebt = filteredSuppliers.reduce((sum, s) => sum + s.current_debt, 0);

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
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('nha-cung-cap', [{ name: 'NhaCungCap', rows: sortedSuppliers.map(supplierToRow) }]);
  };

  const handlePrint = () => {
    if (sortedSuppliers.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
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
        notify('File không có dữ liệu!', 'error');
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
      alert(`Nhập xong: ${created} tạo mới, ${updated} cập nhật${errors.length > 0 ? `\nLỗi:\n${errors.join('\n')}` : ''}`);
    } catch (err: any) {
      notify(`Đọc file thất bại: ${err?.message || err}`, 'error');
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

  const paginatedSuppliers = sortedSuppliers.slice((supPage - 1) * supPageSize, supPage * supPageSize);

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

  const filteredImports = importMovements.filter((m) => {
    const q = impSearch.toLowerCase().trim();
    const matchesSearch =
      !q ||
      m.reference_code.toLowerCase().includes(q) ||
      m.product_name.toLowerCase().includes(q) ||
      (m.note || '').toLowerCase().includes(q);
    return matchesSearch && matchesDateFilter(m.created_at, impDate);
  });

  const sortedImports = (() => {
    if (!impSortKey) return filteredImports;
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
    if (!get) return filteredImports;
    return sortRows(filteredImports, get, impSortDir);
  })();

  const paginatedImports = sortedImports.slice((impPage - 1) * impPageSize, impPage * impPageSize);

  // ---- Xuất Excel / In lịch sử nhập kho ----
  const handleExportImports = () => {
    if (sortedImports.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
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
      notify('Không có dữ liệu để in!', 'error');
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
    <div id="suppliers-view" className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 overflow-hidden">
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
            <span className="font-bold font-mono text-rose-700">{formatVND(totalDebt)}</span>
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeTab === 'list' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Danh sách ({suppliers.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeTab === 'history' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lịch sử nhập ({importMovements.length})
            </button>
          </div>

          <button
            id="btn-add-supplier"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm NCC mới</span>
          </button>
          {activeTab === 'list' && (
            <TableTools
              onExportExcel={handleExportExcel}
              onPrint={handlePrint}
              onImportExcel={handleImportExcel}
              onDownloadTemplate={handleDownloadTemplate}
              importing={importing}
            />
          )}
          {activeTab === 'history' && (
            <TableTools onExportExcel={handleExportImports} onPrint={handlePrintImports} />
          )}
        </div>
      </div>

      {activeTab === 'list' && (
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left: Table Section */}
          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            <DataTableShell>
              {/* Filter Bar — cùng khối với bảng (chuẩn Đơn hàng / Khách hàng) */}
              <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSupPage(1);
                    }}
                    placeholder="Tìm theo Tên NCC, Mã, Số điện thoại..."
                    className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <select
                  value={debtFilter}
                  onChange={(e) => {
                    setDebtFilter(e.target.value as 'all' | 'debt' | 'clean');
                    setSupPage(1);
                  }}
                  className="h-8 px-2 text-xs bg-white border border-slate-300 rounded-md text-slate-700 font-medium"
                >
                  <option value="all">Tất cả công nợ</option>
                  <option value="debt">Đang còn nợ (&gt; 0)</option>
                  <option value="clean">Hết nợ (= 0)</option>
                </select>
              </div>

              {/* Metric strip */}
              <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span>
                  Tìm thấy <strong className="text-slate-900 font-mono">{filteredSuppliers.length}</strong> nhà cung cấp
                </span>
                <span>
                  Tổng nợ nhóm này:{' '}
                  <strong className="font-mono text-rose-600 font-bold">{formatVND(totalFilteredDebt)}</strong>
                </span>
              </div>

              {/* Suppliers Table */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
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
                    {paginatedSuppliers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          Không tìm thấy nhà cung cấp nào phù hợp với bộ lọc.
                        </td>
                      </tr>
                    ) : (
                      paginatedSuppliers.map((sup) => (
                        <tr
                          key={sup.id}
                          onClick={() => setSelectedSupplier(sup)}
                          className={`cursor-pointer transition-colors ${
                            liveSelectedSupplier?.id === sup.id ? 'bg-blue-50/80 font-medium' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{sup.code}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">{sup.name}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{sup.phone || '-'}</td>
                          <td className="py-2.5 px-3 text-slate-600 truncate max-w-[200px]">
                            {sup.address || '-'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">{sup.tax_code || '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {sup.current_debt > 0 ? (
                              <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                                {formatVND(sup.current_debt)}
                              </span>
                            ) : (
                              <span className="text-slate-700">0 đ</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <div className="flex min-h-7 items-center justify-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditSupplier(sup);
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-blue-600 transition-colors hover:bg-blue-50"
                                title="Sửa thông tin nhà cung cấp"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSupplier(sup);
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-600 transition-colors hover:bg-rose-50"
                                title="Xóa nhà cung cấp"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <PaginationBar
                currentPage={supPage}
                totalItems={filteredSuppliers.length}
                pageSize={supPageSize}
                onPageChange={setSupPage}
                onPageSizeChange={(s) => {
                  setSupPageSize(s);
                  setSupPage(1);
                }}
                itemName="nhà cung cấp"
              />
            </DataTableShell>
          </div>

          {/* Right: Selected Supplier Card */}
          {liveSelectedSupplier ? (
            <div className="w-full md:w-96 bg-slate-100 flex flex-col min-h-0 p-4 pl-0">
              <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs p-3 flex flex-col overflow-y-auto">
                <div className="space-y-4 text-xs">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="font-mono text-[10px] font-bold text-blue-700">
                        {liveSelectedSupplier.code}
                      </span>
                      {liveSelectedSupplier.tax_code && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 font-mono">
                          MST: {liveSelectedSupplier.tax_code}
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-sm text-slate-900">{liveSelectedSupplier.name}</h3>

                    <div className="space-y-1 text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{liveSelectedSupplier.phone || 'Chưa cập nhật SĐT'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{liveSelectedSupplier.address || 'Chưa cập nhật địa chỉ'}</span>
                      </div>
                    </div>

                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-1">
                      <div className="text-[11px] text-rose-700 font-medium">NỢ PHẢI TRẢ HIỆN TẠI:</div>
                      <div className="text-xl font-extrabold text-rose-600 font-mono">
                        {formatVND(liveSelectedSupplier.current_debt)}
                      </div>
                      {liveSelectedSupplier.credit_limit !== undefined && liveSelectedSupplier.credit_limit > 0 && (
                        <div className="text-[10px] text-slate-500">
                          Hạn mức công nợ: {formatVND(liveSelectedSupplier.credit_limit)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Debt payment quick trigger */}
                  {liveSelectedSupplier.current_debt > 0 ? (
                    <button
                      onClick={() => {
                        setPayingSupplier(liveSelectedSupplier);
                        setPayAmount(liveSelectedSupplier.current_debt);
                      }}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>Lập Phiếu Trả Nợ Nhà Cung Cấp (PC)</span>
                    </button>
                  ) : (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-center font-medium flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Nhà cung cấp không còn dư nợ!</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-96 m-4 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 text-xs">
              Chọn nhà cung cấp để xem chi tiết
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 p-4 overflow-hidden min-h-0">
          <DataTableShell>
            {/* Filter Bar — tìm theo mã phiếu / tên hàng / ghi chú + lọc ngày */}
            <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={impSearch}
                  onChange={(e) => {
                    setImpSearch(e.target.value);
                    setImpPage(1);
                  }}
                  placeholder="Tìm theo mã phiếu, tên hàng, ghi chú..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>
              <DateFilter
                value={impDate}
                onChange={(v) => {
                  setImpDate(v);
                  setImpPage(1);
                }}
              />
            </div>
            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>
                Tìm thấy <strong className="text-slate-900 font-mono">{filteredImports.length}</strong> / {importMovements.length} phiếu nhập kho
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
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
                  {paginatedImports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        Chưa có lịch sử nhập kho nào
                      </td>
                    </tr>
                  ) : (
                    paginatedImports.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 text-slate-500 font-mono">
                          {new Date(m.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{m.reference_code}</td>
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
            <PaginationBar
              currentPage={impPage}
              totalItems={sortedImports.length}
              pageSize={impPageSize}
              onPageChange={setImpPage}
              onPageSizeChange={(s) => {
                setImpPageSize(s);
                setImpPage(1);
              }}
              itemName="phiếu nhập"
            />
          </DataTableShell>
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
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Tên Nhà Cung Cấp / Công Ty <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Công ty TNHH Nhôm Kính Xingfa Hải Phòng"
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Mã số thuế</label>
                  <input
                    type="text"
                    value={taxCode}
                    onChange={(e) => setTaxCode(e.target.value)}
                    placeholder="010..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Địa chỉ kho / trụ sở</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Khu công nghiệp, Đường..."
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Dư nợ ban đầu (nếu có)
                </label>
                <NumberInput
                  min={0}
                  value={initialDebt}
                  onChange={(val) => setInitialDebt(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 text-xs font-mono border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded shadow-xs"
                >
                  Lưu nhà cung cấp
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Supplier */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-amber-400" />
                Sửa Nhà Cung Cấp ({editingSupplier.code})
              </span>
              <button
                onClick={() => setEditingSupplier(null)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSupplier} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Tên Nhà Cung Cấp / Công Ty <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Mã số thuế</label>
                  <input
                    type="text"
                    value={editTaxCode}
                    onChange={(e) => setEditTaxCode(e.target.value)}
                    placeholder="010..."
                    className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Địa chỉ kho / trụ sở</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSupplier(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded shadow-xs"
                >
                  Lưu thay đổi
                </button>
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
              <button
                onClick={() => setPayingSupplier(null)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecutePayment} className="p-4 space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-800">{payingSupplier.name}</div>
                <div className="flex justify-between items-center text-xs mt-1">
                  <span className="text-slate-500">Mã NCC: {payingSupplier.code}</span>
                  <span className="text-rose-600 font-bold font-mono">
                    Đang nợ: {formatVND(payingSupplier.current_debt)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Số tiền chi trả (VNĐ) <span className="text-rose-500">*</span>
                </label>
                <NumberInput
                  required
                  min={1000}
                  max={payingSupplier.current_debt}
                  value={payAmount}
                  onChange={(val) => setPayAmount(val)}
                  placeholder="0"
                  className="w-full h-9 px-3 text-sm font-bold font-mono text-emerald-700 border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Phương thức thanh toán (Hạch toán quỹ)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('transfer')}
                    className={`py-2 px-3 text-xs font-semibold rounded border text-center transition-colors ${
                      payMethod === 'transfer'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Tài khoản ngân hàng
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('cash')}
                    className={`py-2 px-3 text-xs font-semibold rounded border text-center transition-colors ${
                      payMethod === 'cash'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Tiền mặt tại két
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Ghi chú phiếu chi</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="VD: Trả tiền lô kính cường lực tuần trước..."
                  className="w-full h-8 px-2.5 text-xs border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPayingSupplier(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs"
                >
                  Xác nhận chi {formatVND(payAmount)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
