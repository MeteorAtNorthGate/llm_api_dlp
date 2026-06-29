/** UsagePage — per-user token usage with daily line chart.
 *
 *  - /usage          → current user's own usage (any authenticated user)
 *  - /usage/:userId  → admin viewing another user's usage
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Layout from '../../components/layout/Layout';
import Spinner from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/useAuth';
import { statsApi } from '../../services/api';
import useT, { useMessages } from '../../hooks/useT';

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

function StatBox({ label, value, colorClass }) {
  return (
    <div className="stat p-3 bg-base-200 rounded-lg">
      <div className="stat-title text-xs text-base-content/60">{label}</div>
      <div className={`stat-value text-xl ${colorClass || ''}`}>
        {fmtNum(value)}
      </div>
    </div>
  );
}

export default function UsagePage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const messages = useMessages();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [startDate, setStartDate] = useState(getDefaultStart);
  const [endDate, setEndDate] = useState(getToday);

  const isAdmin = user?.groups?.includes('admins');
  const isViewingOther = !!userId;

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (userId) {
        data = await statsApi.getUserUsage(userId, startDate, endDate);
      } else {
        data = await statsApi.getMyUsage(startDate, endDate);
      }
      setUsage(data);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 403 && !isAdmin) {
        setError(t('usage.onlyOwn'));
        navigate('/usage', { replace: true });
        return;
      }
      setError(detail || err.message || 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [userId, startDate, endDate, isAdmin, navigate]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const isDateInvalid = startDate > endDate;

  // Transform daily data for Recharts (ensure numeric values, use translated labels)
  const chartData = (usage?.daily_usage || []).map((d) => ({
    date: d.date,
    [messages['usage.inputMiss']]: d.input_tokens_cache_miss,
    [messages['usage.inputHit']]: d.input_tokens_cache_hit,
    [messages['usage.output']]: d.output_tokens,
  }));

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">
            {isViewingOther && usage
              ? `${t('usage.titleOther')}: ${usage.username}`
              : t('usage.title')}
          </h1>
          <p className="text-base-content/60">
            {t('usage.desc')}
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
              <div className="form-control">
                <label className="label pb-1 invisible">
                  <span className="label-text text-xs">{t('stats.refresh')}</span>
                </label>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={fetchUsage}
                  disabled={isDateInvalid || loading}
                >
                  {loading ? t('stats.loading') : t('stats.refresh')}
                </button>
              </div>
              {isViewingOther && isAdmin && (
                <div className="form-control">
                  <label className="label pb-1 invisible">
                    <span className="label-text text-xs">{t('common.back')}</span>
                  </label>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => navigate('/statistics')}
                  >
                    {t('usage.backToStats')}
                  </button>
                </div>
              )}
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
            <button className="btn btn-sm btn-ghost" onClick={fetchUsage}>
              {t('stats.retry')}
            </button>
          </div>
        )}

        {!loading && !error && usage && chartData.length === 0 && (
          <div className="text-center py-16 text-base-content/50">
            <p>{t('stats.noData')}</p>
          </div>
        )}

        {!loading && !error && usage && chartData.length > 0 && (
          <>
            {/* Summary Card */}
            <div className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body p-5">
                <h2 className="card-title text-base">{t('usage.summary')}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                  <StatBox
                    label={messages['usage.inputMiss']}
                    value={usage.summary.input_tokens_cache_miss}
                    colorClass="text-primary"
                  />
                  <StatBox
                    label={messages['usage.inputHit']}
                    value={usage.summary.input_tokens_cache_hit}
                    colorClass="text-success"
                  />
                  <StatBox
                    label={messages['usage.output']}
                    value={usage.summary.output_tokens}
                    colorClass="text-warning"
                  />
                  <StatBox
                    label={messages['usage.totalTokens']}
                    value={usage.summary.total_tokens}
                  />
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body p-5">
                <h2 className="card-title text-base">{t('usage.dailyUsage')}</h2>
                <div className="mt-2">
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-base-300" />
                      <XAxis
                        dataKey="date"
                        className="text-xs"
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        className="text-xs"
                        tick={{ fontSize: 11 }}
                        tickFormatter={fmtNum}
                      />
                      <Tooltip
                        formatter={(value) => [fmtNum(value), undefined]}
                        labelStyle={{ fontWeight: 'bold' }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey={messages['usage.inputMiss']}
                        stroke="oklch(0.55 0.2 260)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey={messages['usage.inputHit']}
                        stroke="oklch(0.65 0.2 150)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey={messages['usage.output']}
                        stroke="oklch(0.7 0.18 85)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
