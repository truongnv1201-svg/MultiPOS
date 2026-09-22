-- Migration 21 — Bỏ hẳn chức năng xin nghỉ phép (user chốt).
-- Quản lý chấm thủ công trực tiếp trên lưới công (PL/KL/L).
-- Xóa bảng leave_requests (policies đi kèm qua CASCADE). App không đọc/ghi bảng này nữa.

drop table if exists public.leave_requests cascade;
