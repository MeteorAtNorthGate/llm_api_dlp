/** KeyCard — displays a single API key summary. */

import { formatDate } from '../../utils/format';
import useT from '../../hooks/useT';

export default function KeyCard({ keyData, onRevoke, onDelete }) {
  const t = useT();
  const isExpired = keyData.expires_at && new Date(keyData.expires_at) < new Date();
  const isInactive = !keyData.is_active || isExpired;

  return (
    <div className={`card bg-base-100 shadow-sm border ${isInactive ? 'border-error/30 opacity-60' : 'border-base-300'}`}>
      <div className="card-body p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-mono text-sm font-bold">
              sk-...{keyData.key_suffix}
            </h3>
            {keyData.key_alias && (
              <p className="text-sm text-base-content/70">{keyData.key_alias}</p>
            )}
          </div>
          <div className={`badge ${isInactive ? 'badge-error' : 'badge-success'} badge-sm`}>
            {isInactive ? t('keys.inactive') : t('keys.active')}
          </div>
        </div>

        <div className="text-xs text-base-content/60 mt-2 space-y-1">
          {keyData.models.length > 0 && (
            <div>
              <span className="font-medium">{t('keys.models_label')}:</span>{' '}
              {keyData.models.join(', ')}
            </div>
          )}
          {keyData.max_budget && (
            <div>
              <span className="font-medium">{t('keys.budget')}:</span> ${keyData.max_budget}
            </div>
          )}
          {keyData.rpm_limit && (
            <div>
              <span className="font-medium">{t('keys.rpm')}:</span> {keyData.rpm_limit}
            </div>
          )}
          <div>
            <span className="font-medium">{t('keys.created')}:</span>{' '}
            {formatDate(keyData.created_at)}
          </div>
          {keyData.expires_at && (
            <div>
              <span className="font-medium">{t('keys.expires')}:</span>{' '}
              {formatDate(keyData.expires_at)}
            </div>
          )}
        </div>

        <div className="card-actions justify-end mt-3 gap-2">
          {!isInactive && (
            <button
              className="btn btn-error btn-xs btn-outline"
              onClick={() => onRevoke(keyData.id)}
            >
              {t('keys.revoke')}
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs btn-outline text-base-content/50"
            onClick={() => onDelete(keyData.id)}
          >
            {t('keys.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
