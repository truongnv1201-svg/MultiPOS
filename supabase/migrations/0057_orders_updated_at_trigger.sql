-- Migration 57 — đảm bảo orders.updated_at luôn được bump khi đơn hàng thay đổi.
-- Lý do: client đồng bộ delta theo updated_at (xem lib/store/tx/orders-sync.ts). Đơn hàng
-- KHÔNG phải append-only (đặt cọc -> hoàn thành -> hủy -> trả hàng), nên watermark
-- created_at sẽ bỏ sót thay đổi trên đơn cũ. Hiện RPC checkout_order / cancel_order /
-- return_order_items tự set updated_at, nhưng đó là quy ước theo tay — thêm một UPDATE
-- trực tiếp từ client là đồng bộ sai ngay mà không có dấu hiệu gì.
-- Trigger ở tầng DB chặn được cả các đường ghi đó. Idempotent, chạy lại không lỗi.
CREATE OR REPLACE FUNCTION public.trg_orders_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_touch_updated_at ON public.orders;
CREATE TRIGGER trg_orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_touch_updated_at();
