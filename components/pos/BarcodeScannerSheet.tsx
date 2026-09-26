'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, ScanLine, X } from 'lucide-react';

// Giai đoạn 3: quét mã vạch bằng camera sau.
// Ưu tiên API gốc BarcodeDetector (không thêm dependency); trình duyệt không có
// hoặc bị từ chối quyền camera -> tự chuyển sang nhập tay mã (bàn phím Wedge vẫn chạy).
type BarcodeFormat =
  | 'aztec' | 'code_128' | 'code_39' | 'code_93' | 'codabar' | 'data_matrix'
  | 'ean_13' | 'ean_8' | 'itf' | 'pdf417' | 'qr_code' | 'upc_a' | 'upc_e';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: BarcodeFormat[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<BarcodeFormat[]>;
}

const FORMATS: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

interface BarcodeScannerSheetProps {
    open: boolean;
    onClose: () => void;
    onDetected: (code: string) => void;
}

export function BarcodeScannerSheet({ open, onClose, onDetected }: BarcodeScannerSheetProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const timerRef = useRef<number | null>(null);
    const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'manual' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [manualCode, setManualCode] = useState('');
    const [supported, setSupported] = useState(true);

    const stopStream = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const close = useCallback(() => {
        stopStream();
        setStatus('idle');
        setMessage('');
        setManualCode('');
        onClose();
    }, [onClose, stopStream]);

    const start = useCallback(async () => {
        const ctor = getDetectorCtor();
        if (!ctor) {
            setSupported(false);
            setStatus('manual');
            setMessage('Trình duyệt này chưa hỗ trợ đọc mã vạch bằng camera — nhập tay mã hoặc dùng máy quét.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            setSupported(false);
            setStatus('manual');
            setMessage('Máy này không có camera hoặc trình duyệt chặn truy cập camera.');
            return;
        }

        setStatus('starting');
        setMessage('Đang mở camera...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play().catch(() => {});
            }

            const detector = new ctor({ formats: FORMATS });
            setStatus('scanning');
            setMessage('Đưa mã vạch vào khung hình.');
            timerRef.current = window.setInterval(async () => {
                const video = videoRef.current;
                if (!video || video.readyState < 2) return;
                try {
                    const codes = await detector.detect(video);
                    const value = codes[0]?.rawValue?.trim();
                    if (value) {
                        stopStream();
                        onDetected(value);
                    }
                } catch {
                    // Khung hình chưa sẵn sàng — bỏ qua, vòng lặp sau thử lại.
                }
            }, 350);
        } catch (e: unknown) {
            const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
            setSupported(false);
            setStatus('manual');
            setMessage(denied ? 'Chưa được cấp quyền camera — nhập tay mã hoặc dùng máy quét.' : 'Không mở được camera — nhập tay mã hoặc dùng máy quét.');
        }
    }, [onDetected, stopStream]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        const timer = window.setTimeout(() => {
            if (active) void start();
        }, 0);
        return () => {
            active = false;
            window.clearTimeout(timer);
            stopStream();
        };
    }, [open, start, stopStream]);

    if (!open) return null;

    return (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Quét mã vạch">
            <button type="button" className="absolute inset-0 bg-slate-900/60" onClick={close} aria-label="Đóng" />
            <div className="relative w-full rounded-t-2xl bg-white shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <ScanLine className="w-4 h-4 text-blue-600" />
                            Quét mã vạch
                        </h2>
                        <p className="text-[11px] text-slate-500 font-medium truncate">{message}</p>
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                        aria-label="Đóng quét mã"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 py-3 space-y-3">
                    {supported && (
                        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-900">
                            <video
                                ref={videoRef}
                                className="h-full w-full object-cover"
                                playsInline
                                muted
                                aria-label="Khung hình camera"
                            />
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <div className="w-3/4 h-1/3 border-2 border-emerald-400/90 rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                            </div>
                        </div>
                    )}

                    {!supported && (
                        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                            <CameraOff className="w-4 h-4 shrink-0" />
                            <span>{message}</span>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Keyboard className="w-4 h-4 text-slate-400 shrink-0" />
                        <input
                            id="barcode-manual-input"
                            type="text"
                            inputMode="numeric"
                            value={manualCode}
                            onChange={(e) => setManualCode(e.target.value)}
                            placeholder="Nhập mã vạch/SKU bằng tay"
                            className="h-11 flex-1 px-3 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden"
                        />
                        <button
                            type="button"
                            id="btn-barcode-manual-submit"
                            onClick={() => manualCode.trim() && onDetected(manualCode.trim())}
                            disabled={!manualCode.trim()}
                            className="shrink-0 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white active:bg-blue-700 disabled:bg-slate-300"
                        >
                            <Camera className="w-4 h-4" />
                            Dùng
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
