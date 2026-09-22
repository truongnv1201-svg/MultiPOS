'use client';

import React from 'react';
import { FileSpreadsheet, Printer, Upload, FileDown } from 'lucide-react';

// Cụm nút Xuất Excel / In bảng / Nhập Excel / Tải mẫu — dùng chung mọi trang có bảng dữ liệu.
export function TableTools({
  onExportExcel,
  onPrint,
  onImportExcel,
  onDownloadTemplate,
  importing = false,
}: {
  onExportExcel: () => void;
  onPrint: () => void;
  onImportExcel?: (file: File) => void;
  onDownloadTemplate?: () => void;
  importing?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 ml-auto shrink-0">
      {onDownloadTemplate && (
        <button
          type="button"
          onClick={onDownloadTemplate}
          className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-600 hover:bg-slate-100 font-medium flex items-center gap-1 transition-colors"
          title="Tải file Excel mẫu để nhập liệu"
        >
          <FileDown className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Mẫu</span>
        </button>
      )}
      {onImportExcel && (
        <label
          className={`h-8 px-2.5 text-xs bg-white border border-blue-300 rounded-md text-blue-700 hover:bg-blue-50 font-medium flex items-center gap-1 transition-colors cursor-pointer ${
            importing ? 'opacity-50 pointer-events-none' : ''
          }`}
          title="Nhập dữ liệu từ file Excel"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{importing ? 'Đang nhập…' : 'Nhập'}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onImportExcel(f);
            }}
          />
        </label>
      )}
      <button
        type="button"
        onClick={onExportExcel}
        className="h-8 px-2.5 text-xs bg-white border border-emerald-300 rounded-md text-emerald-700 hover:bg-emerald-50 font-medium flex items-center gap-1 transition-colors"
        title="Xuất bảng đang xem ra file Excel"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">Excel</span>
      </button>
      <button
        type="button"
        onClick={onPrint}
        className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-600 hover:bg-slate-100 font-medium flex items-center gap-1 transition-colors"
        title="In bảng đang xem"
      >
        <Printer className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">In</span>
      </button>
    </div>
  );
}
