// P2: notify trung tâm — toast + confirm/prompt non-blocking thay alert/confirm/prompt.
// Singleton module (không qua context) nên cả store slice cũng gọi được.
// UI render ở <Toaster/> (mount 1 lần trong app/page.tsx).
export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface DialogRequest {
  id: number;
  kind: 'confirm' | 'prompt';
  message: string;
  defaultValue?: string;
  danger?: boolean;
  okLabel?: string;
  cancelLabel?: string;
  resolve: (v: boolean | string | null) => void;
}

interface NotifySnapshot {
  toasts: ToastItem[];
  dialogs: DialogRequest[];
}

let toasts: ToastItem[] = [];
let dialogs: DialogRequest[] = [];
let snapshot: NotifySnapshot = { toasts, dialogs };
const listeners = new Set<() => void>();
let seq = 0;

function emit(): void {
  snapshot = { toasts, dialogs };
  listeners.forEach((fn) => fn());
}

export function subscribeNotify(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getNotifySnapshot(): NotifySnapshot {
  return snapshot;
}

// Toast: hiển thị message không chặn UI, tự ẩn sau vài giây.
export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = ++seq;
  toasts = [...toasts, { id, message, kind }].slice(-5);
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    kind === 'error' ? 6000 : 4000
  );
}

function pushDialog(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    const id = ++seq;
    dialogs = [...dialogs, { ...req, id, resolve }];
    emit();
  });
}

// confirm non-blocking — thay window.confirm (await kết quả).
export function confirmDialog(
  message: string,
  opts?: { danger?: boolean; okLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  return pushDialog({ kind: 'confirm', message, ...opts }) as Promise<boolean>;
}

// prompt non-blocking — thay window.prompt (await chuỗi hoặc null khi hủy).
export function promptDialog(message: string, defaultValue = ''): Promise<string | null> {
  return pushDialog({ kind: 'prompt', message, defaultValue }) as Promise<string | null>;
}

export function resolveDialog(id: number, value: boolean | string | null): void {
  const found = dialogs.find((d) => d.id === id);
  if (!found) return;
  dialogs = dialogs.filter((d) => d.id !== id);
  emit();
  found.resolve(value);
}
