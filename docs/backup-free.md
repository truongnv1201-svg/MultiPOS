# Sao lưu dữ liệu — bản FREE + ZERO-TOUCH (0đ, user không phải làm gì)

Mục tiêu: RPO 24h, RTO < 1h, không tốn phí, **không cần người thạo kỹ thuật ở quán**.

## 3 tầng (tất cả tự động)

| Tầng | Cái gì | Ở đâu | Tần suất | Người làm |
|---|---|---|---|---|
| 1. Dump server → B2 | `pg_dump` custom format, gzip, GPG AES256, tự xoay vòng | Backblaze B2 (off-site, khác hạ tầng Supabase) | Mỗi đêm 01:00 GMT+7 | GitHub Actions (tự động) |
| 1b. Dự phòng | Cùng file dump | GitHub Artifacts (tự xóa sau 30 ngày) | Theo tầng 1 | Tự động |
| 2. Tự verify | Restore thử vào Postgres dùng một lần + đếm bảng | Ngay trong Actions | Ngày 01 mỗi tháng | Tự động, hỏng báo đỏ |
| 3. Snapshot Supabase | Snapshot tay trên Dashboard | Supabase | Trước migration lớn (kỹ thuật làm từ xa) | Admin kỹ thuật |

File JSON tải tay ở Cài đặt giữ lại làm dự phòng khẩn cấp, **không còn là quy trình chính**.

## Cấu hình 1 lần (người bàn giao làm, user không đụng)

### A. Backblaze B2 (chỉ cần email, không cần thẻ)
1. Vào `backblaze.com/b2`, đăng ký tài khoản free.
2. B2 Cloud Storage → Buckets → Create a Bucket: tên `multipos-backup`, loại **Private**. Không cần chỉnh gì thêm (xoay vòng do workflow tự làm).
3. Mở bucket vừa tạo, copy **S3 Endpoint** (dạng `s3.us-west-00X.backblazeb2.com`) — region là cụm giữa (`us-west-00X`).
4. App Keys → Add a New Application Key: tên `multipos-backup`, cho phép bucket `multipos-backup`, quyền **Read and Write**, không đặt hạn. Copy ngay `keyID` + `applicationKey` (chỉ hiện 1 lần).

### B. Secrets trên GitHub (repo → Settings → Secrets and variables → Actions)
| Secret | Lấy ở đâu |
|---|---|
| `SUPABASE_DB_URL` | Supabase Dashboard → Project Settings → Database → Connection string, chế độ Direct |
| `BACKUP_PASSPHRASE` | Tự đặt cụm mật khẩu dài — **ghi giấy cất két, mất là không mở được file mã hóa** |
| `S3_ENDPOINT` | `https://<endpoint-B2>` (vd `https://s3.us-west-004.backblazeb2.com`) |
| `S3_REGION` | Cụm region trong endpoint (vd `us-west-004`) |
| `S3_ACCESS_KEY_ID` | keyID ở bước A.4 |
| `S3_SECRET_ACCESS_KEY` | applicationKey ở bước A.4 |
| `S3_BUCKET` | `multipos-backup` |

### C. Chạy thử
Actions → **Backup DB (free)** → Run workflow → xanh là xong. Actions → **Verify backup (free)** → Run workflow → xanh là file restore được.

## Xoay vòng tự động (không ai phải xóa tay)
- Giữ toàn bộ bản 30 ngày gần nhất.
- Bản ngày 01 (bản tháng) giữ 12 tháng.
- Còn lại tự xóa. Với DB ~60MB/bản: ~2,5GB/10GB free — đủ nhiều năm 1 cửa hàng.

## Khôi phục (kỹ thuật làm từ xa, user chỉ cần gọi)

**Giải mã:**
```bash
gpg -d multipos-2026-10-03.dump.gz.gpg > multipos-2026-10-03.dump.gz
gunzip multipos-2026-10-03.dump.gz
```

**Tải bản mới nhất từ B2:**
```bash
aws s3 cp s3://multipos-backup/daily/ ./ --recursive --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION"
```

**Restore ra database mới (KHÔNG restore đè production khi chưa chắc):**
```bash
pg_restore --no-owner --no-acl -d "postgresql://user:pass@new-host:5432/postgres" multipos-2026-10-03.dump
```
Kiểm tra: `SELECT count(*) FROM orders;` → trỏ app sang URL mới → bán thử 1 đơn test rồi hủy.

## Giám sát (về mail owner repo, user không nhận gì)
- Workflow fail → GitHub mail cho owner repo. Người bàn giao giữ quyền repo sau bàn giao, chỉ đọc mail khi có sự cố.
- Trường hợp duy nhất hay gặp: user đổi mật khẩu database → `SUPABASE_DB_URL` hết hiệu lực → backup fail → cập nhật lại secret là xong.

## Giới hạn bản free (biết để không bất ngờ)
- RPO 24h (mất tối đa 1 ngày dữ liệu server). Muốn từng phút phải lên Supabase Pro (PITR).
- B2 free 10GB — monitor dung lượng trên dashboard B2 mỗi quý.
- File `.dump` chứa dữ liệu bán hàng thật — key B2 + passphrase chỉ 2 người biết (chủ shop, kỹ thuật).
