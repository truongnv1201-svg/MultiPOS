-- Migration 63 — RPC xuất vật tư công trình (dùng cho tab POS "Xuất CT").
--
-- Vấn đề: store client (lib/store/tx/projects.tsx exportProjectMaterialBatch) chỉ ghi
-- LOCAL (Dexie + state). Mỗi lần syncProjects kéo bản server về là dòng vật tư vừa xuất
-- BỊ MẤT — đã kiểm chứng bằng trình duyệt: xuất xong tải lại là mất. Đó là lý do
-- "xuất vật tư khó dùng": thao tác tưởng thành công nhưng không bền, và máy khác không thấy.
--
-- Cách sửa: RPC ghi thật vào project_materials + tự trừ kho + ghi thẻ kho.
-- Ưu điểm so với đẩy cả dự án (sync_project_workspace): không đụng mã dự án nên nép được
-- lỗi trùng mã (409 -> PATCH đè dự án khác), và chỉ ghi đúng phần vật tư.
--
-- Lưu ý về trigger: migration 0040 đã BỎ trg_project_material_stock (chuyển trừ kho sang
-- RPC sync_project_workspace theo delta). Vì vậy hàm này phải TỰ trừ kho — nếu chỉ insert
-- vào project_materials thì tồn kho không đổi (đã kiểm chứng: 102 -> 102).
--
-- Kiểm soát (server là chân lý, không tin client):
-- 1) Chỉ authenticated (revoke PUBLIC — mặc định PostgreSQL cấp EXECUTE cho PUBLIC,
--    chỉ revoke từ anon là KHÔNG đủ: đã thử và anon vẫn gọi được và xuất kho).
-- 2) Khoá FOR UPDATE toàn bộ dòng kho liên quan TRƯỚC khi trừ -> 2 phiếu xuất song song
--    không lọt kẻ âm kho.
-- 3) Mỗi dòng: SKU phải tồn tại, số lượng > 0, tồn đủ; hàng dịch vụ/combo không xuất.
-- 4) unit_cost lấy products.avg_cost SERVER — đúng công thức project_pnl.material_cost
--    (giá bán không liên quan P&L công trình).
-- 5) Gộp trùng SKU trước khi ghi; mỗi dòng sinh đúng 1 thẻ kho.

CREATE OR REPLACE FUNCTION public.issue_project_materials(
  p_project_id UUID,
  p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
  v_pid UUID;
  v_name TEXT;
  v_unit TEXT;
  v_type TEXT;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_avg NUMERIC;
  v_inserted INT := 0;
  x JSONB;
  v_merged JSONB;
  v_sku TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Phiếu xuất vật tư trống';
  END IF;

  SELECT code INTO v_code FROM public.projects WHERE id = p_project_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Công trình không tồn tại (kiểm tra lại danh sách dự án)';
  END IF;

  -- Gộp dòng trùng SKU (client có thể gửi cùng hàng nhiều lần) -> [{sku, quantity}]
  -- Dùng alias `e` (không phải `it`): plpgsql thay biến trước nên tên trùng với alias
  -- bảng sẽ báo "column reference is ambiguous".
  SELECT jsonb_agg(jsonb_build_object('sku', e.sku, 'quantity', e.qty))
  INTO v_merged
  FROM (
    SELECT e2->>'sku' AS sku, SUM(COALESCE((e2->>'quantity')::NUMERIC, 0)) AS qty
    FROM jsonb_array_elements(p_items) e2
    GROUP BY e2->>'sku'
    HAVING SUM(COALESCE((e2->>'quantity')::NUMERIC, 0)) > 0
  ) e;
  IF v_merged IS NULL THEN
    RAISE EXCEPTION 'Phiếu xuất không có dòng nào có số lượng hợp lệ';
  END IF;

  -- Khoá kho trước khi trừ (chống âm kho khi 2 phiếu xuất cùng lúc)
  PERFORM 1
  FROM public.products p
  WHERE p.sku IN (SELECT e->>'sku' FROM jsonb_array_elements(v_merged) e)
  FOR UPDATE;

  FOR x IN SELECT * FROM jsonb_array_elements(v_merged) LOOP
    v_sku := x->>'sku';
    v_qty := COALESCE((x->>'quantity')::NUMERIC, 0);

    SELECT id, name, unit, product_type, stock_quantity, COALESCE(avg_cost, 0)
    INTO v_pid, v_name, v_unit, v_type, v_stock, v_avg
    FROM public.products p WHERE p.sku = v_sku;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'SKU % không tồn tại trong danh mục', v_sku;
    END IF;
    IF v_type IN ('service', 'combo') THEN
      RAISE EXCEPTION '%: hàng dịch vụ/combo không xuất cho công trình', v_sku;
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '%: số lượng xuất phải lớn hơn 0', v_sku;
    END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION '%: tồn kho không đủ (còn % %)', v_sku, v_stock, v_unit;
    END IF;

    INSERT INTO public.project_materials (project_id, product_id, sku, name, unit, quantity, unit_cost)
    VALUES (p_project_id, v_pid, v_sku, v_name, v_unit, v_qty, round(v_avg, 2));

    -- 0040 đã bỏ trigger trừ kho -> hàm này tự trừ + ghi thẻ kho (transaction chung).
    UPDATE public.products
    SET stock_quantity = stock_quantity - v_qty
    WHERE id = v_pid;

    INSERT INTO public.stock_movements (reference_code, product_id, quantity, previous_stock, new_stock, note)
    VALUES (v_code, v_pid, -v_qty, v_stock, v_stock - v_qty,
            'Xuất vật tư dự án ' || v_code);

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'project_code', v_code,
    'inserted', v_inserted
  );
END;
$$;

-- CHỈ authenticated: phải revoke PUBLIC (PostgreSQL cấp EXECUTE cho PUBLIC mặc định).
REVOKE EXECUTE ON FUNCTION public.issue_project_materials(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_project_materials(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_project_materials(UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
