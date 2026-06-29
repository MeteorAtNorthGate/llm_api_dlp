/** StatisticsPage — admin-only aggregated token consumption table. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/layout/Layout';
import Spinner from '../../components/ui/Spinner';
import { statsApi } from '../../services/api';
import useT from '../../hooks/useT';

function getDefaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function fmtNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

export default function StatisticsPage() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [startDate, setStartDate] = useState(getDefaultStart);
  const [endDate, setEndDate] = useState(getToday);
  const [search, setSearch] = useState('');
  const [expandedUsers, setExpandedUsers] = useState(new Set());

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await statsApi.getStats(startDate, endDate);
      setStats(data);
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
        err.message ||
        'Failed to load statistics'
      );
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const filteredUsers = useMemo(() => {
    if (!stats) return [];
    if (!search.trim()) return stats.users;
    const q = search.toLowerCase();
    return stats.users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q))
    );
  }, [stats, search]);

  const toggleExpand = (userId) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const isDateInvalid = startDate > endDate;

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
          <p className="text-base-content/60">
            {t('stats.desc')}
          </p>
        </div>

        {/* Controls */}
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="form-control">
                <label className="label pb-1">
                  <span className="label-text text-xs font-semibold">{t('stats.startDate')}</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate}
                />
              </div>
              <div className="form-control">
                <label className="label pb-1">
                  <span className="label-text text-xs font-semibold">{t('stats.endDate')}</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={getToday()}
                />
              </div>
              <div className="form-control flex-1 min-w-[200px]">
                <label className="label pb-1">
                  <span className="label-text text-xs font-semibold">{t('stats.searchUsers')}</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm"
                  placeholder={t('stats.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="form-control">
                <label className="label pb-1 invisible">
                  <span className="label-text text-xs">Action</span>
                </label>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={fetchStats}
                  disabled={isDateInvalid || loading}
                >
                  {loading ? t('stats.loading') : t('stats.refresh')}
                </button>
              </div>
            </div>
            {isDateInvalid && (
              <p className="text-error text-xs mt-2">
                {t('stats.dateError')}
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {error && !loading && (
          <div className="alert alert-error">
            <span>{error}</span>
            <button className="btn btn-sm btn-ghost" onClick={fetchStats}>
              {t('stats.retry')}
            </button>
          </div>
        )}

        {!loading && !error && stats && filteredUsers.length === 0 && (
          <div className="text-center py-16 text-base-content/50">
            {stats.users.length === 0
              ? t('stats.noData')
              : t('stats.noMatch')}
          </div>
        )}

        {!loading && !error && filteredUsers.length > 0 && (
          <div className="card bg-base-100 shadow-sm border border-base-300 overflow-hidden">
            {/* Grand total banner */}
            <div className="bg-base-200 px-5 py-3 flex items-center justify-between text-sm">
              <span>
                <span className="font-semibold">{stats.total_users}</span> {t('stats.users')}
                &middot;{' '}
                <span className="font-semibold">
                  {fmtNum(stats.grand_total_tokens)}
                </span>{' '}
                {t('stats.totalTokens')}
              </span>
              <span className="text-base-content/60 text-xs">
                {stats.start_date} – {stats.end_date}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th className="w-10"></th>
                    <th>{t('stats.user')}</th>
                    <th className="text-right">{t('stats.inputMiss')}</th>
                    <th className="text-right">{t('stats.inputHit')}</th>
                    <th className="text-right">{t('stats.output')}</th>
                    <th className="text-right">{t('stats.total')}</th>
                    <th className="w-48">{t('stats.percentTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <UserRow
                      key={user.user_id}
                      user={user}
                      isExpanded={expandedUsers.has(user.user_id)}
                      onToggle={() => toggleExpand(user.user_id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function UserRow({ user, isExpanded, onToggle }) {
  const hasKeys = user.api_keys && user.api_keys.length > 0;

  return (
    <>
      {/* User (chat) row */}
      <tr className={hasKeys ? 'cursor-pointer' : ''} onClick={hasKeys ? onToggle : undefined}>
        <td>
          {hasKeys && (
            <span className={`text-xs transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>
              ▶
            </span>
          )}
        </td>
        <td>
          <Link
            to={`/usage/${user.user_id}`}
            className="link link-hover link-primary font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {user.username}
          </Link>
        </td>
        <td className="text-right font-mono text-sm">
          {fmtNum(user.input_tokens_cache_miss)}
        </td>
        <td className="text-right font-mono text-sm">
          {fmtNum(user.input_tokens_cache_hit)}
        </td>
        <td className="text-right font-mono text-sm">
          {fmtNum(user.output_tokens)}
        </td>
        <td className="text-right font-mono text-sm font-semibold">
          {fmtNum(user.total_tokens)}
        </td>
        <td>
          <div className="flex items-center gap-2">
            <progress
              className="progress progress-primary w-24"
              value={user.token_percent}
              max="100"
            />
            <span className="text-xs font-mono w-14 text-right">
              {user.token_percent.toFixed(1)}%
            </span>
          </div>
        </td>
      </tr>

      {/* API key sub-rows */}
      {hasKeys && isExpanded && (
        <>
          {user.api_keys.map((key, idx) => (
            <tr key={`${user.user_id}-key-${idx}`} className="bg-base-200/50">
              <td></td>
              <td className="pl-6">
                <span className="text-base-content/60 text-sm">
                  🔑{' '}
                  {key.key_alias ? (
                    <span className="font-medium">{key.key_alias}</span>
                  ) : (
                    <span className="font-mono text-xs">sk-...{key.key_suffix}</span>
                  )}
                  {key.key_alias && (
                    <span className="font-mono text-xs text-base-content/40 ml-1">
                      (sk-...{key.key_suffix})
                    </span>
                  )}
                </span>
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(key.input_tokens_cache_miss)}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(key.input_tokens_cache_hit)}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(key.output_tokens)}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(key.total_tokens)}
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <progress
                    className="progress progress-accent w-24"
                    value={key.token_percent}
                    max="100"
                  />
                  <span className="text-xs font-mono w-14 text-right text-base-content/60">
                    {key.token_percent.toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
          {/* Subtotal row */}
          {user.api_keys.length > 1 && (
            <tr className="bg-base-200/30 text-base-content/60">
              <td></td>
              <td className="pl-6 text-xs italic">
                {t('stats.subtotal')}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(
                  user.api_keys.reduce((s, k) => s + k.input_tokens_cache_miss, 0)
                )}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(
                  user.api_keys.reduce((s, k) => s + k.input_tokens_cache_hit, 0)
                )}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(
                  user.api_keys.reduce((s, k) => s + k.output_tokens, 0)
                )}
              </td>
              <td className="text-right font-mono text-sm">
                {fmtNum(
                  user.api_keys.reduce((s, k) => s + k.total_tokens, 0)
                )}
              </td>
              <td></td>
            </tr>
          )}
        </>
      )}
    </>
  );
}
