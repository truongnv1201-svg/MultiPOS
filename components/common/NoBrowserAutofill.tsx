'use client';

import { useEffect } from 'react';

// Trình duyệt bật dropdown "Thông tin đã lưu" trên hầu hết ô text của app, đè lên gợi ý
// của chính app và nuốt phím mũi tên/Enter. Gắn autocomplete="off" cho mọi input/textarea
// ngay sau khi mount + theo dõi node mới (modal, sheet, màn hình render sau).
// Bỏ qua ô đã tự khai báo autocomplete (ô đăng nhập cần username/current-password) và ô
// mật khẩu; ô nào muốn giữ autofill thì thêm data-autofill.
const SKIP_TYPES = new Set([
  'password',
  'hidden',
  'file',
  'checkbox',
  'radio',
  'submit',
  'button',
  'reset',
  'range',
  'color',
]);

type Field = HTMLInputElement | HTMLTextAreaElement;

function turnOff(field: Field) {
  if (field.hasAttribute('autocomplete') || field.hasAttribute('data-autofill')) return;
  if (field instanceof HTMLInputElement && SKIP_TYPES.has((field.type || 'text').toLowerCase())) return;
  field.setAttribute('autocomplete', 'off');
}

function sweep(root: Element) {
  if (root.matches('input, textarea')) turnOff(root as Field);
  root.querySelectorAll<Field>('input, textarea').forEach(turnOff);
}

export function NoBrowserAutofill() {
  useEffect(() => {
    sweep(document.documentElement);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) sweep(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
