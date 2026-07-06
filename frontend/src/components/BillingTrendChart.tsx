import { useEffect, useMemo, useState } from 'react'
import { Box, Card, CardContent, Typography, Chip, Stack, CircularProgress, Alert, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import { coordinatorGet, ApiError } from '../api'

// --- API types ----------------------------------------------------------

interface TrendBucket {
  start: string // "YYYY-MM-01" (or ISO week start)
  revenueUsd: number
  infraUsd: number
  marginUsd: number
}

interface TrendResponse {
  buckets: TrendBucket[]
}

type Granularity = 'month' | 'week'

function formatUSD(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatBucketLabel(start: string, granularity: Granularity): string {
  const d = new Date(start + (start.length === 10 ? 'T00:00:00Z' : ''))
  if (Number.isNaN(d.getTime())) return start
  if (granularity === 'week') {
    const weekNum = Math.ceil(
      ((d.getTime() - new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getTime()) / 86400000 + 1) / 7,
    )
    return `W${weekNum}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

// --- chart geometry -------------------------------------------------------

const WIDTH = 720
const HEIGHT = 220
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 }
const CHART_W = WIDTH - PADDING.left - PADDING.right
const CHART_H = HEIGHT - PADDING.top - PADDING.bottom

function buildPoints(values: number[], yMax: number): { x: number; y: number }[] {
  const n = values.length
  return values.map((v, i) => {
    const x = n > 1 ? PADDING.left + (i * CHART_W) / (n - 1) : PADDING.left + CHART_W / 2
    const y = PADDING.top + CHART_H - (yMax === 0 ? 0 : (v / yMax) * CHART_H)
    return { x, y }
  })
}

function pointsToStr(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function areaPathBetween(top: { x: number; y: number }[], bottom: { x: number; y: number }[]): string {
  if (top.length === 0) return ''
  const forward = top.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const backward = [...bottom]
    .reverse()
    .map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  return `${forward} ${backward} Z`
}

// --- component ------------------------------------------------------------

function BillingTrendChart() {
  const theme = useTheme()
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await coordinatorGet<TrendResponse>(
          `/api/v1/billing/trend?months=12&bucket=${granularity}`,
        )
        if (cancelled) return
        setData(res)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError && err.status === 403
            ? 'SYSTEM privileges required to view billing.'
            : err instanceof Error
              ? err.message
              : 'Failed to load trend data'
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [granularity])

  const buckets = data?.buckets ?? []

  const { revenuePoints, infraPoints, gridLines } = useMemo(() => {
    const revenue = buckets.map((b) => b.revenueUsd)
    const infra = buckets.map((b) => b.infraUsd)
    const maxVal = Math.max(1, ...revenue, ...infra)
    const yMaxLocal = Math.ceil(maxVal * 1.1)
    return {
      revenuePoints: buildPoints(revenue, yMaxLocal),
      infraPoints: buildPoints(infra, yMaxLocal),
      yMax: yMaxLocal,
      gridLines: [0, 0.25, 0.5, 0.75, 1].map((f) => ({
        value: yMaxLocal * f,
        y: PADDING.top + CHART_H - f * CHART_H,
      })),
    }
  }, [buckets])

  const areaPath = areaPathBetween(revenuePoints, infraPoints)
  const hasData = buckets.length > 0

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!hasData) return
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH
    const n = buckets.length
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const px = n > 1 ? PADDING.left + (i * CHART_W) / (n - 1) : PADDING.left + CHART_W / 2
      const d = Math.abs(px - relX)
      if (d < best) {
        best = d
        nearest = i
      }
    }
    setHoverIdx(nearest)
  }

  const hoverBucket = hoverIdx !== null ? buckets[hoverIdx] : null
  const hoverPoint = hoverIdx !== null ? revenuePoints[hoverIdx] : null

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <ShowChartIcon color="primary" />
            <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
              Revenue Trend
            </Typography>
            <Stack direction="row" spacing={1}>
              <Chip
                label="Month"
                size="small"
                onClick={() => setGranularity('month')}
                color={granularity === 'month' ? 'primary' : 'default'}
                variant={granularity === 'month' ? 'filled' : 'outlined'}
              />
              <Chip
                label="Week"
                size="small"
                onClick={() => setGranularity('week')}
                color={granularity === 'week' ? 'primary' : 'default'}
                variant={granularity === 'week' ? 'filled' : 'outlined'}
              />
            </Stack>
          </Box>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {!loading && error && <Alert severity="error">{error}</Alert>}

          {!loading && !error && !hasData && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No trend data available.
            </Typography>
          )}

          {!loading && !error && hasData && (
            <Box sx={{ position: 'relative', width: '100%', height: HEIGHT }}>
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                width="100%"
                height={HEIGHT}
                preserveAspectRatio="none"
                style={{ overflow: 'visible' }}
              >
                <defs>
                  <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.03} />
                  </linearGradient>
                </defs>

                {/* Y gridlines + labels */}
                {gridLines.map((g, i) => (
                  <g key={i}>
                    <line
                      x1={PADDING.left}
                      x2={WIDTH - PADDING.right}
                      y1={g.y}
                      y2={g.y}
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={1}
                    />
                    <text
                      x={PADDING.left - 8}
                      y={g.y + 4}
                      textAnchor="end"
                      fontSize={10}
                      fill="rgba(255,255,255,0.45)"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatUSD(g.value)}
                    </text>
                  </g>
                ))}

                {/* X labels */}
                {buckets.map((b, i) => {
                  const p = revenuePoints[i]
                  return (
                    <text
                      key={b.start}
                      x={p.x}
                      y={HEIGHT - 8}
                      textAnchor="middle"
                      fontSize={11}
                      fill="rgba(255,255,255,0.55)"
                    >
                      {formatBucketLabel(b.start, granularity)}
                    </text>
                  )
                })}

                {/* Margin fill */}
                <motion.path
                  d={areaPath}
                  fill="url(#marginGradient)"
                  opacity={0.6}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.6 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />

                {/* Infra line (muted) */}
                <motion.polyline
                  points={pointsToStr(infraPoints)}
                  fill="none"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth={2}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                {infraPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 5 : 3} fill="rgba(255,255,255,0.6)" />
                ))}

                {/* Revenue line (brand orange) */}
                <motion.polyline
                  points={pointsToStr(revenuePoints)}
                  fill="none"
                  stroke={theme.palette.primary.main}
                  strokeWidth={2.5}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                {revenuePoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={hoverIdx === i ? 5 : 3}
                    fill={theme.palette.primary.main}
                  />
                ))}

                {/* Hover guide line */}
                {hoverPoint && (
                  <line
                    x1={hoverPoint.x}
                    x2={hoverPoint.x}
                    y1={PADDING.top}
                    y2={PADDING.top + CHART_H}
                    stroke="rgba(255,255,255,0.25)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                )}

                {/* Invisible hover-capture overlay */}
                <rect
                  x={PADDING.left}
                  y={PADDING.top}
                  width={CHART_W}
                  height={CHART_H}
                  fill="transparent"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              </svg>

              {hoverBucket && hoverPoint && (
                <Box
                  sx={{
                    position: 'absolute',
                    left: `${Math.min(Math.max((hoverPoint.x / WIDTH) * 100, 12), 88)}%`,
                    top: 8,
                    transform: 'translateX(-50%)',
                    bgcolor: 'background.paper',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 1,
                    pointerEvents: 'none',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
                    minWidth: 150,
                  }}
                >
                  <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
                    {formatBucketLabel(hoverBucket.start, granularity)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', color: theme.palette.primary.main, fontVariantNumeric: 'tabular-nums' }}
                  >
                    Revenue: {formatUSD(hoverBucket.revenueUsd)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    Infra: {formatUSD(hoverBucket.infraUsd)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', color: 'success.main', fontVariantNumeric: 'tabular-nums' }}
                  >
                    Margin: {formatUSD(hoverBucket.marginUsd)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default BillingTrendChart
