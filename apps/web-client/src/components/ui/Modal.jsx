/** Modal component — DaisyUI modal wrapper. */

import { useEffect } from 'react';
import useT from '../../hooks/useT';
import { Close } from './Icons';

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const t = useT();
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  return (
    <div className="modal modal-open">
      <div className={`modal-box ${sizes[size] || sizes.md}`}>
        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <Close size={16} />
        </button>
        {title && <h3 className="font-bold text-lg mb-4">{title}</h3>}
        {children}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
