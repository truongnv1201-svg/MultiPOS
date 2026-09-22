// Utilities for formatting currency, dimensions, and live input masking

export function formatVND(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0 đ';
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^\d.-]/g, '')) || 0 : value;
  return new Intl.NumberFormat('vi-VN').format(Math.round(num)) + ' đ';
}

export function formatNumber(value: number | string | undefined | null, decimals = 0): string {
  if (value === undefined || value === null || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^\d.-]/g, '')) || 0 : value;
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function parseFormattedNumber(formatted: string): number {
  if (!formatted) return 0;
  // Remove thousand dots and non-digits except decimal comma or minus
  const clean = formatted.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

// Live Input Masking for Vietnamese Dong with cursor retention
export function handleMoneyInputChange(
  e: React.ChangeEvent<HTMLInputElement>,
  onChangeValue: (numericValue: number) => void
) {
  const input = e.target;
  const originalValue = input.value;
  const originalCursor = input.selectionStart || 0;

  // Count non-digits before cursor
  const digitsBeforeCursor = originalValue.slice(0, originalCursor).replace(/[^\d]/g, '').length;

  // Extract raw numeric digits
  const rawDigits = originalValue.replace(/[^\d]/g, '');
  const numericValue = rawDigits ? parseInt(rawDigits, 10) : 0;

  // New formatted string
  const formatted = numericValue ? new Intl.NumberFormat('vi-VN').format(numericValue) : '';

  onChangeValue(numericValue);

  // Restore cursor position in next tick
  requestAnimationFrame(() => {
    let newCursor = 0;
    let countedDigits = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) {
        countedDigits++;
      }
      if (countedDigits === digitsBeforeCursor) {
        newCursor = i + 1;
        break;
      }
    }
    if (countedDigits < digitsBeforeCursor) {
      newCursor = formatted.length;
    }
    input.setSelectionRange(newCursor, newCursor);
  });
}
