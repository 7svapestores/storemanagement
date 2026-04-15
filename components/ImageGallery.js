'use client';
import { useEffect, useRef, useState } from 'react';

// Reusable lightbox carousel for one or many images.
// props:
//   images: array of strings (URLs) or { image_url, caption?, downloadName? }
//   isOpen: boolean
//   onClose: () => void
//   startIndex: number (default 0)
//   caption: optional global caption
export default function ImageGallery({ images, isOpen, onClose, startIndex = 0, caption }) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef(null);
  const touchEndX = useRef(null);

  useEffect(() => { setIndex(startIndex); }, [startIndex, isOpen]);

  // Push history entry so phone back button closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    try { window.history.pushState({ __imageGallery: true }, ''); } catch {}
    const onPop = () => onClose?.();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      try { if (window.history.state?.__imageGallery) window.history.back(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, images?.length]);

  const downloadImage = async (url, filename) => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('[gallery] download failed, falling back to open:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  if (!isOpen || !images || images.length === 0) return null;

  const normalized = images.map(i => typeof i === 'string' ? { image_url: i } : i);
  const total = normalized.length;
  const cur = normalized[Math.min(index, total - 1)] || normalized[0];

  const prev = () => setIndex(i => Math.max(0, i - 1));
  const next = () => setIndex(i => Math.min(total - 1, i + 1));

  const onTouchStart = (e) => { touchStartX.current = e.changedTouches[0].screenX; };
  const onTouchMove = (e) => { touchEndX.current = e.changedTouches[0].screenX; };
  const onTouchEnd = () => {
    const s = touchStartX.current, e = touchEndX.current;
    touchStartX.current = null; touchEndX.current = null;
    if (s == null || e == null) return;
    const dx = e - s;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) next(); else prev();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}
      >
        <div className="text-white text-[13px] font-semibold truncate mr-3">
          {cur.caption || caption || 'Image'} {total > 1 && <span className="text-white/60 ml-2">{index + 1} of {total}</span>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-2xl font-bold flex items-center justify-center flex-shrink-0"
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Image area + arrows */}
      <div
        className="flex-1 flex items-center justify-center px-2 overflow-auto relative"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {total > 1 && (
          <button
            onClick={prev}
            disabled={index === 0}
            aria-label="Previous image"
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/30 text-white text-3xl font-bold items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed z-10"
          >
            ‹
          </button>
        )}
        <img
          src={cur.image_url}
          alt={cur.caption || ''}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
        {total > 1 && (
          <button
            onClick={next}
            disabled={index === total - 1}
            aria-label="Next image"
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/30 text-white text-3xl font-bold items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed z-10"
          >
            ›
          </button>
        )}
      </div>

      {/* Dots indicator (mobile especially) */}
      {total > 1 && (
        <div className="flex justify-center gap-1.5 py-2" onClick={(e) => e.stopPropagation()}>
          {normalized.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to image ${i + 1}`}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}

      {/* Bottom action bar */}
      <div
        className="flex items-center justify-center gap-3 px-4 flex-wrap"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)', paddingTop: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => window.open(cur.image_url, '_blank', 'noopener,noreferrer')}
          className="text-white text-[12px] font-semibold underline underline-offset-2"
        >
          Open original
        </button>
        <button
          type="button"
          onClick={() => downloadImage(cur.image_url, cur.downloadName || `image-${index + 1}.jpg`)}
          className="text-white text-[12px] font-semibold underline underline-offset-2"
        >
          Download
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-lg bg-white text-black text-[13px] font-bold min-h-[44px]"
        >
          Close
        </button>
      </div>
    </div>
  );
}
