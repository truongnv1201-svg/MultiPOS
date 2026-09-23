'use client';

import React, { forwardRef, useRef, useImperativeHandle, useCallback, useEffect, useState } from 'react';

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | string | undefined | null;
  onChange: (value: number) => void;
  allowDecimals?: boolean;
  maxDecimals?: number;
  suffix?: string;
  prefix?: string;
  containerClassName?: string;
}

/**
 * NumberInput - High-precision formatted numeric input with Vietnamese thousand separators (.)
 * - Formats inputs with thousand separators (e.g. 1.000.000)
 * - Retains cursor position seamlessly when typing, deleting, or pasting
 * - Backspace on thousand separators naturally removes the preceding digit
 * - Exposes clean numeric value to onChange
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    onChange,
    allowDecimals = false,
    maxDecimals = 2,
    suffix,
    prefix,
    className = '',
    containerClassName = '',
    placeholder = '0',
    disabled = false,
    min,
    max,
    onKeyDown,
    ...rest
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  // Affix absolute (suffix/prefix) đè lên chữ nếu input hẹp — tự chừa padding khi caller chưa đặt
  const needPr = !!suffix && !/(^|\s)pr-/.test(className);
  const needPl = !!prefix && !/(^|\s)pl-/.test(className);
  const affixCls = `${needPr ? 'pr-7 ' : ''}${needPl ? 'pl-7 ' : ''}${className}`;
  // min/max từ HTMLAttributes có kiểu string | number — chuẩn hóa về number để so sánh (fix tsc)
  const minNum = min === undefined || min === '' ? undefined : Number(min);
  const maxNum = max === undefined || max === '' ? undefined : Number(max);

  // Format a numeric value into string with thousand separators (useCallback để identity
  // ổn định cho effect sync bên dưới — exhaustive-deps).
  const formatToString = useCallback(
    (val: number | string | undefined | null): string => {
      if (val === undefined || val === null || val === '') return '';
      const num = typeof val === 'string' ? parseFloat(val.replace(/[^\d.-]/g, '')) : val;
      if (isNaN(num)) return '';
      if (num === 0 && val === '') return '';

      if (!allowDecimals) {
        return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(num));
      } else {
        return new Intl.NumberFormat('vi-VN', {
          maximumFractionDigits: maxDecimals,
        }).format(num);
      }
    },
    [allowDecimals, maxDecimals]
  );

  const parseRawNumber = useCallback(
    (str: string): number => {
      if (!str) return 0;
      if (!allowDecimals) {
        const clean = str.replace(/[^\d-]/g, '');
        const num = parseInt(clean, 10);
        return isNaN(num) ? 0 : num;
      } else {
        // In vi-VN, '.' is thousand separator, ',' is decimal point
        const normalized = str.replace(/\./g, '').replace(/,/g, '.');
        const clean = normalized.replace(/[^\d.-]/g, '');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
      }
    },
    [allowDecimals]
  );

  const [displayValue, setDisplayValue] = useState<string>(() => formatToString(value));

  // Sync internal displayValue when external value changes
  useEffect(() => {
    const formatted = formatToString(value);
    // Only update if not actively focused or if different parsed value
    if (document.activeElement !== inputRef.current) {
      setDisplayValue(formatted);
    } else {
      // While focused, only sync if the numeric value actually diverged
      const currentNumeric = parseRawNumber(displayValue);
      const targetNumeric = typeof value === 'number' ? value : parseFloat(String(value || 0));
      if (Math.abs(currentNumeric - targetNumeric) > (allowDecimals ? 0.001 : 0.5)) {
        setDisplayValue(formatted);
      }
    }
  }, [value, allowDecimals, maxDecimals, displayValue, formatToString, parseRawNumber]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const originalText = input.value;
    const originalCursor = input.selectionStart || 0;

    // Count numeric digits before cursor
    const digitsBeforeCursor = originalText.slice(0, originalCursor).replace(/[^\d]/g, '').length;

    // Extract digits and parse numeric value
    let numeric = parseRawNumber(originalText);

    if (minNum !== undefined && numeric < minNum && originalText !== '') {
      // Do not clamp immediately while user is typing 0
    }
    if (maxNum !== undefined && numeric > maxNum) {
      numeric = maxNum;
    }

    const formatted = originalText === '' ? '' : formatToString(numeric);
    setDisplayValue(formatted);
    onChange(numeric);

    // Restore cursor position in next animation frame
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
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

      inputRef.current.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enhanced backspace handling for thousand separators
    if (e.key === 'Backspace' && inputRef.current) {
      const start = inputRef.current.selectionStart;
      const end = inputRef.current.selectionEnd;

      // If cursor is right after a thousand separator '.'
      if (start !== null && start === end && start > 0) {
        if (displayValue[start - 1] === '.') {
          e.preventDefault();
          // Delete the digit before the dot
          const before = displayValue.slice(0, start - 2);
          const after = displayValue.slice(start);
          const newRaw = before + after;
          const numeric = parseRawNumber(newRaw);
          const formatted = newRaw === '' ? '' : formatToString(numeric);
          setDisplayValue(formatted);
          onChange(numeric);

          requestAnimationFrame(() => {
            if (inputRef.current) {
              const newPos = Math.max(0, start - 2);
              inputRef.current.setSelectionRange(newPos, newPos);
            }
          });
          return;
        }
      }
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Re-format cleanly on blur
    const numeric = parseRawNumber(displayValue);
    let finalVal = numeric;
    if (minNum !== undefined && finalVal < minNum) finalVal = minNum;
    if (maxNum !== undefined && finalVal > maxNum) finalVal = maxNum;

    setDisplayValue(formatToString(finalVal));
    onChange(finalVal);

    if (rest.onBlur) {
      rest.onBlur(e);
    }
  };

  const inputElement = (
    <input
      ref={inputRef}
      type="text"
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      value={displayValue}
      onChange={handleInputChange}
      onKeyDown={handleKeyDownInternal}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={affixCls}
      {...rest}
    />
  );

  if (suffix || prefix) {
    return (
      <div className={`relative flex items-center ${containerClassName}`}>
        {prefix && (
          <span className="absolute left-2.5 text-slate-400 pointer-events-none text-xs font-medium">
            {prefix}
          </span>
        )}
        {inputElement}
        {suffix && (
          <span className="absolute right-2.5 text-slate-400 pointer-events-none text-xs font-medium">
            {suffix}
          </span>
        )}
      </div>
    );
  }

  return inputElement;
});
