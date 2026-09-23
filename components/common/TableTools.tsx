'use client';

import React from 'react';
import { FileSpreadsheet, Printer, Upload, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';

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
        <Button variant="secondary" title="Tải file Excel mẫu để nhập liệu" onClick={onDownloadTemplate}>
          <FileDown className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Mẫu</span>
        </Button>
      )}
      {onImportExcel && (
        <label
          className={`h-8 px-2.5 text-xs bg-white border border-blue-300 rounded-md text-blue-700 hover:bg-blue-50 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
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
      <Button variant="outline-success" title="Xuất bảng đang xem ra file Excel" onClick={onExportExcel}>
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">Excel</span>
      </Button>
      <Button variant="secondary" title="In bảng đang xem" onClick={onPrint}>
        <Printer className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">In</span>
      </Button>
    </div>
  );
}
