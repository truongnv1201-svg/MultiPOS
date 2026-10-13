// Unit test cho lib/vietqr.ts (payload EMVCo VietQR tự vẽ, không dính mạng/DOM).
// Chạy: npm test (node --test scripts/vietqr.test.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc16ccitt,
  vietqrAddInfo,
  buildVietqrPayload,
  VIETQR_BANK_BINS,
} from '../lib/vietqr.ts';

// Parse TLV EMVCo phẳng: { id: value } (lồng nhau parse tiếp khi cần).
function tlv(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len) || len < 0 || i + 4 + len > s.length) break;
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return { fields: out, rest: s.slice(i) };
}

const cfg = { bank: 'MB', account: '0354464688', name: 'Nguyen Van Son' };

describe('crc16ccitt', () => {
  it('vector chuẩn "123456789" -> 0x29B1', () => {
    assert.equal(crc16ccitt('123456789'), 0x29b1);
  });
  it('khớp bản cài bảng độc lập (chéo 2 implement)', () => {
    const table = (() => {
      const t = new Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n << 8;
        for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
        t[n] = c;
      }
      return t;
    })();
    const samples = ['00020101021138570010A000000727', 'HD2610130005 MULTIPOS', '9704220354464688'];
    for (const s of samples) {
      let c = 0xffff;
      for (let i = 0; i < s.length; i++) c = ((c << 8) ^ table[((c >> 8) ^ s.charCodeAt(i)) & 0xff]) & 0xffff;
      assert.equal(crc16ccitt(s), c, `lệch CRC ở ${s}`);
    }
  });
  it('CRC cuối payload tính lại khớp (EMVCo: CRC trên thân + "6304")', () => {
    for (const p of [buildVietqrPayload(cfg, 85500, 'HD-001 MULTIPOS'), buildVietqrPayload(cfg)]) {
      assert.ok(p);
      const body = p.slice(0, -4); // thân + "6304"
      assert.ok(body.endsWith('6304'));
      assert.equal(
        crc16ccitt(body).toString(16).toUpperCase().padStart(4, '0'),
        p.slice(-4)
      );
    }
  });
});

describe('vietqrAddInfo', () => {
  it('không dấu, chỉ giữ chữ/số/cách, tối đa 25 ký tự', () => {
    assert.equal(vietqrAddInfo('Nguyễn Văn Sơn!'), 'Nguyen Van Son');
    assert.equal(vietqrAddInfo('HD-261013-0005 MULTIPOS'), 'HD2610130005 MULTIPOS'.slice(0, 25));
    assert.equal(vietqrAddInfo(''), 'THANHTOAN');
  });
});

describe('buildVietqrPayload', () => {
  it('khung EMVCo: 00=01, 01=11, 52/53/58 đúng, CRC cuối 4 hex hoa', () => {
    const p = buildVietqrPayload(cfg, 85500, 'HD-001');
    assert.ok(p);
    assert.match(p, /^00020101021138/);
    assert.match(p, /52040000/);
    assert.match(p, /5303704/);
    assert.match(p, /5802VN/);
    assert.match(p, /6304[0-9A-F]{4}$/);
  });

  it('nhúng đúng BIN + STK trong nhánh Napas (38)', () => {
    const p = buildVietqrPayload(cfg, 85500, 'HD-001');
    const top = tlv(p).fields;
    const guid = tlv(top['38']).fields;
    assert.equal(guid['00'], 'A000000727');
    const acct = tlv(guid['01']).fields;
    assert.equal(acct['00'], VIETQR_BANK_BINS.MB);
    assert.equal(acct['01'], '0354464688');
  });

  it('số tiền + tên + nội dung CK đúng TLV', () => {
    const p = buildVietqrPayload(cfg, 85500, 'HD-001 MULTIPOS');
    const top = tlv(p).fields;
    assert.equal(top['54'], '85500');
    assert.equal(top['59'], 'NGUYEN VAN SON');
    assert.equal(tlv(top['62']).fields['08'], 'HD001 MULTIPOS');
  });

  it('không truyền tiền thì bỏ field 54 (QR tĩnh dùng chung)', () => {
    const p = buildVietqrPayload(cfg);
    assert.ok(p);
    assert.ok(!('54' in tlv(p).fields), 'không được có field 54');
    const body = p.slice(0, -4);
    assert.equal(
      crc16ccitt(body).toString(16).toUpperCase().padStart(4, '0'),
      p.slice(-4)
    );
  });

  it('ngân hàng lạ / STK sai -> null (UI không vẽ QR giả)', () => {
    assert.equal(buildVietqrPayload({ bank: 'XXX', account: '0354464688', name: 'A' }), null);
    assert.equal(buildVietqrPayload({ bank: 'MB', account: 'abc', name: 'A' }), null);
    assert.equal(buildVietqrPayload({ bank: 'MB', account: '12345', name: 'A' }), null);
  });

  it('đủ BIN cho mọi ngân hàng trong dropdown cài đặt', () => {
    for (const code of ['MB', 'VCB', 'TCB', 'ACB', 'BIDV', 'VPB', 'TPB', 'STB', 'HDB', 'SHB', 'MSB', 'OCB']) {
      assert.match(VIETQR_BANK_BINS[code] || '', /^9704\d{2}$/, `thiếu BIN ${code}`);
    }
  });
});
