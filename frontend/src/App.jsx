import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import './App.css'

// ── Chart Plugins ─────────────────────────────────────────────────────────────
const centerLabelPlugin = {
  id: 'centerLabel',
  afterDraw(chart) {
    const { ctx, chartArea } = chart
    if (!chartArea || chart.config.type !== 'doughnut') return
    const total = chart.data.datasets[0].data.reduce((a, b) => Number(a) + Number(b), 0)
    if (!total) return
    const cx = (chartArea.left + chartArea.right) / 2
    const cy = (chartArea.top + chartArea.bottom) / 2
    ctx.save()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f1f5f9'; ctx.font = 'bold 22px Inter, system-ui, sans-serif'
    ctx.fillText(String(total), cx, cy - 8)
    ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, system-ui, sans-serif'
    ctx.fillText('products', cx, cy + 10)
    ctx.restore()
  },
}

const barLabelsPlugin = {
  id: 'barLabels',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'bar') return
    const { ctx } = chart
    const isHorizontal = chart.options.indexAxis === 'y'
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex)
      if (meta.hidden) return
      meta.data.forEach((bar, index) => {
        const value = dataset.data[index]
        if (!value) return
        const n = Number(value)
        const label = n >= 1000000 ? 'PKR ' + (n / 1000000).toFixed(1) + 'M' : 'PKR ' + Math.round(n / 1000) + 'K'
        ctx.save()
        ctx.fillStyle = '#94a3b8'; ctx.font = '10px Inter, system-ui, sans-serif'
        if (isHorizontal) {
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, bar.x + 4, bar.y)
        } else {
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, bar.x, bar.y - 3)
        }
        ctx.restore()
      })
    })
  },
}

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, centerLabelPlugin, barLabelsPlugin,
)

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TABS = [
  { id: 'overview',      label: 'Overview' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'inventory',     label: 'Inventory' },
  { id: 'risk',          label: 'Stockout Risk' },
  { id: 'reorder',       label: 'Reorder' },
  { id: 'anomaly',       label: 'Anomaly Alerts' },
]

const TAB_FILTERS = {
  overview:      ['dates', 'category'],
  profitability: ['dates', 'category'],
  inventory:     ['category'],
  risk:          ['category', 'risk', 'trend'],
  reorder:       ['category', 'risk'],
  anomaly:       ['category', 'anomalyType'],
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(num) {
  return 'PKR ' + Number(num).toLocaleString('en-PK', { maximumFractionDigits: 0 })
}

function downloadCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const esc = v => { const s = v == null ? '' : String(v); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [keys.join(','), ...data.map(row => keys.map(k => esc(row[k])).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

function generatePO(reorderData) {
  if (!reorderData.length) return
  const doc = new jsPDF()
  const today = new Date().toLocaleDateString('en-PK')

  doc.setFontSize(22); doc.setTextColor(99, 102, 241)
  doc.text('Intelligent Inventory', 14, 18)
  doc.setFontSize(10); doc.setTextColor(120)
  doc.text('Mart — Purchase Order', 14, 26)
  doc.text(`Generated: ${today}`, 14, 32)

  const grouped = {}
  reorderData.forEach(item => {
    if (!grouped[item.supplier_name]) grouped[item.supplier_name] = []
    grouped[item.supplier_name].push(item)
  })

  let grandTotal = 0
  let startY = 42

  Object.entries(grouped).forEach(([supplier, items]) => {
    const subtotal = items.reduce((s, i) => s + parseFloat(i.estimated_cost_pkr || 0), 0)
    grandTotal += subtotal

    doc.setFontSize(11); doc.setTextColor(30)
    doc.text(`Supplier: ${supplier}`, 14, startY)

    autoTable(doc, {
      startY: startY + 4,
      head: [['Product', 'Category', 'Stock', 'Rec. Qty', 'Est. Cost (PKR)']],
      body: items.map(i => [
        i.product_name, i.category, i.current_stock,
        i.recommended_order_qty,
        Number(i.estimated_cost_pkr).toLocaleString('en-PK', { maximumFractionDigits: 0 }),
      ]),
      foot: [['', '', '', 'Subtotal', subtotal.toLocaleString('en-PK', { maximumFractionDigits: 0 })]],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      footStyles: { fontStyle: 'bold', fillColor: [240, 240, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })
    startY = doc.lastAutoTable.finalY + 12
  })

  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(30)
  doc.text(`Total Restock Budget: PKR ${grandTotal.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`, 14, startY)
  doc.save(`purchase_order_${today.replace(/\//g, '-')}.pdf`)
}

// ── Small Components ──────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }) {
  return (
    <div className="kpi-card" style={{ borderTopColor: color }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub" style={{ color }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, sub, color, action }) {
  return (
    <div className="section-header" style={{ borderLeftColor: color || '#6366f1' }}>
      <div className="section-header-row">
        <div>
          <h2 className="section-title">{title}</h2>
          {sub && <span className="section-sub">{sub}</span>}
        </div>
        {action && <div className="section-actions">{action}</div>}
      </div>
    </div>
  )
}

function Pill({ label, active, onClick, activeColor = '#6366f1' }) {
  return (
    <button className={`pill ${active ? 'pill-active' : ''}`}
      style={active ? { background: activeColor, borderColor: activeColor } : {}} onClick={onClick}>
      {label}
    </button>
  )
}

const RISK_COLORS  = { All: '#6366f1', CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308' }
const TREND_COLORS = { All: '#6366f1', Rising: '#10b981', Stable: '#38bdf8', Declining: '#ef4444' }

function FilterBar({ categories, filters, onFilter, show = ['category', 'risk', 'trend'], dateRange, onDateChange }) {
  const isActive = (
    (show.includes('category')    && filters.category    !== 'All') ||
    (show.includes('risk')        && filters.risk        !== 'All') ||
    (show.includes('trend')       && filters.trend       !== 'All') ||
    (show.includes('anomalyType') && filters.anomalyType !== 'All') ||
    (show.includes('dates')       && (dateRange?.start || dateRange?.end))
  )
  return (
    <section className="filter-bar card">
      <div className="filter-bar-top">
        <span className="filter-bar-title">Filters</span>
        {isActive && <button className="clear-btn" onClick={() => { onFilter('reset'); onDateChange?.('reset') }}>✕ Clear All</button>}
      </div>
      <div className="filter-groups">
        {show.includes('dates') && (
          <div className="filter-group">
            <span className="filter-label">Date Range</span>
            <input type="date" className="date-input" value={dateRange?.start || ''} onChange={e => onDateChange?.('start', e.target.value)} />
            <span style={{ color: '#475569', fontSize: '0.78rem' }}>to</span>
            <input type="date" className="date-input" value={dateRange?.end || ''} onChange={e => onDateChange?.('end', e.target.value)} />
          </div>
        )}
        {show.includes('category') && (
          <div className="filter-group">
            <span className="filter-label">Category</span>
            <div className="filter-pills">
              {['All', ...categories].map(cat => (
                <Pill key={cat} label={cat} active={filters.category === cat} onClick={() => onFilter('category', cat)} activeColor="#6366f1" />
              ))}
            </div>
          </div>
        )}
        {show.includes('risk') && (
          <div className="filter-group">
            <span className="filter-label">Risk Level</span>
            <div className="filter-pills">
              {Object.keys(RISK_COLORS).map(r => (
                <Pill key={r} label={r === 'All' ? 'All' : r.charAt(0) + r.slice(1).toLowerCase()}
                  active={filters.risk === r} onClick={() => onFilter('risk', r)} activeColor={RISK_COLORS[r]} />
              ))}
            </div>
          </div>
        )}
        {show.includes('trend') && (
          <div className="filter-group">
            <span className="filter-label">Demand Trend</span>
            <div className="filter-pills">
              {Object.keys(TREND_COLORS).map(t => (
                <Pill key={t} label={t} active={filters.trend === t} onClick={() => onFilter('trend', t)} activeColor={TREND_COLORS[t]} />
              ))}
            </div>
          </div>
        )}
        {show.includes('anomalyType') && (
          <div className="filter-group">
            <span className="filter-label">Anomaly Type</span>
            <div className="filter-pills">
              {[['All', '#6366f1'], ['Spike', '#f97316'], ['Drop', '#ef4444']].map(([t, color]) => (
                <Pill key={t} label={t} active={filters.anomalyType === t} onClick={() => onFilter('anomalyType', t)} activeColor={color} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function RiskBadge({ level }) {
  const colors = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', 'No Recent Sales': '#6b7280' }
  return <span className="badge" style={{ background: colors[level] || '#6b7280' }}>{level}</span>
}

function TrendBadge({ trend }) {
  const styles = { Rising: { background: '#16a34a', label: '▲ Rising' }, Stable: { background: '#2563eb', label: '● Stable' }, Declining: { background: '#dc2626', label: '▼ Declining' }, 'Insufficient Data': { background: '#6b7280', label: '— N/A' } }
  const s = styles[trend] || styles['Insufficient Data']
  return <span className="badge" style={{ background: s.background }}>{s.label}</span>
}

function RiskBar({ score }) {
  const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f97316' : score >= 1 ? '#eab308' : '#22c55e'
  return (
    <div className="risk-bar-bg">
      <div className="risk-bar-fill" style={{ width: `${score}%`, background: color }} />
      <span className="risk-bar-label">{score}</span>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ── Product Form ──────────────────────────────────────────────────────────────
function ProductForm({ product, suppliers, categories, onSubmit, onClose, saving }) {
  const [form, setForm] = useState(product ? {
    name: product.name, category: product.category, cost_price: product.cost_price,
    selling_price: product.selling_price, stock_quantity: product.stock_quantity,
    reorder_level: product.reorder_level, supplier_id: product.supplier_id,
  } : { name: '', category: '', cost_price: '', selling_price: '', stock_quantity: '', reorder_level: 10, supplier_id: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <form className="crud-form" onSubmit={e => { e.preventDefault(); onSubmit(form) }}>
      <div className="form-grid">
        <div className="form-group"><label>Product Name</label>
          <input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Samsung Galaxy S24" /></div>
        <div className="form-group"><label>Category</label>
          <input required list="cat-list" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Electronics" />
          <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist></div>
        <div className="form-group"><label>Cost Price (PKR)</label>
          <input required type="number" min="0" step="0.01" value={form.cost_price} onChange={e => set('cost_price', e.target.value)} /></div>
        <div className="form-group"><label>Selling Price (PKR)</label>
          <input required type="number" min="0" step="0.01" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} /></div>
        <div className="form-group"><label>Stock Quantity</label>
          <input required type="number" min="0" value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)} /></div>
        <div className="form-group"><label>Reorder Level</label>
          <input required type="number" min="0" value={form.reorder_level} onChange={e => set('reorder_level', e.target.value)} /></div>
        <div className="form-group form-group-full"><label>Supplier</label>
          <select required value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)}>
            <option value="">Select supplier…</option>
            {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
          </select></div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : (product ? 'Update Product' : 'Add Product')}</button>
      </div>
    </form>
  )
}

// ── Drill Down Modal ──────────────────────────────────────────────────────────
function DrillDown({ product, history, onClose }) {
  const lineData = {
    labels: history.map(h => h.month_label),
    datasets: [
      { label: 'Units Sold', data: history.map(h => h.units_sold), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
      { label: 'Revenue (PKR)', data: history.map(h => h.revenue), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.3, yAxisID: 'y2' },
    ],
  }
  const lineOptions = {
    responsive: true, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' }, title: { display: true, text: 'Units', color: '#64748b' } },
      y2: { position: 'right', ticks: { color: '#94a3b8' }, grid: { display: false }, title: { display: true, text: 'Revenue', color: '#64748b' } },
    },
  }
  return (
    <Modal title={product?.name || 'Product Detail'} onClose={onClose} wide>
      <div className="drill-meta">
        <span className="badge" style={{ background: '#334155' }}>{product?.category}</span>
        {product?.supplier_name && <span className="drill-info">Supplier: {product.supplier_name}</span>}
      </div>
      <div className="drill-stats">
        {[
          { label: 'Cost Price',    value: fmt(product?.cost_price    || 0) },
          { label: 'Selling Price', value: fmt(product?.selling_price || 0) },
          { label: 'Stock',         value: product?.stock_quantity ?? '—', color: (product?.stock_quantity ?? 999) <= (product?.reorder_level ?? 0) ? '#ef4444' : '#10b981' },
          { label: 'Reorder Level', value: product?.reorder_level ?? '—' },
        ].map(s => (
          <div key={s.label} className="drill-stat">
            <span className="drill-stat-label">{s.label}</span>
            <span className="drill-stat-value" style={s.color ? { color: s.color } : {}}>{s.value}</span>
          </div>
        ))}
      </div>
      {history.length > 0 ? (
        <><h4 className="drill-chart-title">Monthly Sales History</h4><Line data={lineData} options={lineOptions} /></>
      ) : (
        <p className="empty" style={{ marginTop: '1rem' }}>No sales history available.</p>
      )}
    </Modal>
  )
}

// ── Login Form ────────────────────────────────────────────────────────────────
function LoginForm({ onLogin, error }) {
  const [form, setForm] = useState({ username: '', password: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  async function handleSubmit(e) {
    e.preventDefault(); setBusy(true)
    await onLogin(form)
    setBusy(false)
  }
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">Intelligent Inventory</div>
        <div className="login-tagline">AI-Powered Inventory Intelligence</div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input required autoFocus value={form.username} onChange={e => set('username', e.target.value)} placeholder="Enter username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input required type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Enter password" />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="btn-primary login-btn" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <div className="login-footer">Mart · Inventory Management System</div>
      </div>
    </div>
  )
}

// ── Chart shared options ──────────────────────────────────────────────────────
const donutOptions = {
  responsive: true,
  plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 11 }, padding: 10 } } },
  cutout: '65%',
}

function riskInRange(score, level) {
  if (level === 'All')      return true
  if (level === 'CRITICAL') return score >= 70
  if (level === 'HIGH')     return score >= 40 && score < 70
  if (level === 'MEDIUM')   return score >= 1  && score < 40
  return true
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('ib_token')
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
    return t
  })
  // const [loginError, setLoginError] = useState('')

  // ── Data state ─────────────────────────────────────────────────────────────
  const [kpis, setKpis]                   = useState(null)
  const [monthlyDetail, setMonthlyDetail] = useState([])
  const [profit, setProfit]               = useState([])
  const [reorder, setReorder]             = useState([])
  const [insights, setInsights]           = useState([])
  const [budget, setBudget]               = useState(null)
  const [turnover, setTurnover]           = useState([])
  const [lowStock, setLowStock]           = useState([])
  const [products, setProducts]           = useState([])
  const [suppliers, setSuppliers]         = useState([])
  const [anomalies, setAnomalies]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0)
  const LOADING_MESSAGES = [
    '📦 Unpacking your inventory data...',
    '🔍 Scanning the shelves, hang tight...',
    '📊 Crunching the numbers...',
    '🚀 Warming up the dashboard...',
  ]
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [loading])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [modal, setModal]         = useState(null)
  const [saving, setSaving]       = useState(false)
  const [filters, setFilters]     = useState({ category: 'All', risk: 'All', trend: 'All', anomalyType: 'All' })
  const [activeTab, setActiveTab] = useState('overview')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const overviewReady  = useRef({ kpis: false, turnover: false, insights: false })
  const skipDateEffect = useRef(true)
  const notifiedRef    = useRef(false)

  // ── Keep Render backend alive (ping every 10 min to prevent cold starts) ────
  useEffect(() => {
    const ping = () => axios.get(`${API}/`).catch(() => {})
    ping()
    const id = setInterval(ping, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Set axios auth header whenever token changes ───────────────────────────
  useEffect(() => {
    if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    else delete axios.defaults.headers.common['Authorization']
  }, [token])

  // ── Intercept 401 responses → auto logout ─────────────────────────────────
  useEffect(() => {
    const id = axios.interceptors.response.use(
      res => res,
      err => {
        if (err.response?.status === 401) { localStorage.removeItem('ib_token'); setToken(null) }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  // ── Fetch all data (auto-login then fetch on mount) ───────────────────────
  useEffect(() => {
    async function autoLoginAndFetch() {
      try {
        // Auto-login with demo credentials so all API calls are authenticated
        const auth = await axios.post(`${API}/auth/login`, { username: 'admin', password: 'admin123' })
        const t = auth.data.token
        localStorage.setItem('ib_token', t)
        axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
        setToken(t)
      } catch (_) { /* if already have a valid token, continue anyway */ }

      overviewReady.current = { kpis: false, turnover: false, insights: false }
      skipDateEffect.current = true
      notifiedRef.current = false
      setLoading(true)

      function checkOverviewReady(key) {
        overviewReady.current[key] = true
        if (overviewReady.current.kpis && overviewReady.current.turnover && overviewReady.current.insights) setLoading(false)
      }

      axios.get(`${API}/dashboard`).then(r => { setKpis(r.data); checkOverviewReady('kpis') }).catch(() => checkOverviewReady('kpis'))
      axios.get(`${API}/inventory/turnover`).then(r => { setTurnover(r.data); checkOverviewReady('turnover') }).catch(() => checkOverviewReady('turnover'))
      axios.get(`${API}/ai/insights`).then(r => { setInsights(r.data); checkOverviewReady('insights') }).catch(() => checkOverviewReady('insights'))
      axios.get(`${API}/sales/monthly-profit`).then(r => setMonthlyDetail(r.data))
      axios.get(`${API}/products/profitability`).then(r => setProfit(r.data))
      axios.get(`${API}/ai/budget`).then(r => setBudget(r.data))
      axios.get(`${API}/inventory/low-stock`).then(r => setLowStock(r.data))
      axios.get(`${API}/reorder`).then(r => setReorder(r.data))
      axios.get(`${API}/products`).then(r => setProducts(r.data))
      axios.get(`${API}/suppliers`).then(r => setSuppliers(r.data))
      axios.get(`${API}/ai/anomalies`).then(r => setAnomalies(r.data))
    }
    autoLoginAndFetch()
  }, [])

  // ── Send browser notification once data is loaded ─────────────────────────
  useEffect(() => {
    if (loading || notifiedRef.current) return
    notifiedRef.current = true
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const critical = insights.filter(i => i.risk_score >= 70).length
    const parts = []
    if (critical > 0)      parts.push(`${critical} critical stock alert${critical !== 1 ? 's' : ''}`)
    if (anomalies.length > 0) parts.push(`${anomalies.length} sales anomal${anomalies.length !== 1 ? 'ies' : 'y'} detected`)
    if (parts.length > 0) new Notification('Intelligent Inventory', { body: parts.join(' · '), icon: '/vite.svg' })
  }, [loading])

  // ── Re-fetch date-sensitive endpoints when date range changes ──────────────
  useEffect(() => {
    if (skipDateEffect.current) { skipDateEffect.current = false; return }
    const dp = dateRange.start && dateRange.end ? { params: { start_date: dateRange.start, end_date: dateRange.end } } : {}
    axios.get(`${API}/dashboard`, dp).then(r => setKpis(r.data))
    axios.get(`${API}/sales/monthly-profit`, dp).then(r => setMonthlyDetail(r.data))
    axios.get(`${API}/products/profitability`, dp).then(r => setProfit(r.data))
  }, [dateRange])

  // ── Auth handlers (login UI disabled — auto-login on mount) ───────────────
  // async function handleLogin({ username, password }) { ... }
  // function handleLogout() { ... }

  // ── Filter handlers ────────────────────────────────────────────────────────
  function handleFilter(key, value) {
    if (key === 'reset') setFilters({ category: 'All', risk: 'All', trend: 'All', anomalyType: 'All' })
    else setFilters(prev => ({ ...prev, [key]: value }))
  }

  function handleTab(id) { setActiveTab(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function handleDateChange(key, value) {
    if (key === 'reset') setDateRange({ start: '', end: '' })
    else setDateRange(prev => ({ ...prev, [key]: value }))
  }

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  async function refreshAll() {
    const dp = dateRange.start && dateRange.end ? { params: { start_date: dateRange.start, end_date: dateRange.end } } : {}
    const [d, md, p, r, ai, b, t, ls, prods, anom] = await Promise.all([
      axios.get(`${API}/dashboard`, dp), axios.get(`${API}/sales/monthly-profit`, dp),
      axios.get(`${API}/products/profitability`, dp), axios.get(`${API}/reorder`),
      axios.get(`${API}/ai/insights`), axios.get(`${API}/ai/budget`),
      axios.get(`${API}/inventory/turnover`), axios.get(`${API}/inventory/low-stock`),
      axios.get(`${API}/products`), axios.get(`${API}/ai/anomalies`),
    ])
    setKpis(d.data); setMonthlyDetail(md.data); setProfit(p.data); setReorder(r.data)
    setInsights(ai.data); setBudget(b.data); setTurnover(t.data); setLowStock(ls.data)
    setProducts(prods.data); setAnomalies(anom.data)
  }

  async function handleEditProduct(form) {
    setSaving(true)
    try { await axios.put(`${API}/products/${modal.data.product_id}`, form); setModal(null); await refreshAll() }
    catch (e) { alert(e.response?.data?.detail || 'Failed to update product') }
    finally { setSaving(false) }
  }

  async function handleDeleteProduct() {
    setSaving(true)
    try { await axios.delete(`${API}/products/${modal.data.product_id}`); setModal(null); await refreshAll() }
    catch (e) { alert(e.response?.data?.detail || 'Failed to delete product') }
    finally { setSaving(false) }
  }

  async function openDrillDown(productId) {
    const [prod, hist] = await Promise.all([
      axios.get(`${API}/products/${productId}`),
      axios.get(`${API}/products/${productId}/history`),
    ])
    setModal({ type: 'drill-down', data: { product: prod.data, history: hist.data } })
  }

  // ── Gate: show login if no token ───────────────────────────────────────────
  // if (!token) return <LoginForm onLogin={handleLogin} error={loginError} />
  if (loading) return <div className="loading">{LOADING_MESSAGES[loadingMsgIndex]}</div>

  // ── Derived data ───────────────────────────────────────────────────────────
  const categories = [...new Set([...profit.map(p => p.category), ...insights.map(i => i.category)])].sort()

  const filteredProfit   = profit.filter(p => filters.category === 'All' || p.category === filters.category)
  const filteredInsights = insights.filter(ins =>
    (filters.category === 'All' || ins.category === filters.category) &&
    riskInRange(ins.risk_score, filters.risk) &&
    (filters.trend === 'All' || ins.demand_trend === filters.trend)
  )
  const filteredReorder   = reorder.filter(r => (filters.category === 'All' || r.category === filters.category) && (filters.risk === 'All' || r.risk_level === filters.risk))
  const filteredLowStock  = lowStock.filter(ls => filters.category === 'All' || ls.category === filters.category)
  const filteredTurnover  = turnover.filter(t => filters.category === 'All' || t.category === filters.category)
  const filteredAnomalies = anomalies.filter(a =>
    (filters.category === 'All' || a.category === filters.category) &&
    (filters.anomalyType === 'All' || a.anomaly_type === filters.anomalyType)
  )
  const isFiltered = filters.category !== 'All' || filters.risk !== 'All' || filters.trend !== 'All'

  const displayBudget = isFiltered ? {
    products_at_risk:         filteredInsights.filter(i => i.current_stock <= i.reorder_level || i.risk_score > 0).length,
    total_restock_budget_pkr: filteredInsights.reduce((s, i) => s + parseFloat(i.recommended_order_qty || 0) * parseFloat(i.cost_price || 0), 0),
    critical_count:           filteredInsights.filter(i => i.risk_score >= 70).length,
    high_count:               filteredInsights.filter(i => i.risk_score >= 40 && i.risk_score < 70).length,
    rising_demand_count:      filteredInsights.filter(i => i.demand_trend === 'Rising').length,
  } : budget

  const fastMovers = filteredTurnover.filter(t => t.movement_class === 'Fast Moving')
  const modMovers  = filteredTurnover.filter(t => t.movement_class === 'Moderate')
  const slowMovers = filteredTurnover.filter(t => t.movement_class === 'Slow Moving')

  const supplierMap = {}
  filteredReorder.forEach(item => {
    if (!supplierMap[item.supplier_name]) supplierMap[item.supplier_name] = { name: item.supplier_name, products: 0, totalCost: 0 }
    supplierMap[item.supplier_name].products++
    supplierMap[item.supplier_name].totalCost += parseFloat(item.estimated_cost_pkr || 0)
  })
  const supplierSummary = Object.values(supplierMap)

  // ── Chart data ─────────────────────────────────────────────────────────────
  const groupedChartData = {
    labels: monthlyDetail.map(m => m.month_label),
    datasets: [
      { label: 'Revenue (PKR)',      data: monthlyDetail.map(m => m.total_revenue), backgroundColor: '#10b981', borderRadius: 6 },
      { label: 'Gross Profit (PKR)', data: monthlyDetail.map(m => m.gross_profit),  backgroundColor: '#38bdf8', borderRadius: 6 },
    ],
  }
  const groupedChartOptions = { responsive: true, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } }

  const hBarData = {
    labels: filteredProfit.slice(0, 8).map(p => p.product_name),
    datasets: [{ label: 'Gross Profit (PKR)', data: filteredProfit.slice(0, 8).map(p => p.gross_profit), backgroundColor: '#8b5cf6', borderRadius: 4 }],
  }
  const hBarOptions = { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'transparent' } } } }

  const trendRising = filteredInsights.filter(i => i.demand_trend === 'Rising').length
  const trendStable = filteredInsights.filter(i => i.demand_trend === 'Stable').length
  const trendDeclining = filteredInsights.filter(i => i.demand_trend === 'Declining').length
  const trendNA = filteredInsights.filter(i => i.demand_trend === 'Insufficient Data').length
  const riskCritical = filteredInsights.filter(i => i.risk_score >= 70).length
  const riskHigh = filteredInsights.filter(i => i.risk_score >= 40 && i.risk_score < 70).length
  const riskMedium = filteredInsights.filter(i => i.risk_score >= 1  && i.risk_score < 40).length

  const movementDonutOptions = { ...donutOptions, onClick(_e, el) { if (el.length) handleTab('inventory') }, onHover(_e, el, c) { c.canvas.style.cursor = el.length ? 'pointer' : 'default' } }
  const trendDonutOptions    = { ...donutOptions, onClick(_e, el) { if (!el.length) return; handleFilter('trend', ['Rising','Stable','Declining','All'][el[0].index]); handleTab('risk') }, onHover(_e, el, c) { c.canvas.style.cursor = el.length ? 'pointer' : 'default' } }
  const riskDonutOptions     = { ...donutOptions, onClick(_e, el) { if (!el.length) return; handleFilter('risk', ['CRITICAL','HIGH','MEDIUM'][el[0].index]); handleTab('risk') }, onHover(_e, el, c) { c.canvas.style.cursor = el.length ? 'pointer' : 'default' } }

  const turnoverDonutData = { labels: [`Fast Moving (${fastMovers.length})`, `Moderate (${modMovers.length})`, `Slow Moving (${slowMovers.length})`], datasets: [{ data: [fastMovers.length, modMovers.length, slowMovers.length], backgroundColor: ['#10b981', '#f59e0b', '#ef4444'], borderWidth: 0 }] }
  const trendDonutData    = { labels: [`Rising (${trendRising})`, `Stable (${trendStable})`, `Declining (${trendDeclining})`, `N/A (${trendNA})`], datasets: [{ data: [trendRising, trendStable, trendDeclining, trendNA], backgroundColor: ['#10b981', '#38bdf8', '#ef4444', '#64748b'], borderWidth: 0 }] }
  const riskDonutData     = { labels: [`Critical (${riskCritical})`, `High (${riskHigh})`, `Medium (${riskMedium})`], datasets: [{ data: [riskCritical, riskHigh, riskMedium], backgroundColor: ['#ef4444', '#f97316', '#eab308'], borderWidth: 0 }] }

  const dateLabel = dateRange.start && dateRange.end ? ` · ${dateRange.start} → ${dateRange.end}` : ''

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-top">
          <div className="header-left">
            <span className="logo">Intelligent Inventory System</span>
          </div>
          <div className="header-right">
            <span className="store-name">Mart</span>
            {/* <button className="btn-logout" onClick={handleLogout}>Sign Out</button> */}
          </div>
        </div>
        <nav className="tab-nav">
          {TABS.map(tab => (
            <button key={tab.id} className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`} onClick={() => handleTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">

        {TAB_FILTERS[activeTab]?.length > 0 && (
          <FilterBar categories={categories} filters={filters} onFilter={handleFilter}
            show={TAB_FILTERS[activeTab]} dateRange={dateRange} onDateChange={handleDateChange} />
        )}

        {/* ════════════════ OVERVIEW ════════════════ */}
        {activeTab === 'overview' && (
          <>
            <section className="kpi-row">
              <KpiCard label="Total Revenue"      value={fmt(kpis.total_revenue_pkr)}                   color="#10b981" sub={`Aug 2025 – Jan 2026${dateLabel}`} />
              <KpiCard label="Gross Profit"       value={fmt(kpis.total_gross_profit_pkr)}               color="#38bdf8" sub={`Margin: ${kpis.profit_margin_pct}%`} />
              <KpiCard label="Total Products"     value={kpis.total_products}                            color="#6366f1" sub="Across 8 categories" />
              <KpiCard label="Sales Transactions" value={kpis.total_sales_transactions.toLocaleString()} color="#f59e0b" sub="6-month period" />
              <KpiCard label="Low Stock Alerts"   value={kpis.low_stock_alerts}                          color="#ef4444" sub="At reorder level" />
            </section>
            <section className="donuts-row">
              <div className="card donut-card">
                <SectionHeader title={`Inventory Movement${filters.category !== 'All' ? ` · ${filters.category}` : ''}`} color="#10b981" />
                <div className="donut-wrap"><Doughnut data={turnoverDonutData} options={movementDonutOptions} /></div>
              </div>
              <div className="card donut-card">
                <SectionHeader title={`Demand Trend${filters.category !== 'All' ? ` · ${filters.category}` : ''}`} color="#38bdf8" />
                <div className="donut-wrap"><Doughnut data={trendDonutData} options={trendDonutOptions} /></div>
              </div>
              <div className="card donut-card">
                <SectionHeader title="Risk Distribution" color="#ef4444" />
                <div className="donut-wrap"><Doughnut data={riskDonutData} options={riskDonutOptions} /></div>
              </div>
            </section>
          </>
        )}

        {/* ════════════════ PROFITABILITY ════════════════ */}
        {activeTab === 'profitability' && (
          <>
            <section className="charts-row">
              <div className="card chart-card">
                <SectionHeader title="Monthly Revenue vs Gross Profit" sub={`Overall trend${dateLabel}`} color="#10b981" />
                <Bar data={groupedChartData} options={groupedChartOptions} />
              </div>
              <div className="card chart-card">
                <SectionHeader title={`Top Products by Gross Profit${filters.category !== 'All' ? ` · ${filters.category}` : ''}`} color="#8b5cf6" />
                <Bar data={hBarData} options={hBarOptions} />
              </div>
            </section>
            <section className="card">
              <SectionHeader
                title="Product Profitability"
                sub={`${filteredProfit.length} product${filteredProfit.length !== 1 ? 's' : ''}${filters.category !== 'All' ? ` · ${filters.category}` : ''}${dateLabel} · click row for history`}
                color="#8b5cf6"
                action={<button className="btn-export" onClick={() => downloadCSV(filteredProfit, 'profitability.csv')}>↓ CSV</button>}
              />
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Product</th><th>Category</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredProfit.map((p, idx) => (
                      <tr key={p.product_id} className={`${idx % 2 === 0 ? 'row-even' : ''} row-clickable`} onClick={() => openDrillDown(p.product_id)}>
                        <td>{p.product_name}</td><td>{p.category}</td>
                        <td>{fmt(p.total_revenue)}</td><td>{fmt(p.gross_profit)}</td><td>{p.profit_margin_pct}%</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button className="btn-action btn-edit" onClick={() => { const full = products.find(pr => pr.product_id === p.product_id); setModal({ type: 'edit-product', data: full || p }) }}>Edit</button>
                            <button className="btn-action btn-delete" onClick={() => setModal({ type: 'delete-product', data: p })}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ════════════════ INVENTORY ════════════════ */}
        {activeTab === 'inventory' && (
          <>
            <section className="card">
              <SectionHeader title="Inventory Health" sub={`Movement classification${filters.category !== 'All' ? ` · ${filters.category}` : ' · All Categories'}`} color="#f59e0b"
                action={<button className="btn-export" onClick={() => downloadCSV(filteredTurnover, 'inventory_turnover.csv')}>↓ CSV</button>} />
              <div className="health-row">
                {[
                  { label: 'Fast Moving', color: '#10b981', items: fastMovers },
                  { label: 'Moderate',    color: '#f59e0b', items: modMovers },
                  { label: 'Slow Moving', color: '#ef4444', items: slowMovers },
                ].map(col => (
                  <div key={col.label} className="health-col">
                    <div className="health-col-header"><span className="health-dot" style={{ background: col.color }} />{col.label}<span className="health-count">{col.items.length}</span></div>
                    <ul className="health-list">
                      {col.items.map(t => (
                        <li key={t.product_id} className="health-row-item" onClick={() => openDrillDown(t.product_id)}>
                          <span className="health-name">{t.product_name}</span>
                          <span className="health-ratio">×{t.turnover_ratio}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
            {filteredLowStock.length > 0 && (
              <section className="card">
                <SectionHeader title="Low Stock Alerts" sub={`${filteredLowStock.length} product${filteredLowStock.length !== 1 ? 's' : ''} at or below reorder level`} color="#ef4444"
                  action={<button className="btn-export" onClick={() => downloadCSV(filteredLowStock, 'low_stock.csv')}>↓ CSV</button>} />
                <div className="low-stock-grid">
                  {filteredLowStock.map(item => (
                    <div key={item.product_id} className="low-stock-card" onClick={() => openDrillDown(item.product_id)} style={{ cursor: 'pointer' }}>
                      <div className="ls-name">{item.product_name}</div>
                      <div className="ls-category">{item.category}</div>
                      <div className="ls-stock-row">
                        <span className="ls-stock-val">{item.current_stock}</span>
                        <span className="ls-divider">/</span>
                        <span className="ls-reorder-val">{item.reorder_level}</span>
                        <span className="ls-stock-label">reorder</span>
                      </div>
                      <div className="ls-supplier">{item.supplier_name}</div>
                      {item.supplier_phone && <div className="ls-phone">{item.supplier_phone}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ════════════════ STOCKOUT RISK ════════════════ */}
        {activeTab === 'risk' && (
          <>
            {displayBudget && (
              <section className="card">
                <SectionHeader title="Budget & Risk Summary" sub={isFiltered ? 'Filtered results' : 'All at-risk products'} color="#8b5cf6" />
                <div className="budget-row">
                  <div className="budget-item"><span className="budget-label">Products At Risk</span><span className="budget-value">{displayBudget.products_at_risk}</span></div>
                  <div className="budget-item"><span className="budget-label">Total Restock Budget</span><span className="budget-value">{fmt(displayBudget.total_restock_budget_pkr)}</span></div>
                  <div className="budget-item"><span className="budget-label">Critical</span><span className="budget-value" style={{ color: '#ef4444' }}>{displayBudget.critical_count}</span></div>
                  <div className="budget-item"><span className="budget-label">High</span><span className="budget-value" style={{ color: '#f97316' }}>{displayBudget.high_count}</span></div>
                  <div className="budget-item"><span className="budget-label">Rising Demand</span><span className="budget-value" style={{ color: '#22c55e' }}>{displayBudget.rising_demand_count}</span></div>
                </div>
              </section>
            )}

            <section className="card">
              <SectionHeader title="Stockout Risk & Demand Trends"
                sub={`${filteredInsights.length} product${filteredInsights.length !== 1 ? 's' : ''} · anchored to last 30 days · click row for history`}
                color="#8b5cf6"
                action={<button className="btn-export" onClick={() => downloadCSV(filteredInsights, 'risk_insights.csv')}>↓ CSV</button>} />
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Avg Daily Sales</th><th>Days Until Stockout</th><th>Risk Score</th><th>Demand Trend</th><th>Rec. Order Qty</th><th>Supplier</th></tr></thead>
                  <tbody>
                    {filteredInsights.map((r, idx) => (
                      <tr key={r.product_id} className={`${idx % 2 === 0 ? 'row-even' : ''} row-clickable`} onClick={() => openDrillDown(r.product_id)}>
                        <td>{r.product_name}</td><td>{r.category}</td><td>{r.current_stock}</td>
                        <td>{r.avg_daily_sales}</td><td>{r.days_until_stockout ?? '—'}</td>
                        <td><RiskBar score={r.risk_score} /></td>
                        <td><TrendBadge trend={r.demand_trend} /></td>
                        <td>{r.recommended_order_qty}</td><td>{r.supplier_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ════════════════ REORDER ════════════════ */}
        {activeTab === 'reorder' && (
          <>
            <section className="card">
              <SectionHeader title="IntelliReorder™ Suggestions"
                sub={`${filteredReorder.length} product${filteredReorder.length !== 1 ? 's' : ''} at or below reorder level`}
                color="#f97316"
                action={filteredReorder.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn-export" onClick={() => downloadCSV(filteredReorder, 'reorder.csv')}>↓ CSV</button>
                    <button className="btn-primary btn-sm" onClick={() => generatePO(filteredReorder)}>↓ Purchase Order PDF</button>
                  </div>
                )} />
              {filteredReorder.length === 0 ? (
                <p className="empty">{isFiltered ? 'No products match the current filters.' : 'No reorder alerts — all stock levels are healthy.'}</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Avg Daily Sales</th><th>Days Until Stockout</th><th>Recommended Qty</th><th>Est. Cost</th><th>Risk</th><th>Supplier</th></tr></thead>
                    <tbody>
                      {filteredReorder.map((r, idx) => (
                        <tr key={r.product_id} className={`${idx % 2 === 0 ? 'row-even' : ''} row-clickable`} onClick={() => openDrillDown(r.product_id)}>
                          <td>{r.product_name}</td><td>{r.category}</td><td>{r.current_stock}</td>
                          <td>{r.avg_daily_sales}</td><td>{r.days_until_stockout ?? '—'}</td>
                          <td>{r.recommended_order_qty}</td><td>{fmt(r.estimated_cost_pkr)}</td>
                          <td><RiskBadge level={r.risk_level} /></td><td>{r.supplier_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {supplierSummary.length > 0 && (
              <section className="card">
                <SectionHeader title="Supplier Reorder Summary" sub="Pending reorder cost grouped by supplier" color="#64748b" />
                <div className="supplier-grid">
                  {supplierSummary.map(s => (
                    <div key={s.name} className="supplier-card">
                      <div className="sup-name">{s.name}</div>
                      <div className="sup-row">
                        <div className="sup-item"><span className="sup-label">Products</span><span className="sup-value">{s.products}</span></div>
                        <div className="sup-item"><span className="sup-label">Est. Cost</span><span className="sup-value">{fmt(s.totalCost)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ════════════════ ANOMALY ALERTS ════════════════ */}
        {activeTab === 'anomaly' && (
          <section className="card">
            <SectionHeader
              title="Anomaly Alerts"
              sub={`${filteredAnomalies.length} of ${anomalies.length} pattern${anomalies.length !== 1 ? 's' : ''} · last 7 days vs 30-day baseline · click card for history`}
              color="#f59e0b"
            />
            {filteredAnomalies.length === 0 ? (
              <p className="empty">{anomalies.length === 0 ? 'No anomalies detected — sales patterns look normal.' : 'No anomalies match the current filters.'}</p>
            ) : (
              <div className="anomaly-grid">
                {filteredAnomalies.map(a => (
                  <div key={a.product_id} className={`anomaly-card anomaly-${(a.anomaly_type || '').toLowerCase()}`}
                    onClick={() => openDrillDown(a.product_id)}>
                    <div className="anomaly-name">{a.product_name}</div>
                    <div className="anomaly-category">{a.category}</div>
                    <div className="anomaly-badge">
                      {a.anomaly_type === 'Spike' ? '▲' : '▼'} {a.anomaly_type}
                      {a.change_pct != null && ` ${a.change_pct > 0 ? '+' : ''}${a.change_pct}%`}
                    </div>
                    <div className="anomaly-detail">
                      Recent: {a.recent_daily_avg}/day · Baseline: {a.baseline_daily_avg}/day
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

      </main>

      {/* ── Modals ── */}
      {modal?.type === 'edit-product' && (
        <Modal title="Edit Product" onClose={() => setModal(null)}>
          <ProductForm product={modal.data} suppliers={suppliers} categories={categories} onSubmit={handleEditProduct} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      {modal?.type === 'delete-product' && (
        <Modal title="Delete Product" onClose={() => setModal(null)}>
          <p style={{ color: '#cbd5e1', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Delete <strong style={{ color: '#f1f5f9' }}>{modal.data.product_name || modal.data.name}</strong>?
            This also removes all its sales records and cannot be undone.
          </p>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-danger" onClick={handleDeleteProduct} disabled={saving}>{saving ? 'Deleting…' : 'Delete Product'}</button>
          </div>
        </Modal>
      )}
      {modal?.type === 'drill-down' && (
        <DrillDown product={modal.data.product} history={modal.data.history} onClose={() => setModal(null)} />
      )}

    </div>
  )
}
