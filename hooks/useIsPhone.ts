'use client';

import { useState, useEffect } from 'react';

// Điện thoại = màn hình hẹp dưới md (Tailwind md = 768px).
// Dùng để khóa điện thoại vào đúng 1 màn POS (không bottom nav, không menu phân hệ).
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}
