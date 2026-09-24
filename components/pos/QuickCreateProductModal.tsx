// Modal tạo nhanh hàng hóa từ POS khi tìm/quét mã không thấy trong danh mục.
// Tự gọi useStore (pattern POSQuickCustomerModal): tạo xong trả Product về cho
// ProductSearchBar tự nhánh (thêm giỏ / mở F3 / onPickProduct nhập kho).
'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { notify } from '@/components/common/Toast';
import { Product } from '@/lib/types';
import { PackagePlus, X } from 'lucide-react';

const QUICK_UNIT_OPTIONS = [
  'cái', 'chiếc', 'bộ', 'cặp', 'chai', 'cuộn', 'thùng', 'bao', 'hộp', 'gói', 'viên',
  'm', 'm²', 'mét dài', 'cây',
  'chuyến', 'công', 'giờ', 'lần',
];

interface QuickCreateProductModalProps {
  open: boolean;
  /** Chuỗi user vừa tìm/quét — seed Tên + SKU */
  initialQuery: string;
  onClose: () => void;
  /** Được gọi sau khi tạo thành công (addProduct đã sync nội bộ) */
  onCreated: (product: Product) => void;
}

export function QuickCreateProductModal({ open, initialQuery, onClose, onCreated }: QuickCreateProductModalProps) {
  const { addProduct, products } = useStore();

  // State khởi tạo 1 lần từ seed — parent remount modal (key=seq) mỗi lần mở nên luôn mới
  const [name, setName] = useState(initialQuery.trim());
  const [sku, setSku] = useState(initialQuery.trim());
  const [category, setCategory] = useState(() => {
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort();
    return cats[0] || 'Khác';
  });
  const [unit, setUnit] = useState('cái');
  const [productType, setProductType] = useState<'goods' | 'area' | 'service'>('goods');
  const [retailPrice, setRetailPrice] = useState('');
  const [importPrice, setImportPrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('0');
  const [wasteFactor, setWasteFactor] = useState('5');
  const [defaultGrindingPrice, setDefaultGrindingPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort();

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notify('Vui lòng nhập tên hàng hóa', 'error');
      return;
    }
    const price = parseInt(retailPrice.replace(/[^\d]/g, ''), 10) || 0;
    if (price <= 0) {
      notify('Giá bán phải lớn hơn 0', 'error');
      return;
    }
    const importP = parseInt(importPrice.replace(/[^\d]/g, ''), 10) || 0;
    setSaving(true);
    try {
      const created = await addProduct({
        name: name.trim(),
        category: category.trim() || 'Khác',
        unit,
        product_type: productType,
        retail_price: price,
        import_price: importP,
        avg_cost: importP, // INT-ERR-01: vốn BQ = giá nhập lúc tạo
        stock_quantity: parseInt(stockQuantity, 10) || 0,
        waste_factor: productType === 'area' ? parseFloat(wasteFactor) || 5 : undefined,
        default_grinding_price:
          productType === 'area' ? parseInt(defaultGrindingPrice.replace(/[^\d]/g, ''), 10) || 0 : undefined,
        // SKU rỗng -> addProduct tự sinh mã SP...; quét mã vạch thì giữ nguyên chuỗi
        sku: sku.trim() || undefined,
      } as Parameters<typeof addProduct>[0]);
      notify(`Đã tạo hàng hóa "${created.name}" (${created.sku})`, 'success');
      onClose();
      onCreated(created);
    } catch (err: unknown) {
      notify(`Không thể tạo hàng hóa: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div id="pos-quick-create-product-modal" className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in-50 zoom-in-95">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            <PackagePlus className="w-4 h-4 text-amber-400" />
            <span>Tạo nhanh hàng hóa mới</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Tên hàng hóa <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Kính 5mm loại 1"
                className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
                autoFocus
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Mã SKU / Mã vạch:</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Bỏ trống để tự sinh"
                className="w-full h-8 px-2.5 font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Danh mục:</label>
              <input
                type="text"
                list="quick-create-category-list"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Nhôm kính..."
                className="w-full h-8 px-2.5 bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
              <datalist id="quick-create-category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Loại hàng:</label>
              <select
                value={productType}
                onChange={(e) => {
                  const t = e.target.value as 'goods' | 'area' | 'service';
                  setProductType(t);
                  setUnit(t === 'area' ? 'm²' : unit === 'm²' ? 'cái' : unit);
                }}
                className="w-full h-8 px-2 bg-white border border-slate-300 rounded-md text-slate-800 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="goods">Hàng hóa</option>
                <option value="area">Diện tích (m²)</option>
                <option value="service">Dịch vụ</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Đơn vị:</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-8 px-2 bg-white border border-slate-300 rounded-md text-slate-800 focus:border-blue-500 focus:outline-hidden"
              >
                {QUICK_UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Giá bán <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="w-full h-8 px-2.5 text-right font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Giá nhập:</label>
              <input
                type="text"
                inputMode="numeric"
                value={importPrice}
                onChange={(e) => setImportPrice(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="w-full h-8 px-2.5 text-right font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>

            {productType === 'goods' && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tồn kho đầu:</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full h-8 px-2.5 text-right font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
                />
              </div>
            )}

            {productType === 'area' && (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hao hụt (%):</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={wasteFactor}
                    onChange={(e) => setWasteFactor(e.target.value.replace(/[^\d.]/g, ''))}
                    className="w-full h-8 px-2.5 text-right font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Giá mài mặc định:</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={defaultGrindingPrice}
                    onChange={(e) => setDefaultGrindingPrice(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="0"
                    className="w-full h-8 px-2.5 text-right font-mono bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden text-slate-800"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold transition-colors"
            >
              Hủy (Esc)
            </button>
            <button
              type="submit"
              id="btn-quick-create-product-save"
              disabled={saving}
              className="h-8 px-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-semibold flex items-center gap-1.5 transition-colors"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>{saving ? 'Đang tạo...' : 'Tạo hàng hóa'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
