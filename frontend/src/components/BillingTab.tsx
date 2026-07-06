import { useEffect, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Breadcrumbs,
  Link,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material'
import { motion } from 'framer-motion'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat'
import { coordinatorGet, ApiError } from '../api'

// --- API types (mirror coordinator BillingController record shapes; ------
// Jackson serializes Java records as camelCase, no naming-strategy override) --

interface PricingOverlay {
  ccuHours: number
  infraUsd: number
  retailUsd: number
  marginUsd: number
  currency: string
}

interface BillingSummary {
  period: string
  mtd: PricingOverlay
  lastMonth: PricingOverlay
  momPct: number | null
  currency: string
}

interface AccountBilling {
  accountId: string
  accountName: string
  projectCount: number
  appCount: number
  momPct: number | null
  pricing: PricingOverlay
}

interface ProjectBilling {
  projectId: string
  projectName: string
  appCount: number
  momPct: number | null
  pricing: PricingOverlay
}

interface LineItemBilling {
  category: string
  pricing: PricingOverlay
}

interface AppBilling {
  appId: string | null
  appName: string
  pricing: PricingOverlay
  lineItems: LineItemBilling[]
}

type Period = 'mtd' | 'last-month' | '30d'

const PERIOD_LABELS: Record<Period, string> = {
  mtd: 'MTD',
  'last-month': 'Last month',
  '30d': 'Last 30d',
}

const LINE_ITEM_LABELS: Record<string, string> = {
  build: 'Build compute',
  runtime: 'Runtime compute',
  db: 'DB',
  daari_llm: 'Daari LLM',
  storage: 'Storage',
  egress: 'Egress',
}

// --- helpers -----------------------------------------------------------------

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatMomPct(n: number | null | undefined): { label: string; color: string; Icon: typeof TrendingUpIcon } {
  if (n === null || n === undefined || Number.isNaN(n)) {
    return { label: '—', color: 'text.secondary', Icon: TrendingFlatIcon }
  }
  if (Math.abs(n) < 0.5) {
    return { label: `${n > 0 ? '+' : ''}${n.toFixed(1)}%`, color: 'text.secondary', Icon: TrendingFlatIcon }
  }
  return n > 0
    ? { label: `+${n.toFixed(1)}%`, color: 'error.main', Icon: TrendingUpIcon }
    : { label: `${n.toFixed(1)}%`, color: 'success.main', Icon: TrendingDownIcon }
}

// --- drill-down state ---------------------------------------------------------

type DrillLevel =
  | { level: 'accounts' }
  | { level: 'projects'; accountId: string; accountName: string }
  | { level: 'apps'; accountId: string; accountName: string; projectId: string; projectName: string }

function BreadcrumbTrail({ drill, onNavigate }: { drill: DrillLevel; onNavigate: (d: DrillLevel) => void }) {
  if (drill.level === 'accounts') return null
  return (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link component="button" variant="body2" onClick={() => onNavigate({ level: 'accounts' })}>
        All accounts
      </Link>
      {drill.level === 'projects' && (
        <Typography variant="body2" color="text.primary">{drill.accountName}</Typography>
      )}
      {drill.level === 'apps' && (
        <>
          <Link
            component="button"
            variant="body2"
            onClick={() => onNavigate({ level: 'projects', accountId: drill.accountId, accountName: drill.accountName })}
          >
            {drill.accountName}
          </Link>
          <Typography variant="body2" color="text.primary">{drill.projectName}</Typography>
        </>
      )}
    </Breadcrumbs>
  )
}

function InfraTag({ infraUsd }: { infraUsd: number }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      Infra cost: {formatUSD(infraUsd)}
    </Typography>
  )
}

// --- component ---------------------------------------------------------------

function BillingTab() {
  const [period, setPeriod] = useState<Period>('mtd')
  const [drill, setDrill] = useState<DrillLevel>({ level: 'accounts' })

  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [accounts, setAccounts] = useState<AccountBilling[] | null>(null)
  const [projects, setProjects] = useState<ProjectBilling[] | null>(null)
  const [apps, setApps] = useState<AppBilling[] | null>(null)
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset drill-down when period changes — a project/app in one period may
  // not exist (zero-usage) in another.
  useEffect(() => {
    setDrill({ level: 'accounts' })
    setExpandedAppId(null)
  }, [period])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (drill.level === 'accounts') {
          const [s, a] = await Promise.all([
            coordinatorGet<BillingSummary>(`/api/v1/billing/summary?period=${period}`),
            coordinatorGet<AccountBilling[]>(`/api/v1/billing/by-account?period=${period}`),
          ])
          if (cancelled) return
          setSummary(s)
          setAccounts(a)
        } else if (drill.level === 'projects') {
          const p = await coordinatorGet<ProjectBilling[]>(
            `/api/v1/billing/by-project?accountId=${drill.accountId}&period=${period}`,
          )
          if (cancelled) return
          setProjects(p)
        } else {
          const ap = await coordinatorGet<AppBilling[]>(
            `/api/v1/billing/by-app?projectId=${drill.projectId}&period=${period}`,
          )
          if (cancelled) return
          setApps(ap)
        }
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError && err.status === 403
            ? 'SYSTEM privileges required to view billing.'
            : err instanceof Error
              ? err.message
              : 'Failed to load billing data'
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [drill, period])

  const momMtd = formatMomPct(summary?.momPct)

  return (
    <motion.div variants={container} initial="hidden" animate="show">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>Billing</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          What each tenant should be charged, based on metered CCU consumption at the retail rate.
        </Typography>
        <ToggleButtonGroup
          size="small"
          value={period}
          exclusive
          onChange={(_e, next) => {
            if (next) setPeriod(next)
          }}
        >
          <ToggleButton value="mtd">MTD</ToggleButton>
          <ToggleButton value="last-month">Last month</ToggleButton>
          <ToggleButton value="30d">Last 30d</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <BreadcrumbTrail drill={drill} onNavigate={setDrill} />

      {drill.level === 'accounts' && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <motion.div variants={item}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <CalendarTodayIcon color="primary" />
                    <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                      This month billed
                    </Typography>
                  </Box>
                  <Typography variant="h4" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatUSD(summary?.mtd.retailUsd)}
                  </Typography>
                  {summary && <InfraTag infraUsd={summary.mtd.infraUsd} />}
                </CardContent>
              </Card>
            </motion.div>
          </Grid>

          <Grid item xs={12} md={4}>
            <motion.div variants={item}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <CalendarMonthIcon color="primary" />
                    <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                      Last month billed
                    </Typography>
                  </Box>
                  <Typography variant="h4" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatUSD(summary?.lastMonth.retailUsd)}
                  </Typography>
                  {summary && <InfraTag infraUsd={summary.lastMonth.infraUsd} />}
                </CardContent>
              </Card>
            </motion.div>
          </Grid>

          <Grid item xs={12} md={4}>
            <motion.div variants={item}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <momMtd.Icon sx={{ color: momMtd.color }} />
                    <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                      MoM change (billed)
                    </Typography>
                  </Box>
                  <Typography
                    variant="h4"
                    fontWeight={700}
                    sx={{ color: momMtd.color, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {momMtd.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    vs prior period, retail $
                  </Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        </Grid>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && drill.level === 'accounts' && (
        <motion.div variants={item}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <ReceiptLongIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>Accounts — {PERIOD_LABELS[period]}</Typography>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Billed</TableCell>
                      <TableCell align="right">MoM %</TableCell>
                      <TableCell align="right"># Projects</TableCell>
                      <TableCell align="right"># Apps</TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>Infra cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(accounts || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                            No billed usage for this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {(accounts || [])
                      .slice()
                      .sort((a, b) => b.pricing.retailUsd - a.pricing.retailUsd)
                      .map((a) => {
                        const mom = formatMomPct(a.momPct)
                        return (
                          <TableRow
                            key={a.accountId}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() =>
                              setDrill({ level: 'projects', accountId: a.accountId, accountName: a.accountName })
                            }
                          >
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>{a.accountName}</Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatUSD(a.pricing.retailUsd)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: mom.color, fontVariantNumeric: 'tabular-nums' }}>
                              {mom.label}
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.projectCount}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.appCount}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {formatUSD(a.pricing.infraUsd)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!loading && !error && drill.level === 'projects' && (
        <motion.div variants={item}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Projects — {drill.accountName}
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Project</TableCell>
                      <TableCell align="right">Billed</TableCell>
                      <TableCell align="right">MoM %</TableCell>
                      <TableCell align="right"># Apps</TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>Infra cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(projects || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                            No billed usage for this account in this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {(projects || [])
                      .slice()
                      .sort((a, b) => b.pricing.retailUsd - a.pricing.retailUsd)
                      .map((p) => {
                        const mom = formatMomPct(p.momPct)
                        return (
                          <TableRow
                            key={p.projectId}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() =>
                              setDrill({
                                level: 'apps',
                                accountId: drill.accountId,
                                accountName: drill.accountName,
                                projectId: p.projectId,
                                projectName: p.projectName,
                              })
                            }
                          >
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>{p.projectName}</Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatUSD(p.pricing.retailUsd)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: mom.color, fontVariantNumeric: 'tabular-nums' }}>
                              {mom.label}
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{p.appCount}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {formatUSD(p.pricing.infraUsd)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!loading && !error && drill.level === 'apps' && (
        <motion.div variants={item}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Apps — {drill.projectName}
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>App</TableCell>
                      <TableCell align="right">Billed</TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>Infra cost</TableCell>
                      <TableCell align="right">Margin</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(apps || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                            No billed usage for this project in this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {(apps || [])
                      .slice()
                      .sort((a, b) => b.pricing.retailUsd - a.pricing.retailUsd)
                      .map((a) => {
                        const key = a.appId ?? a.appName
                        const expanded = expandedAppId === key
                        return (
                          <>
                            <TableRow
                              key={key}
                              hover
                              sx={{ cursor: 'pointer' }}
                              onClick={() => setExpandedAppId(expanded ? null : key)}
                            >
                              <TableCell>
                                <Typography variant="body2" fontWeight={500}>{a.appName}</Typography>
                              </TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {formatUSD(a.pricing.retailUsd)}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {formatUSD(a.pricing.infraUsd)}
                              </TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {formatUSD(a.pricing.marginUsd)}
                              </TableCell>
                            </TableRow>
                            {expanded && (
                              <TableRow key={`${key}-detail`}>
                                <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 1.5 }}>
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Line item</TableCell>
                                        <TableCell align="right">CCU-hours</TableCell>
                                        <TableCell align="right" sx={{ color: 'text.secondary' }}>Infra</TableCell>
                                        <TableCell align="right">Billed</TableCell>
                                        <TableCell align="right">Margin</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {a.lineItems.map((li) => (
                                        <TableRow key={li.category}>
                                          <TableCell>{LINE_ITEM_LABELS[li.category] ?? li.category}</TableCell>
                                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {li.pricing.ccuHours.toFixed(2)}
                                          </TableCell>
                                          <TableCell
                                            align="right"
                                            sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                                          >
                                            {formatUSD(li.pricing.infraUsd)}
                                          </TableCell>
                                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {formatUSD(li.pricing.retailUsd)}
                                          </TableCell>
                                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {formatUSD(li.pricing.marginUsd)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        )
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}

export default BillingTab
