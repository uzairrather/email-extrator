import { useState, useEffect, useCallback } from 'react'
import { Search, Download, Trash2, Phone, MapPin, Building2, Globe, Mail, User, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

const TAG_COLORS = {
  phones: 'bg-green-500/10 text-green-400 border-green-500/20',
  emails: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  addresses: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  companies: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  websites: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  names: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
}

const ICONS = { phones: Phone, addresses: MapPin, companies: Building2, websites: Globe, emails: Mail, names: User }

const CAT_COLORS = {
  business_inquiry:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  partnership_request: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  sales_lead:          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  job_application:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  customer_support:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  newsletter_spam:     'bg-red-500/10 text-red-400 border-red-500/20',
  other:               'bg-slate-500/10 text-slate-400 border-slate-500/20',
}
const CAT_LABELS = {
  business_inquiry: 'Business', partnership_request: 'Partnership',
  sales_lead: 'Sales Lead', job_application: 'Job App',
  customer_support: 'Support', newsletter_spam: 'Spam', other: 'Other',
}

function FieldBadges({ field, values }) {
  if (!values?.length) return null
  const Icon = ICONS[field]
  const color = TAG_COLORS[field]
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {values.map((v, i) => (
        <span key={i} className={`badge border ${color} font-mono text-[10px]`}>
          {Icon && <Icon size={9} />} {v}
        </span>
      ))}
    </div>
  )
}

export default function DataPage() {
  const [data, setData] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({
    status: 'extracted',    // DEFAULT: only extracted records
    hasPhone: '',
    category: '',
  })
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 15, search, ...filters })
      ;[...params.keys()].forEach(k => !params.get(k) && params.delete(k))
      const res = await api.get(`/data?${params}`)
      setData(res.data.data)
      setPagination(res.data.pagination)
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [page, search, filters])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setPage(1) }, [search, filters])

  const handleExport = async () => {
    try {
      const params = new URLSearchParams()
      if (filters.category) params.set('category', filters.category)
      const res = await api.get(`/data/export?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = 'extracted_data.csv'; a.click()
      URL.revokeObjectURL(url)
      toast.success('CSV exported!')
    } catch {
      toast.error('Export failed')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this record?')) return
    try {
      await api.delete(`/data/${id}`)
      fetchData()
      toast.success('Deleted')
    } catch {
      toast.error('Delete failed')
    }
  }

  const hasAnyField = (fields) =>
    ['phones', 'emails', 'addresses', 'names', 'companies', 'websites']
      .some(k => fields?.[k]?.length)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Extracted Data</h1>
          <p className="text-slate-400 text-sm mt-1">
            {pagination.total} {filters.status === 'extracted' ? 'extracted' : filters.status === 'all' ? 'total' : filters.status} records
            {filters.category ? ` · ${CAT_LABELS[filters.category] || filters.category}` : ''}
          </p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-2 btn-secondary text-sm">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Search & Filters */}
      <div className="card p-4 mb-4 flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search emails, names, phones…"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>

        {/* Status filter */}
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-500"
        >
          <option value="extracted">Extracted only</option>
          <option value="all">All records</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
        </select>

        {/* Has phone filter */}
        <select
          value={filters.hasPhone}
          onChange={e => setFilters(f => ({ ...f, hasPhone: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-500"
        >
          <option value="">All records</option>
          <option value="true">Has phone</option>
        </select>

        {/* Category filter */}
        <select
          value={filters.category}
          onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-500"
        >
          <option value="">All categories</option>
          <option value="business_inquiry">Business Inquiry</option>
          <option value="partnership_request">Partnership Request</option>
          <option value="sales_lead">Sales Lead</option>
          <option value="job_application">Job Application</option>
          <option value="customer_support">Customer Support</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Records */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <Search size={32} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500">
            {filters.status === 'extracted'
              ? 'No extracted records found.'
              : 'No records found.'}
          </p>
          <p className="text-slate-600 text-xs mt-1">
            {filters.status === 'extracted'
              ? 'Go to Accounts & Sync, select email types, and run a sync.'
              : 'Try changing the filters above.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(row => {
            const isExpanded = expanded === row._id
            return (
              <div key={row._id} className="card overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : row._id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`badge ${row.status === 'extracted' ? 'bg-green-500/10 text-green-400' : row.status === 'failed' ? 'bg-red-500/10 text-red-400' : row.status === 'skipped' ? 'bg-slate-500/10 text-slate-500' : 'bg-yellow-500/10 text-yellow-400'}`}>
                          {row.status}
                        </span>
                        {row.category && (
                          <span className={`badge border ${CAT_COLORS[row.category] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                            {CAT_LABELS[row.category] || row.category}
                          </span>
                        )}
                        <span className="text-xs text-slate-500 font-mono">
                          {row.receivedAt ? new Date(row.receivedAt).toLocaleDateString() : '—'}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-white truncate">{row.subject || '(no subject)'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{row.fromName ? `${row.fromName} · ` : ''}{row.fromEmail}</p>

                      {/* Field badges preview */}
                      {hasAnyField(row.extractedFields) && (
                        <div className="mt-2">
                          {['phones', 'addresses', 'companies', 'emails', 'names'].map(field => (
                            <FieldBadges key={field} field={field} values={row.extractedFields?.[field]} />
                          ))}
                        </div>
                      )}

                      {/* Summary if available */}
                      {row.extractedFields?.summary && (
                        <p className="text-xs text-slate-400 mt-2 italic">{row.extractedFields.summary}</p>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(row._id) }}
                      className="p-1.5 text-slate-600 hover:text-red-400 transition-colors rounded shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-800 p-4 bg-slate-800/30">
                    {row.rawSnippet && (
                      <div className="mb-4">
                        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide">Email Snippet</p>
                        <p className="text-sm text-slate-400 font-mono bg-slate-900 rounded p-3">{row.rawSnippet}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {['phones', 'emails', 'addresses', 'names', 'companies', 'websites', 'dates'].map(field => {
                        const vals = row.extractedFields?.[field]
                        if (!vals?.length) return null
                        const Icon = ICONS[field]
                        return (
                          <div key={field}>
                            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              {Icon && <Icon size={10} />} {field}
                            </p>
                            <div className="space-y-1">
                              {vals.map((v, i) => (
                                <p key={i} className="text-xs font-mono text-slate-300 bg-slate-900 rounded px-2 py-1">{v}</p>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">Page {pagination.page} of {pagination.pages}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary py-1.5 px-2 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
              disabled={page === pagination.pages}
              className="btn-secondary py-1.5 px-2 disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}