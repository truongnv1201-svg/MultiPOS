'use client';

import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { useStore } from '@/lib/store';
import { Product } from '@/lib/types';
import { Search, PackagePlus } from 'lucide-react';
import { AddProductFormModal } from '@/components/products/AddProductFormModal';
import { formatVND } from '@/lib/format';

function createBlankAreaItem(product: Product, quantity: number) {
  // Item trống — mọi số liệu do Modal F3 tính. Không seed số giả.
  const qty = quantity > 0 ? quantity : 1;
  const uniqueId = `item-${product.id}-${Math.random().toString(36).substring(2, 9)}`;
  return {
    item: {
      id: uniqueId,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      product_type: 'area' as const,
      unit: product.unit,
      unit_price: product.retail_price,
      quantity: qty,
      discount_amount: 0,
      processing_fee: 0,
      subtotal: 0,
      waste_factor: product.waste_factor ?? 5,
      dimension_details: undefined,
    },
    isNew: true,
  };
}

// Thanh tìm kiếm hàng hóa đặt ở topbar danh sách (nền trắng).
// Giữ nguyên ids (f1-search-input / quick-quantity-input / search-results-dropdown)
// để tương thích phím tắt toàn cục (F1) và E2E.
export interface ProductSearchBarHandle {
  /** Handler onKeyDown cho ô SL khi render bên ngoài component */
  handleQuantityKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

interface ProductSearchBarProps {
  /** Nếu false, ô SL sẽ bị ẩn bên trong component và được render ở ngoài */
  showQuantityInput?: boolean;
  /** Controlled quantity từ parent */
  quantity?: number;
  /** Callback cập nhật quantity từ parent */
  onQuantityChange?: (v: number) => void;
  /** Ref ô SL từ parent (để phím tắt focus từ bên ngoài) */
  quantityInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Chế độ nhập kho: khi có, chọn hàng sẽ gọi callback này thay vì thêm vào giỏ bán */
  onPickProduct?: (product: Product, quantity: number) => void;
}


export const ProductSearchBar = forwardRef<ProductSearchBarHandle, ProductSearchBarProps>(
  function ProductSearchBar(
    {
      showQuantityInput = true,
      quantity: externalQuantity,
      onQuantityChange,
      quantityInputRef: externalQuantityRef,
      onPickProduct,
    }: ProductSearchBarProps,
    ref
  ) {
  const { products, addItemToCart, setDimensionModalItem } = useStore();

  const isControlled = externalQuantity !== undefined && onQuantityChange !== undefined;

  const [searchQuery, setSearchQuery] = useState('');
  const [internalQuantity, setInternalQuantity] = useState<number>(1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Tạo nhanh hàng hóa khi tìm/quét mã không thấy trong danh mục.
  // quickCreateSeq làm key: mở lần nào form cũng remount về giá trị seed (không cần effect reset).
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateSeed, setQuickCreateSeed] = useState('');
  const [quickCreateSeq, setQuickCreateSeq] = useState(0);
  const openQuickCreate = (q: string) => {
    setQuickCreateSeed(q);
    setQuickCreateSeq((s) => s + 1);
    setIsDropdownOpen(false);
    setQuickCreateOpen(true);
  };

  // Dùng controlled hoặc internal
  const quantity = isControlled ? externalQuantity : internalQuantity;
  const setQuantity = isControlled
    ? onQuantityChange
    : setInternalQuantity;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const internalQuantityRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = externalQuantityRef ?? internalQuantityRef;
  const dropdownRef = useRef<HTMLDivElement>(null);


  const filteredProducts = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.includes(q))
      )
      .slice(0, 8);
  }, [products, searchQuery]);

  const resetSearch = () => {
    setSearchQuery('');
    setQuantity(1);
    setIsDropdownOpen(false);
    setSelectedIndex(0);
  };

  // ENTER LẦN 1: phân nhánh — hàng m² mở ngay F3, hàng thường nhảy sang ô SL
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredProducts.length === 0) {
      // Không có kết quả: Enter mở nhanh form tạo hàng hóa mới từ chuỗi đang tìm
      if (e.key === 'Enter' && searchQuery.trim()) {
        e.preventDefault();
        openQuickCreate(searchQuery);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredProducts.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredProducts.length) % filteredProducts.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selectedProduct = filteredProducts[selectedIndex] || filteredProducts[0];
      if (!selectedProduct) return;
      if (onPickProduct) {
        // Chế độ nhập kho: mọi loại hàng (kể cả m²) thêm thẳng theo SL, không mở F3
        onPickProduct(selectedProduct, quantity > 0 ? quantity : 1);
        resetSearch();
        searchInputRef.current?.focus();
        return;
      }
      if (selectedProduct.product_type === 'area') {
        setIsDropdownOpen(false);
        setSearchQuery('');
        setDimensionModalItem(createBlankAreaItem(selectedProduct, quantity));
      } else {
        // UX: commit tên hàng được chọn vào ô tìm kiếm (thay text dở chừng).
        // Lần 2 Enter thêm giỏ sẽ resetSearch() dọn sạch như cũ.
        setIsDropdownOpen(false);
        setSearchQuery(selectedProduct.name);
        quantityInputRef.current?.focus();
        quantityInputRef.current?.select();
      }
      return;
    }
    if (e.key === 'Escape') {
      resetSearch();
      searchInputRef.current?.focus();
    }
  };

  // ENTER LẦN 2 (ô SL): thêm vào giỏ, reset về F1
  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const selectedProduct = filteredProducts[selectedIndex] || filteredProducts[0];
      if (selectedProduct) {
        if (onPickProduct) onPickProduct(selectedProduct, quantity > 0 ? quantity : 1);
        else addItemToCart(selectedProduct, quantity > 0 ? quantity : 1);
      }
      resetSearch();
      searchInputRef.current?.focus();
    } else if (e.key === 'Escape') {
      resetSearch();
      searchInputRef.current?.focus();
    }
  };

  const handleSelectProductClick = (product: Product) => {
    if (onPickProduct) {
      onPickProduct(product, quantity > 0 ? quantity : 1);
      resetSearch();
      searchInputRef.current?.focus();
      return;
    }
    if (product.product_type === 'area') {
      setIsDropdownOpen(false);
      setSearchQuery('');
      setDimensionModalItem(createBlankAreaItem(product, 1));
    } else {
      addItemToCart(product, quantity > 0 ? quantity : 1);
      resetSearch();
      searchInputRef.current?.focus();
    }
  };

  // Tạo mới xong: nhánh như chọn sản phẩm thường (nhập kho / m² mở F3 / thêm giỏ)
  const handleQuickCreated = (product: Product) => {
    setQuickCreateOpen(false);
    if (onPickProduct) {
      onPickProduct(product, quantity > 0 ? quantity : 1);
    } else if (product.product_type === 'area') {
      setDimensionModalItem(createBlankAreaItem(product, quantity > 0 ? quantity : 1));
    } else {
      addItemToCart(product, quantity > 0 ? quantity : 1);
    }
    resetSearch();
    searchInputRef.current?.focus();
  };

  // Expose handleQuantityKeyDown cho parent khi ô SL render bên ngoài
  useImperativeHandle(ref, () => ({ handleQuantityKeyDown }));

  return (
    <div className="relative flex-1 min-w-0 w-full lg:min-w-[280px] flex items-center gap-1.5">
      {/* Ô tìm kiếm [F1] */}
      <div className="relative flex-1 min-w-0">
        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
          <Search className="w-3.5 h-3.5" />
        </div>
        <input
          ref={searchInputRef}
          id="f1-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsDropdownOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => {
            if (searchQuery.trim()) setIsDropdownOpen(true);
          }}
          onKeyDown={handleSearchKeyDown}
           placeholder="Tìm hàng hoặc quét mã..."
          title="Tìm sản phẩm (F1)"
          className="w-full h-10 sm:h-9 pl-8 pr-3 text-xs bg-white text-slate-800 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Ô số lượng nhanh — chỉ render ở đây nếu showQuantityInput=true (default) */}
      {showQuantityInput && (
        <div className="w-20 shrink-0">
          <input
            ref={quantityInputRef}
            id="quick-quantity-input"
            type="text"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              setQuantity(raw === '' ? 0 : parseInt(raw, 10));
            }}
            onFocus={(e) => e.target.select()}
            onBlur={() => setQuantity(quantity > 0 ? quantity : 1)}
            onKeyDown={handleQuantityKeyDown}
            placeholder="1"
            title="Số lượng nhanh (Enter để thêm vào giỏ)"
            className="w-full h-10 sm:h-9 px-2 text-center text-xs font-bold bg-white text-amber-600 border border-slate-300 rounded-lg focus:outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
      )}

      {/* Dropdown kết quả */}
      {isDropdownOpen && searchQuery.trim().length > 0 && (
        <div
          ref={dropdownRef}
          id="search-results-dropdown"
          className="absolute top-11 left-0 right-0 bg-white text-slate-800 shadow-2xl rounded-lg border border-slate-200 overflow-hidden z-50 animate-in fade-in-50 duration-100"
        >
          <div className="p-1.5 max-h-72 overflow-y-auto divide-y divide-slate-100">
            {filteredProducts.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-slate-500">
                Không tìm thấy <span className="font-semibold text-slate-700">&quot;{searchQuery.trim()}&quot;</span> trong danh mục.
              </div>
            )}
            {filteredProducts.map((prod, idx) => {
              const isSelected = idx === selectedIndex;
              const isArea = prod.product_type === 'area';
              return (
                <div
                  key={prod.id}
                  id={`search-item-${prod.sku}`}
                  onClick={() => handleSelectProductClick(prod)}
                  className={`p-2 rounded-md flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold ${
                        isArea
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : prod.product_type === 'combo'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {isArea ? 'm²' : prod.product_type === 'combo' ? 'CB' : 'SP'}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        {prod.name}
                        {isArea && (
                          <span className="px-1.5 py-0.2 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded">
                                                          Diện tích (F3)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                        <span>{prod.sku}</span>
                        <span>•</span>
                        <span>Tồn: {prod.stock_quantity} {prod.unit}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-blue-600">
                      {formatVND(prod.retail_price)}
                      <span className="text-[10px] text-slate-400 font-normal">/{prod.unit}</span>
                    </div>
                    {isArea ? (
                      <span className="text-[10px] text-amber-600 font-semibold">[Enter] Mở F3</span>
                    ) : (
                      <span className="text-[10px] text-emerald-600">[Enter] Nhập SL</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div
              id="btn-quick-create-product"
              onClick={() => openQuickCreate(searchQuery)}
              className="mt-1 p-2 rounded-md flex items-center gap-2.5 cursor-pointer bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
              title="Tạo hàng hóa mới từ chuỗi đang tìm"
            >
              <div className="w-7 h-7 rounded bg-amber-100 text-amber-800 border border-amber-300 flex items-center justify-center">
                <PackagePlus className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-amber-800">
                  Tạo hàng hóa mới: &quot;{searchQuery.trim()}&quot;
                </div>
                <div className="text-[11px] text-amber-600">Thêm vào danh mục rồi bán ngay (Enter)</div>
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Dùng phím ↑ ↓ để chọn • Enter lần 1 phân nhánh • Esc để hủy</span>
            <span className="font-medium text-blue-600">Double-Enter Active</span>
          </div>
        </div>
      )}

      {/* Tạo nhanh hàng hóa — dùng đúng form "Thêm Hàng Hóa Mới" của Danh mục,
          seed Tên/SKU từ chuỗi đang tìm; remount theo key=seq mỗi lần mở */}
      <AddProductFormModal
        key={quickCreateSeq}
        open={quickCreateOpen}
        seedQuery={quickCreateSeed}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={handleQuickCreated}
      />
    </div>
  );
  } // end forwardRef render function
); // end forwardRef
