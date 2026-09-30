// Guard cho đường in desktop (iframe ẩn) trong lib/excel.ts.
//
// Lỗi gốc: printDocumentViaIframe dựng iframe, ghi HTML, gắn afterprint... nhưng QUÊN
// gọi print(). Bấm nút In không hiện gì mà cũng không báo lỗi — chết trên MỌI trang
// dùng printTable ở desktop (toàn bộ nút In của TableTools).
// Vì headless không hiện dialog in nên không assert được hành vi runtime ở E2E;
// test này khóa source để không ai vô tình xóa dòng print() lần nữa.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('print desktop: printDocumentViaIframe phải gọi print()', () => {
  const src = read('lib/excel.ts');
  const at = src.indexOf('export function printDocumentViaIframe');
  assert.ok(at > 0, 'phải còn hàm printDocumentViaIframe');
  const body = src.slice(at, src.indexOf('/**', at) > 0 ? src.indexOf('/**', at) : undefined);

  it('gọi win.print() (đây chính là dòng từng bị thiếu)', () => {
    assert.match(body, /win\.print\(\)/, 'phải gọi print() trên cửa sổ iframe');
  });

  it('in SAU khi đã ghi xong tài liệu (gọi ngay sẽ ra trang trắng)', () => {
    // win.print() nằm trong doPrint; doPrint chỉ CHẠY qua onload (bắn sau doc.close)
    // hoặc timeout fallback. Handler onload phải đăng ký trước khi ghi (đúng thứ tự
    // source: onload -> open/write/close -> setTimeout fallback).
    const doPrintAt = body.indexOf('const doPrint');
    const onloadAt = body.indexOf('iframe.onload = doPrint');
    const openAt = body.indexOf('doc.open()');
    const closeAt = body.indexOf('doc.close()');
    const fallbackAt = body.indexOf('setTimeout(doPrint');
    assert.ok(doPrintAt > 0 && onloadAt > 0 && openAt > 0 && closeAt > 0 && fallbackAt > 0);
    assert.ok(onloadAt < openAt, 'đăng ký onload trước khi ghi để không lỡ sự kiện load');
    assert.ok(closeAt < fallbackAt, 'đóng tài liệu trước rồi mới hẹn fallback');
    const doPrintBody = body.slice(doPrintAt, body.indexOf('};', doPrintAt));
    assert.match(doPrintBody, /win\.print\(\)/, 'chính doPrint phải gọi print()');
  });

  it('chống in 2 lần (onload + fallback timeout đều có thể bắn)', () => {
    assert.match(body, /printed/, 'phải có cờ chống in trùng');
  });

  it('vẫn dọn iframe sau khi in (afterprint + fallback)', () => {
    assert.match(body, /addEventListener\('afterprint', cleanup\)/);
    assert.match(body, /iframe\.remove\(\)/);
  });

  it('nhánh mobile giữ nguyên đường tab in (không đụng)', () => {
    assert.match(src, /if \(isMobileViewport\(\)\)/);
    assert.match(src, /printHtmlInTab\(preview, title\)/);
  });
});
