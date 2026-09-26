'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Product, ProductType } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Boxes,
  Plus,
  Search,
  Layers,
  Edit2,
  Trash2,
  Package,
  Wrench,
  Percent,
  CheckCircle2,
  X,
  Filter,
} from 'lucide-react';
import { PaginationBar } from '@/components/common/PaginationBar';
import { NumberInput } from '@/components/common/NumberInput';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, downloadExcelTemplate, readExcelFile, parseExcelNum, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import { DataTableShell } from '@/components/common/DataTableShell';
import { AddProductFormModal, UNIT_OPTIONS } from '@/components/products/AddProductFormModal';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { SheetShell } from '@/components/common/SheetShell';
import { notify } from '@/components/common/Toast';

export function ProductsView() {
  const { products, orders, addProduct, updateProduct, deleteProduct } = useStore();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // Sửa hàng hóa: prefill từ bản ghi, không cho đụng tồn kho/vốn BQ (đi luồng nhập kho)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('cái');
  const [editProductType, setEditProductType] = useState<ProductType>('goods');
  const [editRetailPrice, setEditRetailPrice] = useState(0);
  const [editImportPrice, setEditImportPrice] = useState(0);
  const [editWasteFactor, setEditWasteFactor] = useState(0);
  const [editGrindingPrice, setEditGrindingPrice] = useState(0);

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setEditName(p.name);
    setEditUnit(p.unit);
    setEditProductType(p.product_type);
    setEditRetailPrice(p.retail_price);
    setEditImportPrice(p.import_price);
    setEditWasteFactor(p.waste_factor ?? 0);
    setEditGrindingPrice(p.default_grinding_price ?? 0);
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !editName.trim()) return;
    try {
      await updateProduct(editingProduct.id, {
        name: editName.trim(),
        unit: editUnit,
        product_type: editProductType,
        retail_price: Math.max(0, Math.round(editRetailPrice)),
        import_price: Math.max(0, Math.round(editImportPrice)),
        waste_factor: editProductType === 'area' ? Math.max(0, editWasteFactor) : undefined,
        default_grinding_price: editProductType === 'area' ? Math.max(0, Math.round(editGrindingPrice)) : undefined,
      });
      setEditingProduct(null);
      notify('Đã lưu thay đổi hàng hóa!', 'success');
    } catch (err: any) {
      notify(`Không lưu được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };

  const handleDeleteProduct = async (p: Product) => {
    if (p.stock_quantity > 0 && p.product_type !== 'service') {
      notify(`Không thể xóa "${p.name}" vì còn tồn kho (${p.stock_quantity} ${p.unit}). Hãy xả hết tồn (bán/xuất điều chỉnh) trước khi xóa.`, 'error');
      return;
    }
    const usedInOrder = orders.some((o) => o.items.some((it) => it.product_id === p.id));
    if (usedInOrder) {
      notify(`Không thể xóa "${p.name}" vì đã phát sinh trong đơn hàng (cần giữ lịch sử đối soát).`, 'error');
      return;
    }
    const usedInCombo = products.some((x) => x.combo_items?.some((c) => c.product_id === p.id));
    if (usedInCombo) {
      notify(`Không thể xóa "${p.name}" vì đang là linh kiện trong combo. Gỡ khỏi combo trước.`, 'error');
      return;
    }
    const ok = await confirmDialog(`Xóa vĩnh viễn "${p.name}" khỏi danh mục?\nThao tác đồng bộ lên server và không thể hoàn tác.`, {
      title: 'Xóa hàng hóa',
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProduct(p.id);
      notify('Đã xóa hàng hóa!', 'success');
    } catch (err: any) {
      notify(`Không xóa được: ${err?.message || 'lỗi không rõ'}`, 'error');
    }
  };
  // Sắp xếp: bấm header để đảo chiều; đổi sort/filter -> về trang 1
  const { sortKey, sortDir, toggleSort } = useSortState();
  const handleSort = (key: string) => {
    toggleSort(key);
    setPage(1);
  };


  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      const matchesType = typeFilter === 'all' || p.product_type === typeFilter;

      let matchesStock = true;
      if (stockStatusFilter === 'low') matchesStock = p.product_type !== 'service' && p.stock_quantity <= 15 && p.stock_quantity > 0;
      else if (stockStatusFilter === 'out') matchesStock = p.product_type !== 'service' && p.stock_quantity <= 0;
      else if (stockStatusFilter === 'in_stock') matchesStock = p.product_type !== 'service' && p.stock_quantity > 15;

      return matchesSearch && matchesType && matchesStock;
    });
  }, [products, search, typeFilter, stockStatusFilter]);

  const sortedProducts = useMemo(() => {
    if (!sortKey) return filteredProducts;
    const getters: Record<string, (p: Product) => unknown> = {
      sku: (p) => p.sku,
      name: (p) => p.name,
      product_type: (p) => p.product_type,
      unit: (p) => p.unit,
      retail_price: (p) => p.retail_price,
      avg_cost: (p) => p.avg_cost,
      import_price: (p) => p.import_price,
      waste_factor: (p) => p.waste_factor,
      stock_quantity: (p) => p.stock_quantity,
    };
    const get = getters[sortKey];
    if (!get) return filteredProducts;
    return sortRows(filteredProducts, get, sortDir);
  }, [filteredProducts, sortKey, sortDir]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedProducts.slice(start, start + pageSize);
  }, [sortedProducts, page, pageSize]);

  // ---- Xuất / Nhập / In Excel ----
  const PRODUCT_TEMPLATE = ['Mã SKU', 'Tên hàng *', 'ĐVT', 'Loại (goods/area/combo/service)', 'Giá bán', 'Giá vốn nhập', 'Tồn kho', 'Tồn tối thiểu', 'Hao hụt (%)'];

  const productToRow = (p: Product): Record<string, unknown> => ({
    'Mã SKU': p.sku,
    'Tên hàng': p.name,
    'ĐVT': p.unit,
    'Loại': p.product_type,
    'Giá bán': p.retail_price,
    'Giá vốn nhập': p.import_price,
    'Giá vốn BQ': Math.round(p.avg_cost),
    'Tồn kho': p.stock_quantity,
    'Tồn tối thiểu': p.min_stock ?? '',
    'Hao hụt (%)': p.waste_factor ?? '',
  });

  const handleExportExcel = () => {
    if (sortedProducts.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('danh-muc-hang-hoa', [{ name: 'HangHoa', rows: sortedProducts.map(productToRow) }]);
  };

  const handlePrint = () => {
    if (sortedProducts.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    const rows = sortedProducts.slice(0, 1000).map((p) => [
      p.sku,
      p.name,
      p.unit,
      String(p.retail_price).replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
      String(p.stock_quantity),
    ]);
    printTable({
      title: 'Danh mục hàng hóa & bảng giá',
      meta: [`${sortedProducts.length} mặt hàng`, `In lúc ${new Date().toLocaleString('vi-VN')}`],
      columns: [
        { header: 'Mã SKU' },
        { header: 'Tên hàng' },
        { header: 'ĐVT', align: 'center' },
        { header: 'Giá bán', align: 'right' },
        { header: 'Tồn kho', align: 'right' },
      ],
      rows,
    });
  };

  const handleDownloadTemplate = () => {
    downloadExcelTemplate('hang-hoa', PRODUCT_TEMPLATE, {
      'Mã SKU': '',
      'Tên hàng *': 'Kính cường lực 10mm',
      'ĐVT': 'm²',
      'Loại (goods/area/combo/service)': 'area',
      'Giá bán': 350000,
      'Giá vốn nhập': 260000,
      'Tồn kho': 100,
      'Tồn tối thiểu': 10,
      'Hao hụt (%)': 5,
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
      const validTypes: ProductType[] = ['goods', 'area', 'combo', 'service'];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const lineNo = i + 2;
        try {
          const name = (r['Tên hàng *'] || r['Tên hàng'] || '').trim();
          if (!name) throw new Error('thiếu Tên hàng');
          const rawType = (r['Loại (goods/area/combo/service)'] || r['Loại'] || 'goods').trim().toLowerCase();
          const product_type = (validTypes.includes(rawType as ProductType) ? rawType : 'goods') as ProductType;
          const priceRaw = r['Giá bán'] ?? r['Giá bán lẻ'] ?? 0;
          const payload = {
            name,
            unit: (r['ĐVT'] || 'cái').trim(),
            product_type,
            retail_price: Math.max(0, Math.round(parseExcelNum(priceRaw))),
            import_price: Math.max(0, Math.round(parseExcelNum(r['Giá vốn nhập']))),
            avg_cost: Math.max(0, Math.round(parseExcelNum(r['Giá vốn nhập']))),
            stock_quantity: Math.max(0, parseExcelNum(r['Tồn kho'])),
            min_stock: r['Tồn tối thiểu'] !== '' ? Math.max(0, parseExcelNum(r['Tồn tối thiểu'])) : undefined,
            waste_factor: r['Hao hụt (%)'] !== '' ? Math.max(0, parseExcelNum(r['Hao hụt (%)'])) : undefined,
          };
          const sku = (r['Mã SKU'] || '').trim();
          const existing =
            (sku && products.find((p) => p.sku.toLowerCase() === sku.toLowerCase())) ||
            products.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.unit.toLowerCase() === payload.unit.toLowerCase());
          if (existing) {
            await updateProduct(existing.id, payload);
            updated++;
          } else {
            await addProduct(sku ? { ...payload, sku } : payload);
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

  return (
    <div id="products-view" className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 overflow-hidden">
      {/* Top Header: cuon ngang tren man hep de khong vo bo cuc */}
      <div className="h-14 px-2 sm:px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap">
            <Boxes className="w-5 h-5 text-blue-600" />
            <span className="hidden sm:inline">Danh mục Hàng hóa &amp; Bảng giá</span>
            <span className="sm:hidden">Bảng giá</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
            {products.length} mặt hàng
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            id="btn-open-add-product-modal"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm hàng hóa mới</span>
          </button>
          <TableTools
            onExportExcel={handleExportExcel}
            onPrint={handlePrint}
            onImportExcel={handleImportExcel}
            onDownloadTemplate={handleDownloadTemplate}
            importing={importing}
          />
        </div>
      </div>

      {/* Data table workspace */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <DataTableShell>
      {/* Filter Bar */}
      <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo Tên hàng, Mã SKU..."
            className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
          />
        </div>

        {/* Stock Status Filter */}
        <select
          value={stockStatusFilter}
          onChange={(e) => {
            setStockStatusFilter(e.target.value);
            setPage(1);
          }}
          className="h-8 px-2 text-xs bg-white border border-slate-300 rounded-md text-slate-700 font-medium"
        >
          <option value="all">Tất cả mức tồn</option>
          <option value="low">Sắp hết (≤ 15)</option>
          <option value="out">Hết hàng (= 0)</option>
          <option value="in_stock">Còn nhiều (&gt; 15)</option>
        </select>

        {/* Type Filter Buttons */}
        <div className="flex items-center gap-1">
          {[
            { id: 'all', label: 'Tất cả' },
            { id: 'area', label: 'Diện tích' },
            { id: 'goods', label: 'Thường' },
            { id: 'combo', label: 'Combo lắp ráp' },
            { id: 'service', label: 'Dịch vụ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setTypeFilter(tab.id);
                setPage(1);
              }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                typeFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Metrics Strip */}
      <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
        <span>
          Tìm thấy <strong className="text-slate-900 font-mono">{filteredProducts.length}</strong> mặt hàng phù hợp
        </span>
        <div className="flex items-center gap-4">
          <span>
            Diện tích: <strong className="text-slate-800 font-mono">{filteredProducts.filter(p => p.product_type === 'area').length}</strong>
          </span>
          <span>
            Thường: <strong className="text-slate-800 font-mono">{filteredProducts.filter(p => p.product_type === 'goods').length}</strong>
          </span>
          <span>
            Combo: <strong className="text-slate-800 font-mono">{filteredProducts.filter(p => p.product_type === 'combo').length}</strong>
          </span>
          <span>
            Dịch vụ: <strong className="text-slate-800 font-mono">{filteredProducts.filter(p => p.product_type === 'service').length}</strong>
          </span>
        </div>
      </div>

      {/* Products record list (mobile) — bảng ngang chỉ dành cho desktop */}
      <div id="product-record-list" className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
        {paginatedProducts.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">Không tìm thấy sản phẩm nào phù hợp với bộ lọc.</p>
        ) : (
          paginatedProducts.map((p) => {
            const typeLabel =
              p.product_type === 'area' ? 'Diện tích' : p.product_type === 'combo' ? 'Combo' : p.product_type === 'service' ? 'Dịch vụ' : 'Thường';
            const typeCls =
              p.product_type === 'area'
                ? 'bg-amber-100 text-amber-800'
                : p.product_type === 'combo'
                  ? 'bg-purple-100 text-purple-800'
                  : p.product_type === 'service'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-blue-100 text-blue-800';
            return (
              <div key={p.id} className="px-3 py-2.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-slate-800 leading-snug">{p.name}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${typeCls}`}>{typeLabel}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                  </p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-[11px] text-slate-600 font-mono">
                      <span className="text-blue-700 font-bold">{formatVND(p.retail_price)}</span>
                      {p.avg_cost > 0 ? ` · vốn ${formatVND(p.avg_cost)}` : ''}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {p.product_type === 'service'
                        ? 'Không tính kho'
                        : p.product_type === 'combo'
                          ? 'Trừ kho con'
                          : `Tồn ${p.stock_quantity} ${p.unit}`}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button
                    onClick={() => openEditProduct(p)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200 text-blue-600 bg-blue-50 active:bg-blue-100"
                    aria-label={`Sửa ${p.name}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteProduct(p)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 bg-rose-50 active:bg-rose-100"
                    aria-label={`Xóa ${p.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Products Table */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <SortableTh className="py-2.5 px-3" label="Mã SKU" sortKey="sku" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3" label="Tên sản phẩm" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-center" label="Loại hàng" sortKey="product_type" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-center" label="ĐVT" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-right" label="Giá bán" sortKey="retail_price" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-right" label="Giá vốn (Bình quân)" sortKey="avg_cost" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-right" label="Nhập gần nhất" sortKey="import_price" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-center" label="Hao hụt phôi" sortKey="waste_factor" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableTh className="py-2.5 px-3 text-right" label="Tồn kho" sortKey="stock_quantity" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="py-2.5 px-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    Không tìm thấy sản phẩm nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((p) => {
                  const isArea = p.product_type === 'area';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {p.sku}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">{p.name}</div>
                        {p.combo_items && (
                          <div className="text-[10px] text-purple-600">
                            Gồm {p.combo_items.length} linh kiện con
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.product_type === 'area'
                              ? 'bg-amber-100 text-amber-800'
                              : p.product_type === 'combo'
                              ? 'bg-purple-100 text-purple-800'
                              : p.product_type === 'service'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {p.product_type === 'area'
                            ? 'Diện tích'
                            : p.product_type === 'combo'
                            ? 'Combo'
                            : p.product_type === 'service'
                            ? 'Dịch vụ'
                            : 'Thường'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-700 font-medium">
                        {p.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-600">
                        {formatVND(p.retail_price)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                        {formatVND(p.avg_cost)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono" title="Giá nhập kho lần gần nhất — so với vốn bình quân">
                        {p.import_price > 0 ? (
                          <>
                            <div className="font-bold text-slate-800">{formatVND(p.import_price)}</div>
                            {p.avg_cost > 0 && p.import_price !== p.avg_cost && (
                              <div className={`text-[10px] font-bold ${p.import_price > p.avg_cost ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {p.import_price > p.avg_cost ? '▲' : '▼'}{' '}
                                {Math.abs(Math.round(((p.import_price - p.avg_cost) / p.avg_cost) * 100))}% vs vốn BQ
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-700">
                        {isArea ? (
                          <span className="font-semibold text-amber-700">+{p.waste_factor}%</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        {p.product_type === 'service' ? (
                          <span className="text-slate-400 font-normal">Không tính</span>
                        ) : p.product_type === 'combo' ? (
                          <span className="text-purple-600 font-normal text-[10px]">Trừ kho con</span>
                        ) : (
                          <span className={p.stock_quantity < 20 ? 'text-rose-600' : 'text-slate-800'}>
                            {p.stock_quantity} {p.unit}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => openEditProduct(p)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Sửa thông tin hàng hóa"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="Xóa hàng hóa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
          totalItems={filteredProducts.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemName="hàng hóa"
        />
      </div>
        </DataTableShell>
      </div>

      {/* Add Product Modal — form dùng chung với POS quick-create (AddProductFormModal) */}
      <AddProductFormModal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      {/* Edit Product Modal */}
      <SheetShell
        open={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        label="Sửa hàng hóa"
        icon={<Edit2 className="w-4 h-4 text-amber-400" />}
        title={`Sửa Hàng Hóa (${editingProduct?.sku ?? ''})`}
      >
          <form onSubmit={handleUpdateProduct} className="flex flex-col min-h-0">
            <div className="p-4 space-y-3 text-xs overflow-y-auto">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên sản phẩm *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-8 px-2.5 border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Loại sản phẩm</label>
                  <select
                    value={editProductType}
                    onChange={(e) => {
                      const val = e.target.value as ProductType;
                      setEditProductType(val);
                      if (val === 'area') setEditUnit('m²');
                      else if (val === 'combo') setEditUnit('bộ');
                    }}
                    className="w-full h-8 px-2 border border-slate-300 rounded"
                  >
                    <option value="area">Diện tích (Kính, Tấm alu, MDF)</option>
                    <option value="goods">Thường (Cây nhôm, Phụ kiện)</option>
                    <option value="combo">Combo trọn bộ (Trừ kho con)</option>
                    <option value="service">Dịch vụ (Công lắp đặt)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Đơn vị tính</label>
                  <select
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    aria-label="Đơn vị tính"
                    className="w-full h-8 px-2.5 border border-slate-300 rounded bg-white"
                  >
                    {UNIT_OPTIONS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>


              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Giá bán (đ)</label>
                  <NumberInput
                    value={editRetailPrice}
                    onChange={(val) => setEditRetailPrice(val)}
                    placeholder="0"
                    className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Giá vốn nhập (đ)</label>
                  <NumberInput
                    value={editImportPrice}
                    onChange={(val) => setEditImportPrice(val)}
                    placeholder="0"
                    className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {editProductType === 'area' && (
                <div className="grid grid-cols-2 gap-2 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                  <div>
                    <label className="font-semibold text-amber-900 block mb-1">
                      Hệ số hao hụt phôi (%)
                    </label>
                    <NumberInput
                      allowDecimals={true}
                      value={editWasteFactor}
                      onChange={(val) => setEditWasteFactor(val)}
                      placeholder="5"
                      className="w-full h-8 px-2.5 border border-amber-300 rounded font-mono bg-white focus:border-amber-500 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-amber-900 block mb-1">
                      Giá mài mặc định (đ/md)
                    </label>
                    <NumberInput
                      value={editGrindingPrice}
                      onChange={(val) => setEditGrindingPrice(val)}
                      placeholder="20.000"
                      className="w-full h-8 px-2.5 border border-amber-300 rounded font-mono bg-white focus:border-amber-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400">
                Tồn kho & giá vốn bình quân không sửa tay — thay đổi qua Nhập kho.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                id="btn-edit-product-save"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs"
              >
                Lưu thay đổi
              </button>
            </div>
          </form>
      </SheetShell>
    </div>
  );
}
