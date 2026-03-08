import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, RefreshCw, Trash2, Clock, X, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

const PROVIDER_LABELS = { gmail: 'Gmail', outlook: 'Outlook' }
const PROVIDER_COLORS = { gmail: 'text-red-400', outlook: 'text-blue-400' }

const ALL_CATEGORIES = [
  { key: 'business_inquiry',    label: 'Business Inquiry' },
  { key: 'partnership_request', label: 'Partnership Request' },
  { key: 'sales_lead',          label: 'Sales Lead' },
  { key: 'job_application',     label: 'Job Application' },
  { key: 'customer_support',    label: 'Customer Support' },
  { key: 'newsletter_spam',     label: 'Newsletter/Spam (skip)', skip: true },
  { key: 'other',               label: 'Any email (no filter)' },
]

const CAT_COLORS = {
  business_inquiry:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  partnership_request: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  sales_lead:          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  job_application:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  customer_support:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  newsletter_spam:     'bg-red-500/10 text-red-400 border-red-500/20',
  other:               'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

function CategoryModal({ account, onClose, onSync }) {
  const [selected, setSelected] = useState(['business_inquiry', 'sales_lead', 'job_application'])
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState(null)

  const toggle = (key) => {
    if (key === 'newsletter_spam') return
    if (key === 'other') {
      setSelected(s => s.includes('other') ? s.filter(k => k !== 'other') : ['other'])
      return
    }
    setSelected(s =>
      s.includes(key)
        ? s.filter(k => k !== key && k !== 'other')
        : [...s.filter(k => k !== 'other'), key]
    )
  }

  const handleSync = async () => {
    setSyncing(true)
    setProgress({ message: 'Starting sync...', current: 0, total: 0 })

    try {
      const categories = selected.includes('other') ? [] : selected
      await api.post(`/email/sync/${account._id}`, { categories })

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const res = await api.get(`/email/sync-status/${account._id}`)
          const data = res.data

          setProgress(data)

          if (data.done) {
            clearInterval(pollInterval)
            setSyncing(false)

            if (data.status === 'error') {
              toast.error(data.message || 'Sync failed')
            } else {
              toast.success(data.message || `${data.processed} emails extracted`)
            }

            onSync()
            setTimeout(() => onClose(), 500)
          }
        } catch {
          clearInterval(pollInterval)
          setSyncing(false)
          toast.error('Failed to check sync status')
          onClose()
        }
      }, 2000)

    } catch (err) {
      toast.error(err.response?.data?.error || 'Sync failed')
      setSyncing(false)
      setProgress(null)
    }
  }

  const progressPercent = progress?.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!syncing ? onClose : undefined} />
      <div className="relative w-full max-w-sm bg-[#252525] rounded-2xl overflow-hidden shadow-2xl border border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">Select Email Types</h2>
            <p className="text-xs text-slate-500 mt-0.5">{account.email}</p>
          </div>
          {!syncing && (
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-slate-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Progress bar (shown during sync) */}
        {syncing && progress && (
          <div className="px-5 pb-3">
            <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">{progress.message}</p>
            {progress.total > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {progress.processed} extracted · {progress.skipped} skipped
              </p>
            )}
          </div>
        )}

        {/* Category list */}
        {!syncing && (
          <div className="px-2 pb-2">
            {ALL_CATEGORIES.map((cat, i) => {
              const isSelected = selected.includes(cat.key)
              const isSpam     = cat.key === 'newsletter_spam'

              return (
                <div key={cat.key}>
                  <button
                    onClick={() => toggle(cat.key)}
                    disabled={isSpam}
                    className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left transition-colors
                      ${isSelected && !isSpam ? 'bg-white/10' : 'hover:bg-white/5'}
                      ${isSpam ? 'opacity-40 cursor-default' : 'cursor-pointer'}
                    `}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center border flex-shrink-0 transition-all
                      ${isSelected && !isSpam ? 'bg-white border-white' : 'border-white/20'}
                    `}>
                      {isSelected && !isSpam && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={`text-sm font-medium ${isSpam ? 'text-slate-600' : isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {cat.label}
                    </span>
                  </button>
                  {i < ALL_CATEGORIES.length - 1 && (
                    <div className="mx-3 border-b border-white/5" />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/5 flex gap-3">
          {!syncing ? (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors border border-white/10">
                Cancel
              </button>
              <button
                onClick={handleSync}
                disabled={selected.length === 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-slate-100 transition-colors disabled:opacity-40"
              >
                {`Extract ${selected.includes('other') ? 'All' : `(${selected.length})`}`}
              </button>
            </>
          ) : (
            <div className="flex-1 py-2.5 rounded-xl text-sm text-center text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw size={12} className="animate-spin" /> Processing...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncModal, setSyncModal] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const fetchData = useCallback(async () => {
    try {
      const [accRes, statsRes] = await Promise.all([
        api.get('/email/accounts'),
        api.get('/data/stats'),
      ])
      setAccounts(accRes.data.accounts)
      setStats(statsRes.data)
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const connected = searchParams.get('connected')
    const error     = searchParams.get('error')
    if (connected) { toast.success(`${PROVIDER_LABELS[connected] || connected} connected!`); setSearchParams({}) }
    if (error)     { toast.error(`Connection failed: ${error}`); setSearchParams({}) }
  }, [fetchData])

  const connectEmail = async (provider) => {
    try {
      const res = await api.get(`/auth/${provider}`)
      window.location.href = res.data.url
    } catch {
      toast.error(`Failed to connect ${PROVIDER_LABELS[provider]}`)
    }
  }

  const disconnectAccount = async (accountId) => {
    if (!confirm('Disconnect this account?')) return
    try {
      await api.delete(`/email/accounts/${accountId}`)
      toast.success('Account disconnected')
      fetchData()
    } catch {
      toast.error('Failed to disconnect')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Email Accounts</h1>
        <p className="text-slate-400 text-sm mt-1">Connect your email and choose which types to extract data from.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Emails',   value: stats.total },
            { label: 'Extracted',      value: stats.extracted,   className: 'text-green-400' },
            { label: 'With Phones',    value: stats.withPhone,   className: 'text-blue-400' },
            { label: 'With Addresses', value: stats.withAddress, className: 'text-purple-400' },
          ].map(({ label, value, className = 'text-white' }) => (
            <div key={label} className="card p-4">
              <p className="text-xs text-slate-500 mb-2">{label}</p>
              <p className={`text-2xl font-semibold ${className}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {stats?.byCategory && Object.keys(stats.byCategory).length > 0 && (
        <div className="card p-4 mb-6">
          <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
            <Filter size={11} /> Category breakdown
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byCategory).map(([key, count]) => {
              const cat = ALL_CATEGORIES.find(c => c.key === key)
              return (
                <span key={key} className={`badge border text-xs ${CAT_COLORS[key] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {cat?.label || key} · {count}
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className="card p-5 mb-6">
        <h2 className="text-sm font-medium text-slate-300 mb-4">Connect a new account</h2>
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => connectEmail('google')} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2.5 rounded-lg transition-colors border border-slate-700">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"/>
              <path fill="#34A853" d="M16.04 18.013c-1.09.703-2.474 1.078-4.04 1.078a7.077 7.077 0 0 1-6.723-4.823l-4.04 3.067A11.965 11.965 0 0 0 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987Z"/>
              <path fill="#4A90E2" d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21Z"/>
              <path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 0 1 4.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067Z"/>
            </svg>
            Connect Gmail
          </button>
          <button onClick={() => connectEmail('outlook')} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2.5 rounded-lg transition-colors border border-slate-700">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#0078D4" d="M3.5 2h8.5v8H3.5zm0 12h8.5v8H3.5zM12 2h8.5v8H12zm0 12h8.5v8H12z"/>
            </svg>
            Connect Outlook
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Connected accounts ({accounts.length})</h2>
        {accounts.length === 0 ? (
          <div className="card p-8 text-center">
            <Mail size={32} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No accounts connected yet.</p>
            <p className="text-slate-600 text-xs mt-1">Connect Gmail or Outlook above to get started.</p>
          </div>
        ) : (
          accounts.map(acc => (
            <div key={acc._id} className="card p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${acc.isActive ? 'bg-green-400' : 'bg-slate-600'}`} />
                <div>
                  <p className="text-sm font-medium text-white">{acc.email}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs ${PROVIDER_COLORS[acc.provider]}`}>{PROVIDER_LABELS[acc.provider]}</span>
                    {acc.lastSyncAt && (
                      <span className="text-xs text-slate-600 flex items-center gap-1">
                        <Clock size={10} /> {new Date(acc.lastSyncAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSyncModal(acc)} className="flex items-center gap-2 btn-secondary text-sm py-1.5 px-3">
                  <RefreshCw size={13} /> Sync Now
                </button>
                <button onClick={() => disconnectAccount(acc._id)} className="p-2 text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-slate-800">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {syncModal && (
        <CategoryModal account={syncModal} onClose={() => setSyncModal(null)} onSync={fetchData} />
      )}
    </div>
  )
}