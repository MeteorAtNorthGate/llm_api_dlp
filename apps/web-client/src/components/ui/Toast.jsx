/** Toast notification component. */
import { useEffect, useState } from 'react';

export default function Toast({ message, type = 'info', onClose }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!visible) return null;

  const alerts = {
    info: 'alert-info',
    success: 'alert-success',
    warning: 'alert-warning',
    error: 'alert-error',
  };

  return (
    <div className="toast toast-end toast-bottom z-50">
      <div className={`alert ${alerts[type] || alerts.info}`}>
        <span>{message}</span>
        <button className="btn btn-ghost btn-xs" onClick={() => { setVisible(false); onClose?.(); }}>
          ✕
        </button>
      </div>
    </div>
  );
}
