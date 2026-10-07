'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Customer } from '@/lib/types';
import { formatVND } from '@/lib/format';
import { Users, Plus, DollarSign, History, AlertCircle, CheckCircle2, Phone, MapPin, Filter, Edit2, Trash2, X, HandCoins, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SearchInput, FilterSelect } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty, ListEmpty } from '@/components/ui/ListStates';
import { AppButton } from '@/components/ui/AppButton';
import { PaginationBar } from '@/components/common/PaginationBar';
import { NumberInput } from '@/components/common/NumberInput';
import { TableTools } from '@/components/common/TableTools';
import { SheetShell } from '@/components/common/SheetShell';
import { DataTableShell } from '@/components/common/DataTableShell';
import { exportToExcel, downloadExcelTemplate, readExcelFile, parseExcelNum, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';

export function CustomersView({ bare = false, addOpen, onAddOpenChange }: { bare?: boolean; addOpen?: boolean; onAddOpenChange?: (open: boolean) => void } = {}) {
  const { customers, orders, addCustomer, updateCustomer, deleteCustomer, collectDebt } = useStore();
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [debtFilter, setDebtFilter] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  // Sắp xếp: bấm header để đảo chiều; đổi sort -> về trang 1
  // Mặc định mã mới nhất lên trên (khớp thứ tự server) để không nháy khi dữ liệu về.
  const { sortKey, sortDir, toggleSort } = useSortState('code', 'desc');
  const handleSort = (key: string) => {
    toggleSort(key);
    setPage(1);
  };
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(customers[0] || null);
  // Mobile: mở sheet chi tiết khi chạm 1 dòng trong record list (desktop vẫn dùng cột phải)
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);

  // Debt collection state
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [collectAmount, setCollectAmount] = useState<number>(0);
  const [collectMethod, setCollectMethod] = useState<'cash' | 'transfer'>('cash');
  const [collectNote, setCollectNote] = useState('');

  // Add customer modal (mở từ shell trang Công nợ khi bare, không thì nội bộ như cũ)
  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const isAddModalOpen = addOpen ?? internalAddOpen;
  const setIsAddModalOpen = (next: boolean) => {
    onAddOpenChange?.(next);
    setInternalAddOpen(next);
  };
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [group, setGroup] = useState<'retail' | 'contractor' | 'wholesale'>('contractor');
  const [debtLimit, setDebtLimit] = useState(20000000);
  const [importing, setImporting] = useState(false);
  // Edit customer modal
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editGroup, setEditGroup] = useState<'retail' | 'contractor' | 'wholesale'>('contractor');
  const [editDebtLimit, setEditDebtLimit] = useState(0);

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditAddress(c.address || '');
    setEditGroup(c.group);
    setEditDebtLimit(c.debt_limit);
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editName.trim()) return;
    try {
      const updates = {
        name: editName.trim(),
        phone: editPhone.trim(),
        address: editAddress.trim(),
        group: editGroup,
        debt_limit: Math.max(0, Math.round(editDebtLimit)),
      };
      await updateCustomer(editingCustomer.id, updates);
      if (selectedCustomer?.id === editingCustomer.id) {
        setSelectedCustomer({ ...selectedCustomer, ...updates });
      }
      setEditingCustomer(null);
      notify('Đã lưu thay đổi khách hàng!', 'success');
    } catch (err: any) {
      notify(`Không lưu được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

  const handleDeleteCustomer = async (c: Customer) => {
    if (c.current_debt > 0) {
      notify(`Không thể xóa "${c.name}" vì còn nợ ${formatVND(c.current_debt)}. Hãy thu hết nợ trước khi xóa.`, 'error');
      return;
    }
    const hasOrders = orders.some((o) => o.customer_id === c.id);
    if (hasOrders) {
      notify(`Không thể xóa "${c.name}" vì đã phát sinh đơn hàng (cần giữ lịch sử đối soát).`, 'error');
      return;
    }
    const ok = await confirmDialog(`Xóa vĩnh viễn "${c.name}" khỏi danh sách?\nThao tác đồng bộ lên server và không thể hoàn tác.`, {
      title: 'Xóa khách hàng',
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCustomer(c.id);
      if (selectedCustomer?.id === c.id) setSelectedCustomer(null);
      notify('Đã xóa khách hàng!', 'success');
    } catch (err: any) {
      notify(`Không xóa được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search) ||
        c.code.toLowerCase().includes(search.toLowerCase());
      const matchesGroup = groupFilter === 'all' || c.group === groupFilter;
      let matchesDebt = true;
      if (debtFilter === 'has_debt') matchesDebt = c.current_debt > 0;
      else if (debtFilter === 'over_limit') matchesDebt = c.debt_limit > 0 && c.current_debt > c.debt_limit;
      else if (debtFilter === 'no_debt') matchesDebt = c.current_debt === 0;

      return matchesSearch && matchesGroup && matchesDebt;
    });
  }, [customers, search, groupFilter, debtFilter]);

  const sortedCustomers = useMemo(() => {
    if (!sortKey) return filteredCustomers;
    const getters: Record<string, (c: Customer) => unknown> = {
      code: (c) => c.code,
      name: (c) => c.name,
      phone: (c) => c.phone,
      group: (c) => c.group,
      current_debt: (c) => c.current_debt,
      debt_limit: (c) => c.debt_limit,
    };
    const get = getters[sortKey];
    if (!get) return filteredCustomers;
    return sortRows(filteredCustomers, get, sortDir);
  }, [filteredCustomers, sortKey, sortDir]);

  const paginatedCustomers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedCustomers.slice(start, start + pageSize);
  }, [sortedCustomers, page, pageSize]);

  // Chi tiết/highlight chỉ hiện khách trong danh sách đang lọc
  // (lọc ra 0 dòng -> placeholder, khỏi dính khách cũ ngoài bộ lọc).
  // Các luồng thao tác chủ động (sheet mobile, modal thu nợ/sửa/xóa) giữ nguyên selectedCustomer.
  const visibleCustomer =
    selectedCustomer && filteredCustomers.some((c) => c.id === selectedCustomer.id)
      ? selectedCustomer
      : null;

  const totalFilteredDebt = useMemo(() => {
    return filteredCustomers.reduce((sum, c) => sum + c.current_debt, 0);
  }, [filteredCustomers]);

  // ---- Xuất / Nhập / In Excel ----
  const GROUP_LABEL: Record<string, string> = { retail: 'Khách lẻ', contractor: 'Thợ nhôm kính', wholesale: 'Đại lý / Công trình' };

  const customerToRow = (c: Customer): Record<string, unknown> => ({
    'Mã KH': c.code,
    'Tên khách hàng *': c.name,
    'SĐT *': c.phone,
    'Địa chỉ': c.address || '',
    'Nhóm (retail/contractor/wholesale)': c.group,
    'Nhóm': GROUP_LABEL[c.group] || c.group,
    'Đang nợ': c.current_debt,
    'Hạn mức nợ': c.debt_limit,
  });

  const handleExportExcel = () => {
    if (sortedCustomers.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('khach-hang-cong-no', [{ name: 'KhachHang', rows: sortedCustomers.map(customerToRow) }]);
  };

  const handlePrint = () => {
    if (sortedCustomers.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Danh sách khách hàng & công nợ',
      meta: [`${sortedCustomers.length} khách hàng`, `Tổng nợ: ${formatVND(totalFilteredDebt)}`],
      columns: [
        { header: 'Mã KH' },
        { header: 'Tên khách hàng' },
        { header: 'SĐT' },
        { header: 'Nhóm' },
        { header: 'Đang nợ', align: 'right' },
        { header: 'Hạn mức', align: 'right' },
      ],
      rows: sortedCustomers.slice(0, 1000).map((c) => [
        c.code,
        c.name,
        c.phone,
        GROUP_LABEL[c.group] || c.group,
        c.current_debt.toLocaleString('vi-VN'),
        c.debt_limit.toLocaleString('vi-VN'),
      ]),
      footer: ['Tổng', '', '', '', totalFilteredDebt.toLocaleString('vi-VN'), ''],
    });
  };

  const handleDownloadTemplate = () => {
    downloadExcelTemplate('khach-hang', ['Tên khách hàng *', 'SĐT *', 'Địa chỉ', 'Nhóm (retail/contractor/wholesale)', 'Hạn mức nợ'], {
      'Tên khách hàng *': 'Nguyễn Văn A',
      'SĐT *': '0901234567',
      'Địa chỉ': '123 Lý Thường Kiệt, Q.10',
      'Nhóm (retail/contractor/wholesale)': 'contractor',
      'Hạn mức nợ': 20000000,
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
      const validGroups = ['retail', 'contractor', 'wholesale'];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const lineNo = i + 2;
        try {
          const name = (r['Tên khách hàng *'] || r['Tên khách hàng'] || '').trim();
          const phone = (r['SĐT *'] || r['SĐT'] || '').trim();
          if (!name) throw new Error('thiếu Tên khách hàng');
          if (!phone) throw new Error('thiếu SĐT');
          const rawGroup = (r['Nhóm (retail/contractor/wholesale)'] || r['Nhóm'] || 'retail').trim().toLowerCase();
          const group = (validGroups.includes(rawGroup) ? rawGroup : 'retail') as Customer['group'];
          const payload = {
            name,
            phone,
            address: (r['Địa chỉ'] || '').trim() || undefined,
            group,
            debt_limit: Math.max(0, Math.round(parseExcelNum(r['Hạn mức nợ']))),
          };
          const existing = customers.find((c) => c.phone === phone);
          if (existing) {
            // Không đụng current_debt hiện hữu khi cập nhật thông tin
            await updateCustomer(existing.id, payload);
            updated++;
          } else {
            await addCustomer({ ...payload, current_debt: 0 });
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
      notify(`Nhập xong: ${created} tạo mới, ${updated} cập nhật${errors.length > 0 ? `\nLỗi:\n${errors.join('\n')}` : ''}`, 'info');
    } catch (err: any) {
      notify(`Đọc file thất bại: ${err?.message || err}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleOpenCollectModal = (c: Customer) => {
    setSelectedCustomer(c);
    setCollectAmount(c.current_debt);
    setIsCollectModalOpen(true);
  };

  const handleConfirmCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || collectAmount <= 0) return;

    const ok = await collectDebt(selectedCustomer.id, collectAmount, collectMethod, collectNote);
    if (!ok) return;
    setIsCollectModalOpen(false);
    notify(`Đã thu ${formatVND(collectAmount)} tiền nợ của ${selectedCustomer.name} thành công!`, 'success');
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const created = await addCustomer({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        group,
        current_debt: 0,
        debt_limit: debtLimit || 0,
        created_at: new Date().toISOString(),
      });

      setSelectedCustomer(created);
      setIsAddModalOpen(false);
      setName('');
      setPhone('');
      setAddress('');
      notify(`Thêm khách hàng "${created.name}" mới thành công!`, 'success');
    } catch (err: any) {
      notify(`Không thể thêm khách hàng: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

  return (
    <div id="customers-view" className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 overflow-hidden">
      {!bare && (
      <PageHeader
        icon={<Users className="w-5 h-5 text-blue-600" />}
        title="Khách hàng & Quản lý Công nợ"
        shortTitle="Khách hàng"
        count={`${customers.length} khách hàng`}
        actions={
          <>
            <TableTools
              onExportExcel={handleExportExcel}
              onPrint={handlePrint}
              onImportExcel={handleImportExcel}
              onDownloadTemplate={handleDownloadTemplate}
              importing={importing}
            />
            <AppButton onClick={() => setIsAddModalOpen(true)}>
              <Plus className="w-4 h-4" />
              <span>Thêm khách hàng mới</span>
            </AppButton>
          </>
        }
      />
      )}

      {/* Main Container */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Left: Customer List */}
        <div className="flex-1 flex flex-col bg-slate-100 min-w-0 min-h-0">
          <DataTableShell>
          {/* Filters Bar */}
          <div className="p-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(val) => {
                setSearch(val);
                setPage(1);
              }}
              placeholder="Tìm theo Tên, SĐT, Mã KH..."
            />

            <FilterSelect
              value={groupFilter}
              onChange={(val) => {
                setGroupFilter(val);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả nhóm khách' },
                { value: 'contractor', label: 'Thợ nhôm kính' },
                { value: 'wholesale', label: 'Đại lý / Công trình' },
                { value: 'retail', label: 'Khách lẻ' },
              ]}
            />

            <FilterSelect
              value={debtFilter}
              onChange={(val) => {
                setDebtFilter(val);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'Tất cả công nợ' },
                { value: 'has_debt', label: 'Đang có nợ (> 0)' },
                { value: 'over_limit', label: 'Vượt hạn mức nợ' },
                { value: 'no_debt', label: 'Không có nợ (= 0)' },
              ]}
            />
            {bare && (
                <TableTools
                  onExportExcel={handleExportExcel}
                  onPrint={handlePrint}
                  onImportExcel={handleImportExcel}
                  onDownloadTemplate={handleDownloadTemplate}
                  importing={importing}
                />
            )}
          </div>

          {/* Metric strip */}
          <SummaryStrip>
            <span>
              Tìm thấy <strong className="text-slate-900 font-mono">{filteredCustomers.length}</strong> khách hàng
            </span>
            <span>
              Tổng công nợ nhóm này:{' '}
              <strong className="font-mono text-rose-600 font-bold">{formatVND(totalFilteredDebt)}</strong>
            </span>
          </SummaryStrip>

          {/* Mobile record list — bảng ngang chỉ dành cho desktop */}
          <div id="customer-record-list" className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {paginatedCustomers.length === 0 ? (
              <ListEmpty>Không tìm thấy khách hàng nào phù hợp với bộ lọc.</ListEmpty>
            ) : (
              paginatedCustomers.map((c) => {
                const isOverLimit = c.debt_limit > 0 && c.current_debt > c.debt_limit;
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c);
                      setIsMobileDetailOpen(true);
                    }}
                    className={`w-full px-3 py-3 flex items-start justify-between gap-3 text-left active:bg-slate-50 ${
                      visibleCustomer?.id === c.id ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-800 leading-snug">{c.name}</span>
                      <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                        {c.code}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {c.current_debt > 0 ? (
                        <span className="block text-[11px] font-mono font-bold text-rose-600">{formatVND(c.current_debt)}</span>
                      ) : (
                        <span className="block text-[11px] font-mono text-slate-500">0 đ</span>
                      )}
                      {isOverLimit ? (
                        <span className="block text-[10px] font-bold text-rose-600">Vượt hạn mức</span>
                      ) : (
                        <span className="block text-[10px] text-slate-400 font-mono">Hạn mức {formatVND(c.debt_limit)}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <SortableTh className="py-2.5 px-3" label="Mã KH" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Tên khách hàng" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Số điện thoại" sortKey="phone" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Nhóm khách" sortKey="group" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Nợ hiện tại" sortKey="current_debt" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Hạn mức nợ" sortKey="debt_limit" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="py-2.5 px-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedCustomers.length === 0 ? (
                  <TableEmpty colSpan={7}>Không tìm thấy khách hàng nào phù hợp với bộ lọc.</TableEmpty>
                ) : (
                  paginatedCustomers.map((c) => {
                    const isSelected = visibleCustomer?.id === c.id;
                    const isOverLimit = c.debt_limit > 0 && c.current_debt > c.debt_limit;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCustomer(c)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/70 font-medium' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{c.code}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{c.name}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{c.phone}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                            {c.group === 'contractor'
                              ? 'Thợ nhôm kính'
                              : c.group === 'wholesale'
                              ? 'Đại lý / Công trình'
                              : 'Khách lẻ'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          <span className={c.current_debt > 0 ? (isOverLimit ? 'text-rose-700 font-extrabold' : 'text-rose-600') : 'text-slate-700'}>
                            {formatVND(c.current_debt)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                          {formatVND(c.debt_limit)}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <div className="flex min-h-7 items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditCustomer(c);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-blue-600 transition-colors hover:bg-blue-50"
                            title="Sửa thông tin khách hàng"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomer(c);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-600 transition-colors hover:bg-rose-50"
                            title="Xóa khách hàng"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          </div>
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
            currentPage={page}
            totalItems={filteredCustomers.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="khách hàng"
          />
          </DataTableShell>
        </div>

        {/* Right: Selected Customer Card (desktop/tablet — mobile dùng sheet bên dưới) */}
        {visibleCustomer ? (
          <div className="hidden md:flex w-full md:w-96 bg-slate-100 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs p-3 flex flex-col overflow-y-auto">
            <div className="space-y-4 text-xs">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-mono text-[10px] font-bold text-blue-700">
                    {visibleCustomer.code}
                  </span>
                  <StatusBadge tone="blue" pill={false}>
                    {visibleCustomer.group === 'contractor' ? 'Thợ kính / Thi công' : 'Khách lẻ'}
                  </StatusBadge>
                </div>

                <h3 className="font-bold text-sm text-slate-900">{visibleCustomer.name}</h3>

                <div className="space-y-1 text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{visibleCustomer.phone}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{visibleCustomer.address || 'Chưa cập nhật địa chỉ'}</span>
                    </div>
                </div>

                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-1">
                  <div className="text-[11px] text-rose-700">NỢ HIỆN TẠI:</div>
                  <div className="text-xl font-extrabold text-rose-600 font-mono">
                    {formatVND(visibleCustomer.current_debt)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Hạn mức tín dụng tối đa: {formatVND(visibleCustomer.debt_limit)}
                  </div>
                </div>
              </div>

              {/* Debt settlement quick trigger */}
              {visibleCustomer.current_debt > 0 ? (
                <button
                  onClick={() => handleOpenCollectModal(visibleCustomer)}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Lập Phiếu Thu Nợ Khách Hàng (PT)</span>
                </button>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-center font-medium flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Khách hàng không còn dư nợ!</span>
                </div>
              )}
            </div>
          </div>
          </div>
        ) : (
          <div className="hidden md:flex w-full md:w-96 bg-slate-100 flex-col min-h-0">
            <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs flex items-center justify-center text-slate-400 text-xs p-3">
              Chọn khách hàng để xem chi tiết
            </div>
          </div>
        )}
      </div>

      {/* Mobile: sheet chi tiết khách hàng */}
      {isMobileDetailOpen && selectedCustomer && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Chi tiết khách hàng">
          <button type="button" className="absolute inset-0 bg-slate-900/45" onClick={() => setIsMobileDetailOpen(false)} aria-label="Đóng" />
          <div className="relative w-full max-h-[85dvh] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] font-mono font-bold text-blue-700">{selectedCustomer.code}</p>
                <p className="text-sm font-bold text-slate-900 leading-snug">{selectedCustomer.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  {selectedCustomer.phone || 'Chưa có SĐT'} ·{' '}
                  {selectedCustomer.group === 'contractor' ? 'Thợ kính / Thi công' : 'Khách lẻ'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDetailOpen(false)}
                className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                aria-label="Đóng chi tiết khách"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
                <p className="text-[11px] text-rose-700 font-medium">NỢ HIỆN TẠI</p>
                <p className="text-xl font-extrabold text-rose-600 font-mono">{formatVND(selectedCustomer.current_debt)}</p>
                <p className="text-[10px] text-slate-500 font-mono">Hạn mức: {formatVND(selectedCustomer.debt_limit)}</p>
              </div>
              {selectedCustomer.address && (
                <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  {selectedCustomer.address}
                </p>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsMobileDetailOpen(false);
                  openEditCustomer(selectedCustomer);
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 active:bg-slate-100"
              >
                <Edit2 className="w-4 h-4" />
                Sửa
              </button>
              <button
                type="button"
                disabled={selectedCustomer.current_debt <= 0}
                onClick={() => {
                  setIsMobileDetailOpen(false);
                  handleOpenCollectModal(selectedCustomer);
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-bold text-white active:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
              >
                <DollarSign className="w-4 h-4" />
                Thu nợ
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMobileDetailOpen(false);
                  handleDeleteCustomer(selectedCustomer);
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white text-xs font-bold text-rose-600 active:bg-rose-50"
              >
                <Trash2 className="w-4 h-4" />
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collect Debt Modal */}
      <SheetShell
        open={isCollectModalOpen && !!selectedCustomer}
        onClose={() => setIsCollectModalOpen(false)}
        label="Thu nợ khách hàng"
        icon={<HandCoins className="w-4 h-4 text-emerald-400" />}
        title="Thu Nợ Khách Hàng (Tạo Phiếu Thu PT)"
      >
          <form onSubmit={handleConfirmCollect} className="flex flex-col min-h-0">
            <div className="p-4 space-y-3 text-xs overflow-y-auto">
              <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                <div className="font-semibold text-slate-800">{selectedCustomer?.name}</div>
                <div className="text-slate-500">
                  Dư nợ hiện tại: <strong className="text-rose-600">{formatVND(selectedCustomer?.current_debt)}</strong>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Số tiền thu nợ (đ) *</label>
                <NumberInput
                  required
                  max={selectedCustomer?.current_debt}
                  min={1}
                  value={collectAmount}
                  onChange={(val) => setCollectAmount(val)}
                  placeholder="0"
                  className="w-full h-9 px-3 border border-slate-300 rounded font-mono font-bold text-base text-blue-700 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Phương thức thu tiền</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCollectMethod('cash')}
                    className={`py-2 px-3 rounded font-medium border text-center ${
                      collectMethod === 'cash' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50'
                    }`}
                  >
                    Tiền mặt (Két quầy)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollectMethod('transfer')}
                    className={`py-2 px-3 rounded font-medium border text-center ${
                      collectMethod === 'transfer' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50'
                    }`}
                  >
                    Chuyển khoản VietQR
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Ghi chú thu nợ</label>
                <input
                  type="text"
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  placeholder="Vd: Thu nợ đơn hàng trước đợt 1"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsCollectModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                id="btn-confirm-collect-customer"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold"
              >
                Xác nhận thu nợ
              </button>
            </div>
          </form>
      </SheetShell>

      {/* Add Customer Modal */}
      <SheetShell
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        label="Thêm khách hàng"
        icon={<UserPlus className="w-4 h-4 text-blue-400" />}
        title="Thêm Khách Hàng Mới (Mã Tự Sinh KH000x)"
      >
          <form onSubmit={handleCreateCustomer} className="flex flex-col min-h-0">
            <div className="p-4 space-y-3 text-xs overflow-y-auto">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên khách hàng / Xưởng nhôm kính *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vd: Xưởng Nhôm Kính Đức Phát"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="09..."
                    className="w-full h-8 px-2.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nhóm khách hàng</label>
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value as any)}
                    className="w-full h-8 px-2 border border-slate-300 rounded"
                  >
                    <option value="contractor">Thợ nhôm kính / Thi công</option>
                    <option value="retail">Khách lẻ tại quầy</option>
                    <option value="wholesale">Đại lý / Công ty nội thất</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Địa chỉ</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Số nhà, đường, quận/huyện..."
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Hạn mức nợ cho phép (đ)</label>
                <NumberInput
                  value={debtLimit}
                  onChange={(val) => setDebtLimit(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                id="btn-add-customer-save"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Lưu khách hàng
              </button>
            </div>
          </form>
      </SheetShell>

      {/* Edit Customer Modal */}
      <SheetShell
        open={!!editingCustomer}
        onClose={() => setEditingCustomer(null)}
        label="Sửa khách hàng"
        icon={<Edit2 className="w-4 h-4 text-amber-400" />}
        title={`Sửa Khách Hàng (${editingCustomer?.code ?? ''})`}
      >
          <form onSubmit={handleUpdateCustomer} className="flex flex-col min-h-0">
            <div className="p-4 space-y-3 text-xs overflow-y-auto">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên khách hàng / Xưởng nhôm kính *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="09..."
                    className="w-full h-8 px-2.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nhóm khách hàng</label>
                  <select
                    value={editGroup}
                    onChange={(e) => setEditGroup(e.target.value as any)}
                    className="w-full h-8 px-2 border border-slate-300 rounded"
                  >
                    <option value="contractor">Thợ nhôm kính / Thi công</option>
                    <option value="retail">Khách lẻ tại quầy</option>
                    <option value="wholesale">Đại lý / Công ty nội thất</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Địa chỉ</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Số nhà, đường, quận/huyện..."
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Hạn mức nợ cho phép (đ)</label>
                <NumberInput
                  value={editDebtLimit}
                  onChange={(val) => setEditDebtLimit(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                id="btn-edit-customer-save"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Lưu thay đổi
              </button>
            </div>
          </form>
      </SheetShell>
    </div>
  );
}
