'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * One floating readout for every chart mark inside it that has `data-tip` (and `data-tip-value`).
 * Works with touch (tap a mark), mouse (hover) and keyboard (focus). It only adds to what the labels and the
 * table view already show, so nothing depends on it.
 */
export function ChartTips({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ label: string; value: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const show = (e: Event) => {
      const mark = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!mark || !el.contains(mark)) return setTip(null);
      const r = mark.getBoundingClientRect(), o = el.getBoundingClientRect();
      setTip({ label: mark.dataset.tip ?? '', value: mark.dataset.tipValue ?? '', x: r.left + r.width / 2 - o.left, y: r.top - o.top });
    };
    const hide = () => setTip(null);
    el.addEventListener('pointerover', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('focusin', show);
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focusout', hide);
    return () => {
      el.removeEventListener('pointerover', show);
      el.removeEventListener('pointerdown', show);
      el.removeEventListener('focusin', show);
      el.removeEventListener('pointerleave', hide);
      el.removeEventListener('focusout', hide);
    };
  }, []);

  return (
    <div ref={box} className="chart-tips">
      {children}
      {tip && (
        <div className="chart-tip" role="status" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.value}</b><span>{tip.label}</span>
        </div>
      )}
    </div>
  );
}
