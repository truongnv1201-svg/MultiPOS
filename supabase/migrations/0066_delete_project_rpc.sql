-- Migration 66 — Xoá dự án tạo nhầm (sửa/xoá thông tin dự án).
--
-- Vấn đề: tạo mới dự án mà gõ sai thông tin thì không có đường nào sửa (tên/chủ đầu tư/
-- địa chỉ) hay xoá dự án. updateProject chỉ dùng cho tài chính.
--
-- Xoá dự án là thao tác PHÁ HUỶ nên phải đúng theo thứ tự, trong 1 transaction:
-- 1) Chỉ Admin/Quản lý (is_manager) — thu ngân/worker không xoá được.
-- 2) Vật tư ĐÃ XUẤT cho dự án (dòng thường) phải HOÀN KHO đúng số lượng + ghi thẻ kho
--    đảo (movement_type='return', giống removeProjectLine ở client) — nếu không, tồn kho
--    mất đi một cách âm thầm. Dòng hao hụt (is_adjust) KHÔNG hoàn vì nó chưa từng trừ kho.
-- 3) Sổ điều chỉnh tồn (stock_adjustments) KHÔNG xoá theo: chỉ gỡ liên kết project_id
--    về NULL (thành hao hụt tồn kho chung) — nhật ký audit phải giữ, và FK không có
--    cascade nên không gỡ sẽ lỗi khoá ngoại.
-- 4) Dòng vật tư/thợ xoá theo (có cascade đỡ, nhưng xoá tường minh để đếm số dòng trả về).
-- 5) Các phiếu thu trong sổ quỹ GIỮ NGUYÊN (tiền đã thu là lịch sử dòng tiền, không được
--    xoá) — UI phải báo rõ điều này trong hộp xác nhận.
-- 6) REVOKE PUBLIC (bài học 0063: chỉ revoke anon là KHÔNG đủ).

CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
  v_name TEXT;
  v_mat INT := 0;
  v_workers INT := 0;
  v_restored INT := 0;
  v_unlinked INT := 0;
  r RECORD;
  v_stock NUMERIC;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Chỉ Admin/Quản lý được xoá dự án';
  END IF;

  SELECT code, name INTO v_code, v_name
  FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Dự án không tồn tại (có thể đã bị xoá)';
  END IF;

  -- Hoàn kho cho từng dòng vật tư ĐÃ XUẤT (bỏ qua dòng hao hụt is_adjust vì chưa từng trừ).
  FOR r IN
    SELECT product_id, sku, quantity FROM public.project_materials
    WHERE project_id = p_project_id AND NOT COALESCE(is_adjust, false)
  LOOP
    SELECT stock_quantity INTO v_stock FROM public.products WHERE id = r.product_id FOR UPDATE;
    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'Mặt hàng % không còn trong danh mục, không hoàn kho được', r.sku;
    END IF;
    UPDATE public.products
    SET stock_quantity = v_stock + r.quantity
    WHERE id = r.product_id;
    INSERT INTO public.stock_movements
      (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    VALUES (
      v_code, r.product_id, r.quantity, v_stock, v_stock + r.quantity,
      'Trả kho khi xoá dự án ' || v_code || ' (' || v_name || ')',
      'return'
    );
    v_restored := v_restored + 1;
  END LOOP;

  SELECT count(*) INTO v_mat FROM public.project_materials WHERE project_id = p_project_id;
  SELECT count(*) INTO v_workers FROM public.project_workers WHERE project_id = p_project_id;

  -- Giữ audit hao hụt, chỉ gỡ liên kết về kho chung
  UPDATE public.stock_adjustments SET project_id = NULL WHERE project_id = p_project_id;
  GET DIAGNOSTICS v_unlinked = ROW_COUNT;

  DELETE FROM public.project_materials WHERE project_id = p_project_id;
  DELETE FROM public.project_workers WHERE project_id = p_project_id;
  DELETE FROM public.projects WHERE id = p_project_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_code,
    'material_lines', v_mat,
    'worker_lines', v_workers,
    'restored_lines', v_restored,
    'unlinked_adjustments', v_unlinked
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_project(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_project(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_project(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
