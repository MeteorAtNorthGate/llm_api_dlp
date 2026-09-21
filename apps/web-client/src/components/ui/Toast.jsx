/**
 * Toast — a self-dismissing floating notice with a countdown bar.
 *
 * The bar starts at full width and shrinks from the right, so it reads as a
 * timer running out. The animation duration and the dismiss timer are driven by
 * the same `duration` prop so they cannot drift apart.
 */

import { useEffect, useState } from 'react';

export default function Toast({ message, duration = 6000, onDismiss }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Kick the transition off on the next frame, so the browser paints the
    // initial 100% width first — otherwise it collapses instantly.
    const frame = requestAnimationFrame(() => setProgress(0));
    const timer = setTimeout(onDismiss, duration);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [duration, onDismiss]);

  return (
    <div className="toast toast-end toast-bottom z-50">
      <div className="alert relative overflow-hidden shadow-lg max-w-sm">
        <span className="text-sm">{message}</span>
        <span
          className="absolute bottom-0 left-0 h-[3px] bg-primary transition-[width] ease-linear"
          style={{ width: `${progress}%`, transitionDuration: `${duration}ms` }}
        />
      </div>
    </div>
  );
}
