import { useEffect, useMemo, useState } from 'react'
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
  Chip,
  Stack,
  Divider,
  Button,
  Snackbar,
} from '@mui/material'
import { motion } from 'framer-motion'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat'
import CreditCardIcon from '@mui/icons-material/CreditCard'
import { coordinatorGet, apiGet, ApiError } from '../api'
import BillingTrendChart from './BillingTrendChart'
import ConvertAccountDialog from './ConvertAccountDialog'

// --- Cost Explorer API types (mirror admin backend /api/costs/* shapes; -----
// same interfaces as PlatformCostTab.tsx — keep field names in sync) ---------

interface CePeriod {
  start: string
  end: string
}

interface CeSummary {
  currency: string
  mtd: CePeriod & { cost: number }
  previous_month: CePeriod & { cost: number }
  previous_month_to_date: CePeriod & { cost: number; note?: string }
  delta_pct: number | null
  delta_pct_basis: string
  generated_at: string
}

interface CeServiceRow {
  service: string
  cost: number
  pct_of_total: number
}

interface CeByService {
  currency: string
  period: CePeriod
  total: number
  services: CeServiceRow[]
  generated_at: string
}

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

type AccountKind = 'PLATFORM' | 'INTERNAL' | 'TRIAL' | 'TRIAL_EXPIRED' | 'BILLING'

interface AccountBilling {
  accountId: string
  accountName: string
  projectCount: number
  appCount: number
  momPct: number | null
  pricing: PricingOverlay
  billingEnabled: boolean
  trialActive: boolean
  trialExpired: boolean
  trialEndOn: string | null
  isInternal?: boolean
  kind: AccountKind
}

type AccountFilter = 'all' | 'billing' | 'trial' | 'expired'

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

function TrialChip({ trialExpired }: { trialExpired: boolean }) {
  return (
    <Chip
      label={trialExpired ? 'TRIAL EXPIRED' : 'TRIAL'}
      size="small"
      variant="outlined"
      color="warning"
      sx={{ ml: 1 }}
    />
  )
}

function InternalChip() {
  return (
    <Chip
      label="INTERNAL"
      size="small"
      variant="outlined"
      color="info"
      sx={{ ml: 1 }}
    />
  )
}

function PlatformChip() {
  return (
    <Chip
      label="⚡ PLATFORM"
      size="small"
      color="warning"
      variant="filled"
      sx={{ ml: 1 }}
    />
  )
}

function sumInfra(rows: AccountBilling[]): number {
  return rows.reduce((acc, r) => acc + r.pricing.infraUsd, 0)
}

function sumRetail(rows: AccountBilling[]): number {
  return rows.reduce((acc, r) => acc + r.pricing.retailUsd, 0)
}

function BillingPnlCard({
  accounts,
  ceSummary,
  ceByService,
}: {
  accounts: AccountBilling[]
  ceSummary: CeSummary | null
  ceByService: CeByService | null
}) {
  const [showBreakdown, setShowBreakdown] = useState(false)

  const platformRows = accounts.filter((a) => a.kind === 'PLATFORM')
  const internalRows = accounts.filter((a) => a.kind === 'INTERNAL')
  const trialRows = accounts.filter((a) => a.kind === 'TRIAL' || a.kind === 'TRIAL_EXPIRED')
  const billingRows = accounts.filter((a) => a.kind === 'BILLING')

  const platformExpense = sumInfra(platformRows)
  const internalExpense = sumInfra(internalRows)
  const trialWouldRevenue = sumRetail(trialRows)
  const actualRevenue = sumRetail(billingRows)
  const totalInfra = sumInfra(accounts)
  const actualMargin = actualRevenue - totalInfra

  // No per-account Daari infra rollup exists yet (daari_cost_events is
  // CCU/rate-based, not AWS-actual) — hardcode until billing-by-account
  // grows a daariUsd field.
  const totalDaari = 0

  const awsActual = ceSummary?.mtd.cost ?? null
  const unattributed = awsActual == null ? null : Math.max(0, awsActual - totalInfra - totalDaari)

  const tiles: { label: string; value: number; color?: string }[] = [
    { label: 'Platform expense', value: platformExpense },
    { label: 'Internal expense', value: internalExpense },
    { label: 'Trial would-revenue', value: trialWouldRevenue },
    { label: 'Actual revenue', value: actualRevenue },
    { label: 'Total infra', value: totalInfra },
    {
      label: 'Actual margin',
      value: actualMargin,
      color: actualMargin >= 0 ? 'success.main' : 'error.main',
    },
  ]

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" fontWeight={600} sx={{ mb: 2 }}>
          P&amp;L summary
        </Typography>
        <Grid container spacing={2}>
          {tiles.map((t) => (
            <Grid item xs={6} sm={4} md={2} key={t.label}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {t.label}
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight={700}
                  sx={{ fontVariantNumeric: 'tabular-nums', color: t.color ?? 'text.primary' }}
                >
                  {formatUSD(t.value)}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        {awsActual != null && (
          <>
            <Divider sx={{ my: 2 }} />
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4} md={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    AWS actual
                  </Typography>
                  <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatUSD(awsActual)}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', fontStyle: 'italic' }}
                  >
                    As of {new Date(ceSummary!.generated_at).toLocaleString()} · CE settles with 24-48h lag
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Unattributed infra
                  </Typography>
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      color: (unattributed ?? 0) > totalInfra * 0.5 ? 'warning.main' : 'text.primary',
                    }}
                  >
                    {formatUSD(unattributed ?? 0)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    AWS actual − Total infra − Daari
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </>
        )}

        {ceByService && (
          <>
            <Button size="small" onClick={() => setShowBreakdown((v) => !v)} sx={{ mt: 1 }}>
              {showBreakdown ? 'Hide' : 'Show'} AWS service breakdown
            </Button>
            {showBreakdown && (
              <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Service</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">% of total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ceByService.services.slice(0, 5).map((s) => (
                      <TableRow key={s.service}>
                        <TableCell>{s.service}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatUSD(s.cost)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {s.pct_of_total.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function BillingTab() {
  const [period, setPeriod] = useState<Period>('mtd')
  const [drill, setDrill] = useState<DrillLevel>({ level: 'accounts' })
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all')
  const [convertTarget, setConvertTarget] = useState<{ id: string; name: string } | null>(null)
  const [convertToast, setConvertToast] = useState<{ accountId: string; auditId: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [accounts, setAccounts] = useState<AccountBilling[] | null>(null)
  const [projects, setProjects] = useState<ProjectBilling[] | null>(null)
  const [apps, setApps] = useState<AppBilling[] | null>(null)
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null)
  const [ceSummary, setCeSummary] = useState<CeSummary | null>(null)
  const [ceByService, setCeByService] = useState<CeByService | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset drill-down when period changes — a project/app in one period may
  // not exist (zero-usage) in another.
  useEffect(() => {
    setDrill({ level: 'accounts' })
    setExpandedAppId(null)
    setAccountFilter('all')
  }, [period])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (drill.level === 'accounts') {
          const [s, a, ceS, ceB] = await Promise.all([
            coordinatorGet<BillingSummary>(`/api/v1/billing/summary?period=${period}`),
            coordinatorGet<AccountBilling[]>(`/api/v1/billing/by-account?period=${period}`),
            apiGet<CeSummary>('/api/costs/summary').catch(() => null),
            apiGet<CeByService>('/api/costs/by-service?months=1').catch(() => null),
          ])
          if (cancelled) return
          setSummary(s)
          setAccounts(a)
          setCeSummary(ceS)
          setCeByService(ceB)
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
  }, [drill, period, reloadKey])

  const momMtd = formatMomPct(summary?.momPct)

  const filteredAccounts = useMemo(() => {
    if (!accounts) return accounts
    if (accountFilter === 'all') return accounts
    if (accountFilter === 'billing') return accounts.filter((a) => a.billingEnabled)
    if (accountFilter === 'trial') return accounts.filter((a) => a.trialActive)
    return accounts.filter((a) => a.trialExpired)
  }, [accounts, accountFilter])

  return (
    <motion.div variants={container} initial="hidden" animate="show">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>Billing & Metering</Typography>
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

      <BillingTrendChart />

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

      {!loading && !error && drill.level === 'accounts' && accounts && (
        <motion.div variants={item}>
          <BillingPnlCard accounts={accounts} ceSummary={ceSummary} ceByService={ceByService} />
        </motion.div>
      )}

      {!loading && !error && drill.level === 'accounts' && (
        <motion.div variants={item}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <ReceiptLongIcon color="primary" />
                <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
                  Accounts — {PERIOD_LABELS[period]}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Chip
                    label="All"
                    size="small"
                    onClick={() => setAccountFilter('all')}
                    color={accountFilter === 'all' ? 'primary' : 'default'}
                    variant={accountFilter === 'all' ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label="Billing"
                    size="small"
                    onClick={() => setAccountFilter('billing')}
                    color={accountFilter === 'billing' ? 'primary' : 'default'}
                    variant={accountFilter === 'billing' ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label="Trial"
                    size="small"
                    onClick={() => setAccountFilter('trial')}
                    color={accountFilter === 'trial' ? 'primary' : 'default'}
                    variant={accountFilter === 'trial' ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label="Expired trial"
                    size="small"
                    onClick={() => setAccountFilter('expired')}
                    color={accountFilter === 'expired' ? 'primary' : 'default'}
                    variant={accountFilter === 'expired' ? 'filled' : 'outlined'}
                  />
                </Stack>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Consumed</TableCell>
                      <TableCell align="right">Charged</TableCell>
                      <TableCell align="right">Margin</TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>Infra cost</TableCell>
                      <TableCell align="right">MoM %</TableCell>
                      <TableCell align="right"># Projects</TableCell>
                      <TableCell align="right"># Apps</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(filteredAccounts || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                            No accounts match this filter for this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {(filteredAccounts || [])
                      .slice()
                      .sort((a, b) => b.pricing.retailUsd - a.pricing.retailUsd)
                      .map((a) => {
                        const mom = formatMomPct(a.momPct)
                        const isExpenseOnly = a.kind === 'PLATFORM' || a.kind === 'INTERNAL'
                        const isTrialLike = a.kind === 'TRIAL' || a.kind === 'TRIAL_EXPIRED'

                        const consumedDisplay = isExpenseOnly ? '—' : formatUSD(a.pricing.retailUsd)
                        const chargedDisplay = isExpenseOnly
                          ? '—'
                          : isTrialLike
                            ? '$0.00'
                            : formatUSD(a.pricing.retailUsd)
                        const marginDisplay = isExpenseOnly
                          ? '—'
                          : formatUSD(a.pricing.retailUsd - a.pricing.infraUsd)

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
                              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                                <Typography variant="body2" fontWeight={500}>{a.accountName}</Typography>
                                {a.projectCount === 1 && (
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                    · 1 project
                                  </Typography>
                                )}
                                {a.kind === 'PLATFORM' && <PlatformChip />}
                                {a.kind === 'INTERNAL' && <InternalChip />}
                                {isTrialLike && <TrialChip trialExpired={a.kind === 'TRIAL_EXPIRED'} />}
                              </Box>
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {consumedDisplay}
                              {isTrialLike && (
                                <Typography variant="caption" display="block" color="text.secondary">
                                  would-bill
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {chargedDisplay}
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {marginDisplay}
                              {isTrialLike && (
                                <Typography variant="caption" display="block" color="text.secondary">
                                  would-margin
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {formatUSD(a.pricing.infraUsd)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: mom.color, fontVariantNumeric: 'tabular-nums' }}>
                              {mom.label}
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.projectCount}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.appCount}</TableCell>
                            <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                              {isTrialLike && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<CreditCardIcon fontSize="small" />}
                                  onClick={() => setConvertTarget({ id: a.accountId, name: a.accountName })}
                                >
                                  Convert to Paid
                                </Button>
                              )}
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

      <ConvertAccountDialog
        open={!!convertTarget}
        accountId={convertTarget?.id ?? null}
        accountName={convertTarget?.name ?? null}
        onClose={() => setConvertTarget(null)}
        onConverted={(res) => {
          setConvertTarget(null)
          setConvertToast({ accountId: res.accountId, auditId: res.auditId })
          setReloadKey((k) => k + 1)
        }}
      />

      <Snackbar
        open={!!convertToast}
        autoHideDuration={8000}
        onClose={() => setConvertToast(null)}
        message={convertToast ? 'Account converted to BILLING.' : undefined}
        action={
          convertToast ? (
            <Link
              component="button"
              variant="body2"
              sx={{ color: 'primary.light', fontWeight: 600 }}
              onClick={() => {
                window.open(`/admin/audits/account/${convertToast.accountId}`, '_blank')
                setConvertToast(null)
              }}
            >
              View audit
            </Link>
          ) : undefined
        }
      />
    </motion.div>
  )
}

export default BillingTab
