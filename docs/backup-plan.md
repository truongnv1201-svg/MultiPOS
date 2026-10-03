# KẾ HOẠCH BACKUP & KHÔI PHỤC DỮ LIỆU MultiPOS

Phiên bản: 2.0 ZERO-TOUCH (dự thảo chờ duyệt) — Ngày lập: 03/10/2026
Thay đổi so với v1.0: bỏ toàn bộ bước tay hàng tuần (user không thạo kỹ thuật, không có bảo trì) → mọi thứ tự động, hỏng báo về người bàn giao.

## 1. Mục tiêu

| Chỉ tiêu | Giá trị | Diễn giải |
|---|---|---|
| RPO | ≤ 24 giờ | Mất tối đa 1 ngày dữ liệu server khi sự cố |
| RTO | ≤ 1 giờ | Từ lúc phát hiện đến khi bán hàng trở lại (kỹ thuật xử lý từ xa) |
| Chi phí | 0đ/tháng | GitHub Actions free + Backblaze B2 free 10GB |
| Phạm vi | Toàn bộ Postgres Supabase | Đơn hàng, kho, quỹ, công nợ, nhân sự, chấm công, công trình |
| Gánh nặng user | **0 việc định kỳ** | User chỉ bán hàng; sự cố thì gọi kỹ thuật |

## 2. Kiến trúc (tất cả tự động)

```
Dump đêm 01:00 GMT+7 (GitHub Actions)
  Supabase Postgres ──pg_dump + gzip + GPG──▶ B2 s3://multipos-backup/daily/ (trụ chính, xoay vòng tự động)
                                        └────▶ GitHub Artifacts 30 ngày (dự phòng)
Verify ngày 01 hàng tháng (GitHub Actions): tải bản mới nhất → restore thử → đếm bảng → đỏ nếu hỏng
```

Nguyên tắc: **không tầng nào nằm chung hạ tầng với tầng khác** (Supabase ≠ GitHub ≠ B2). Trụ chính không phụ thuộc quán mở hay tắt. Nút tải JSON ở Cài đặt giữ lại làm dự phòng khẩn cấp, không phải quy trình chính.

## 3. Lịch chạy (máy làm, người không làm)

| Việc | Tần suất | Ai làm |
|---|---|---|
| Dump server → B2 + Artifacts, xoay vòng 30 ngày + 12 tháng | Mỗi đêm 01:00 GMT+7 + bấm tay khi cần | Actions (tự động) |
| Verify restore thử | Ngày 01 mỗi tháng | Actions (tự động) |
| Đọc mail fail (chỉ khi có sự cố) | Khi GitHub báo đỏ | Người bàn giao (giữ quyền repo) |
| Snapshot Supabase Dashboard | Trước migration lớn | Kỹ thuật từ xa |

## 4. Chính sách giữ bản (workflow tự xóa, ước tính với DB ~60MB/bản nén)

30 bản ngày gần nhất + bản ngày 01 giữ 12 tháng ≈ **2,5GB / 10GB B2 free** — đủ nhiều năm 1 cửa hàng.

## 5. Quy trình khôi phục (kỹ thuật làm từ xa, user chỉ cần gọi điện)

1. Tải bản mới nhất từ B2, giải mã bằng `BACKUP_PASSPHRASE` (chi tiết lệnh trong `docs/backup-free.md`).
2. Restore ra database mới, kiểm tra `SELECT count(*) FROM orders`, trỏ app sang URL mới, bán thử 1 đơn test rồi hủy.
3. **Tuyệt đối không restore đè production khi chưa verify trên DB trống.**
4. Ghi 1 dòng vào sổ sự cố (mục 7).

## 6. Giám sát & bí mật

- Mọi fail báo về mail owner repo (người bàn giao). User ở quán không nhận, không phải hiểu cảnh báo.
- Sự cố hay gặp duy nhất: user đổi mật khẩu database → `SUPABASE_DB_URL` hết hiệu lực → cập nhật lại secret là xong.
- Secret (`SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, key B2) nằm trong GitHub Secrets + passphrase ghi giấy cất két. Lộ key = làm lại toàn bộ + đổi password DB.

## 7. Sổ sự cố (mẫu)

| Ngày | Người xử lý | Sự cố | Bản dùng để khôi phục | Kết quả | Rút kinh nghiệm |
|---|---|---|---|---|---|
| … | | | | | |

## 8. Vai trò

| Ai | Việc |
|---|---|
| Chủ shop / nhân viên quán | Không có việc định kỳ. Mất dữ liệu thì gọi kỹ thuật |
| Người bàn giao (kỹ thuật) | Cấu hình 1 lần; đọc mail fail; test restore định kỳ đã tự động; khôi phục từ xa khi gọi |

## 9. Cần chuẩn bị trước khi vận hành (làm 1 lần)

- [ ] Tạo bucket B2 + app key (hướng dẫn trong `docs/backup-free.md`, chỉ cần email).
- [ ] Thêm 7 secret vào GitHub repo (`SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`).
- [ ] Run thử workflow Backup + Verify → cả 2 xanh.
- [ ] Chủ shop duyệt văn bản này.

---
**Duyệt:** Chủ shop xác nhận ☐ &nbsp;&nbsp; **Ngày hiệu lực:** …/…/…
