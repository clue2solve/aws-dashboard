import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Tooltip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Divider,
  Stack,
} from '@mui/material'
import { motion } from 'framer-motion'
import ComputerIcon from '@mui/icons-material/Computer'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import RefreshIcon from '@mui/icons-material/Refresh'
import FilterListIcon from '@mui/icons-material/FilterList'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import InfoIcon from '@mui/icons-material/Info'
import CloseIcon from '@mui/icons-material/Close'
import StorageIcon from '@mui/icons-material/Storage'
import SecurityIcon from '@mui/icons-material/Security'
import HubIcon from '@mui/icons-material/Hub'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { apiFetch } from '../api'

interface UseHints {
  name?: string | null
  environment?: string | null
  owner?: string | null
  c2a_account?: string | null
  c2a_project?: string | null
  iam_profile?: string | null
}

interface Instance {
  instanceId: string
  name: string
  state: string
  instanceType: string
  privateIp: string
  publicIp: string | null
  launchTime: string
  uptime: string
  availabilityZone: string
  vpcId: string
  subnetId: string
  platform: string
  architecture: string
  tags: Record<string, string>
  // New optional fields — populated by the backend when EKS membership can be inferred
  parent_cluster?: string | null
  node_role_hint?: string | null
  use_hints?: UseHints | null
  monthly_estimate?: number | null
  estimated?: boolean
  unknownCluster?: boolean
  parent_cluster_conflict?: string[]
}

interface EC2Summary {
  total: number
  running: number
  stopped: number
  pending: number
  terminated: number
  byType: Record<string, number>
  byAz: Record<string, number>
}

interface InstanceDetails {
  instanceId: string
  name: string
  state: string
  instanceType: string
  privateIp: string
  publicIp: string | null
  launchTime: string
  availabilityZone: string
  vpcId: string
  subnetId: string
  platform: string
  architecture: string
  amiId: string
  keyName: string
  iamRole: string | null
  securityGroups: {
    groupId: string
    groupName: string
    inboundRules: number
    outboundRules: number
  }[]
  volumes: {
    volumeId: string
    deviceName: string
    size: number
    volumeType: string
    iops: number | null
    encrypted: boolean
  }[]
  tags: Record<string, string>
  monitoring: string
  cpuOptions: {
    CoreCount: number
    ThreadsPerCore: number
  } | null
}

function ComputeTab() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [summary, setSummary] = useState<EC2Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [selectedInstance, setSelectedInstance] = useState<InstanceDetails | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [instancesRes, summaryRes] = await Promise.all([
        apiFetch('/api/ec2/instances'),
        apiFetch('/api/ec2/summary'),
      ])

      const instancesData = await instancesRes.json()
      const summaryData = await summaryRes.json()

      if (instancesData.error) throw new Error(instancesData.error)
      // Backend may return either the flat {instances:[]} shape or the pre-bucketed
      // {groups:[{kind,instances:[]}]} shape (when group_by=cluster). Handle both so
      // the tab keeps working regardless of which backend is deployed.
      let flat: Instance[] = []
      if (Array.isArray(instancesData.groups)) {
        for (const g of instancesData.groups) {
          if (Array.isArray(g.instances)) flat = flat.concat(g.instances)
        }
      } else {
        flat = instancesData.instances || []
      }
      setInstances(flat)
      setSummary(summaryData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load EC2 data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleViewDetails = async (instanceId: string) => {
    setDetailsOpen(true)
    setDetailsLoading(true)
    try {
      const response = await apiFetch(`/api/ec2/instances/${instanceId}`)
      const data = await response.json()
      setSelectedInstance(data)
    } catch (err) {
      console.error('Failed to load instance details:', err)
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleInstanceAction = async (instanceId: string, action: 'start' | 'stop' | 'reboot') => {
    setActionLoading(instanceId)
    try {
      const response = await apiFetch(`/api/ec2/instances/${instanceId}/${action}`, {
        method: 'POST',
      })
      const data = await response.json()
      if (data.success) {
        // Refresh data after action
        setTimeout(() => fetchData(), 2000)
      } else {
        alert(`Failed to ${action} instance: ${data.detail}`)
      }
    } catch (err) {
      alert(`Failed to ${action} instance: ${err}`)
    } finally {
      setActionLoading(null)
    }
  }

  const getStateColor = (state: string) => {
    switch (state) {
      case 'running':
        return 'success'
      case 'stopped':
        return 'error'
      case 'pending':
      case 'stopping':
        return 'warning'
      default:
        return 'default'
    }
  }

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'running':
        return <CheckCircleIcon fontSize="small" />
      case 'stopped':
        return <ErrorIcon fontSize="small" />
      case 'pending':
      case 'stopping':
        return <WarningIcon fontSize="small" />
      default:
        return null
    }
  }

  const filteredInstances = instances.filter((instance) => {
    if (!filterText) return true
    const search = filterText.toLowerCase()
    return (
      instance.name.toLowerCase().includes(search) ||
      instance.instanceId.toLowerCase().includes(search) ||
      instance.instanceType.toLowerCase().includes(search) ||
      instance.state.toLowerCase().includes(search) ||
      (instance.privateIp && instance.privateIp.includes(search)) ||
      (instance.publicIp && instance.publicIp.includes(search)) ||
      (instance.parent_cluster && instance.parent_cluster.toLowerCase().includes(search))
    )
  })

  // Sort so that running instances come before stopped/other states inside each bucket.
  const stateRank = (s: string) => {
    switch (s) {
      case 'running':
        return 0
      case 'pending':
        return 1
      case 'stopping':
        return 2
      case 'stopped':
        return 3
      default:
        return 4
    }
  }

  // Partition into EKS-node bucket (parent_cluster != null) and orphans.
  // Within EKS nodes, sub-group by parent_cluster for the header breakdown.
  const groupedInstances = useMemo(() => {
    const clustered: Instance[] = []
    const orphans: Instance[] = []
    for (const inst of filteredInstances) {
      if (inst.parent_cluster) clustered.push(inst)
      else orphans.push(inst)
    }
    clustered.sort(
      (a, b) =>
        (a.parent_cluster || '').localeCompare(b.parent_cluster || '') ||
        stateRank(a.state) - stateRank(b.state) ||
        (a.name || '').localeCompare(b.name || '')
    )
    orphans.sort(
      (a, b) => stateRank(a.state) - stateRank(b.state) || (a.name || '').localeCompare(b.name || '')
    )
    // Per-cluster counts for the header breakdown
    const clusterBreakdown: Record<string, number> = {}
    for (const inst of clustered) {
      const key = inst.parent_cluster || 'unknown'
      clusterBreakdown[key] = (clusterBreakdown[key] || 0) + 1
    }
    return { clustered, orphans, clusterBreakdown }
  }, [filteredInstances])

  // Compact one-line use-hints for orphan rows.
  const summarizeUseHints = (hints: UseHints | null | undefined): string => {
    if (!hints) return ''
    const parts: string[] = []
    if (hints.name) parts.push(hints.name)
    if (hints.environment) parts.push(`env: ${hints.environment}`)
    if (hints.owner) parts.push(`owner: ${hints.owner}`)
    if (hints.c2a_project) parts.push(`project: ${hints.c2a_project}`)
    else if (hints.c2a_account) parts.push(`account: ${hints.c2a_account}`)
    if (parts.length === 0 && hints.iam_profile) parts.push(`iam: ${hints.iam_profile}`)
    return parts.slice(0, 3).join(' • ')
  }

  const formatMonthlyEstimate = (
    estimate: number | null | undefined,
    estimated: boolean | undefined,
    state: string
  ): string | null => {
    if (estimate === null || estimate === undefined) return null
    if (state !== 'running') return `$0/mo (${state})`
    return `$${estimate.toFixed(2)}/mo${estimated ? ' (est.)' : ''}`
  }

  // Shared row renderer — used by both the EKS-nodes and orphans tables so the row
  // markup stays in sync automatically.
  const renderInstanceRow = (instance: Instance) => {
    const monthly = formatMonthlyEstimate(
      instance.monthly_estimate,
      instance.estimated,
      instance.state
    )
    const useHintsSummary = summarizeUseHints(instance.use_hints)
    return (
      <TableRow key={instance.instanceId} hover>
        <TableCell>
          <Typography variant="body2" fontWeight="500">
            {instance.name || '-'}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
          >
            {instance.instanceId}
          </Typography>
        </TableCell>
        <TableCell>
          <Chip
            icon={getStateIcon(instance.state) || undefined}
            label={instance.state}
            size="small"
            color={getStateColor(instance.state) as any}
          />
        </TableCell>
        <TableCell sx={{ maxWidth: 260 }}>
          {instance.parent_cluster ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              <Tooltip
                title={
                  instance.unknownCluster
                    ? `Cluster '${instance.parent_cluster}' not returned by eks.list_clusters — likely a self-managed / legacy cluster`
                    : `View cluster ${instance.parent_cluster}`
                }
              >
                <Chip
                  icon={<HubIcon />}
                  label={instance.parent_cluster}
                  size="small"
                  color={instance.unknownCluster ? 'warning' : 'primary'}
                  clickable
                  onClick={() => {
                    // Open the cluster in a new browser tab preselected via ?cluster=<name>.
                    // Existing pattern in ClusterTab uses the same query param convention.
                    window.open(
                      `${window.location.origin}?cluster=${instance.parent_cluster}`,
                      '_blank'
                    )
                  }}
                />
              </Tooltip>
              {instance.node_role_hint && (
                <Tooltip
                  title={
                    instance.node_role_hint === 'self-managed'
                      ? 'Self-managed node (kubernetes.io/cluster tag but no eks:nodegroup-name)'
                      : `Managed nodegroup: ${instance.node_role_hint}`
                  }
                >
                  <Chip
                    label={instance.node_role_hint}
                    size="small"
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Tooltip>
              )}
              {instance.parent_cluster_conflict && instance.parent_cluster_conflict.length > 0 && (
                <Tooltip
                  title={`Conflicting cluster tags: ${instance.parent_cluster_conflict.join(', ')}`}
                >
                  <Chip
                    icon={<WarningIcon />}
                    label="conflict"
                    size="small"
                    color="warning"
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Tooltip>
              )}
            </Stack>
          ) : useHintsSummary ? (
            <Tooltip
              title={
                instance.use_hints?.iam_profile
                  ? `IAM: ${instance.use_hints.iam_profile}`
                  : 'No cluster membership detected'
              }
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontSize: '0.75rem', whiteSpace: 'normal' }}
              >
                {useHintsSummary}
              </Typography>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
              (unidentified)
            </Typography>
          )}
        </TableCell>
        <TableCell>
          <Chip label={instance.instanceType} size="small" variant="outlined" />
        </TableCell>
        <TableCell>
          {monthly ? (
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                fontVariantNumeric: 'tabular-nums',
                color: instance.state === 'running' ? 'text.primary' : 'text.disabled',
                whiteSpace: 'nowrap',
              }}
            >
              {monthly}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
              -
            </Typography>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {instance.privateIp || '-'}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontSize="0.75rem">
            {instance.availabilityZone}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2">{instance.uptime || '-'}</Typography>
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Details">
              <IconButton
                size="small"
                onClick={() => handleViewDetails(instance.instanceId)}
              >
                <InfoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {instance.state === 'stopped' && (
              <Tooltip title="Start">
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => handleInstanceAction(instance.instanceId, 'start')}
                  disabled={actionLoading === instance.instanceId}
                >
                  {actionLoading === instance.instanceId ? (
                    <CircularProgress size={16} />
                  ) : (
                    <PlayArrowIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            {instance.state === 'running' && (
              <>
                <Tooltip title="Stop">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleInstanceAction(instance.instanceId, 'stop')}
                    disabled={actionLoading === instance.instanceId}
                  >
                    {actionLoading === instance.instanceId ? (
                      <CircularProgress size={16} />
                    ) : (
                      <StopIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Reboot">
                  <IconButton
                    size="small"
                    color="warning"
                    onClick={() => handleInstanceAction(instance.instanceId, 'reboot')}
                    disabled={actionLoading === instance.instanceId}
                  >
                    <RestartAltIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>
        </TableCell>
      </TableRow>
    )
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>
  }

  return (
    <Box>
      {/* Summary Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={3}>
            <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h3" fontWeight="bold">
                  {summary?.total || 0}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  Total Instances
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card sx={{ bgcolor: 'success.main', color: 'white' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h3" fontWeight="bold">
                  {summary?.running || 0}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  Running
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card sx={{ bgcolor: 'error.main', color: 'white' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h3" fontWeight="bold">
                  {summary?.stopped || 0}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  Stopped
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="h3" fontWeight="bold" color="text.secondary">
                  {Object.keys(summary?.byType || {}).length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Instance Types
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </motion.div>

      {/* Instance Types & AZs */}
      {summary && (Object.keys(summary.byType).length > 0 || Object.keys(summary.byAz).length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent sx={{ py: 1.5 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    By Instance Type
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Object.entries(summary.byType)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <Chip
                          key={type}
                          label={`${type}: ${count}`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent sx={{ py: 1.5 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    By Availability Zone
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Object.entries(summary.byAz)
                      .sort((a, b) => b[1] - a[1])
                      .map(([az, count]) => (
                        <Chip key={az} label={`${az}: ${count}`} size="small" variant="outlined" />
                      ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </motion.div>
      )}

      {/* Instances — grouped by EKS membership */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ComputerIcon color="primary" />
                <Typography variant="h6" fontWeight="600">
                  EC2 Instances ({filteredInstances.length})
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Filter instances..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  sx={{ width: 250 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <FilterListIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
                <Button startIcon={<RefreshIcon />} onClick={fetchData} size="small">
                  Refresh
                </Button>
              </Box>
            </Box>

            {/* Section 1: EKS nodes */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <HubIcon fontSize="small" color="primary" />
                <Typography variant="subtitle1" fontWeight="600">
                  EKS nodes ({groupedInstances.clustered.length})
                </Typography>
                {Object.entries(groupedInstances.clusterBreakdown).length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', ml: 1 }}>
                    {Object.entries(groupedInstances.clusterBreakdown).map(([cluster, count]) => (
                      <Chip
                        key={cluster}
                        label={`${cluster}: ${count}`}
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    ))}
                  </Box>
                )}
              </Box>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Instance ID</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Cluster / Use</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Cost</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Private IP</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>AZ</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Uptime</TableCell>
                      <TableCell sx={{ fontWeight: 600, width: 180 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {groupedInstances.clustered.map((instance) =>
                      renderInstanceRow(instance)
                    )}
                    {groupedInstances.clustered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} align="center">
                          <Typography color="text.secondary" variant="body2">
                            No EKS nodes match the current filter.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {/* Section 2: Not in a cluster */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <WarningIcon fontSize="small" sx={{ color: 'warning.main' }} />
                <Typography variant="subtitle1" fontWeight="600">
                  Not in a cluster ({groupedInstances.orphans.length})
                </Typography>
                {groupedInstances.orphans.length > 0 && (
                  <Tooltip title="These EC2 instances are not tagged as EKS nodes. Their identifying tags (Name, Environment, Owner, c2a-project) are shown as chips.">
                    <HelpOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </Tooltip>
                )}
              </Box>

              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{
                  borderColor: groupedInstances.orphans.length > 0 ? 'warning.main' : 'divider',
                  borderStyle: 'solid',
                  borderWidth: groupedInstances.orphans.length > 0 ? 1 : 1,
                }}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Instance ID</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Cluster / Use</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Cost</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Private IP</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>AZ</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Uptime</TableCell>
                      <TableCell sx={{ fontWeight: 600, width: 180 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {groupedInstances.orphans.map((instance) =>
                      renderInstanceRow(instance)
                    )}
                    {groupedInstances.orphans.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} align="center">
                          <Typography color="text.secondary" variant="body2">
                            Every EC2 is accounted for by a cluster.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </CardContent>
        </Card>
      </motion.div>

      {/* Instance Details Modal */}
      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ComputerIcon color="primary" />
            Instance Details: {selectedInstance?.name || selectedInstance?.instanceId}
          </Box>
          <IconButton onClick={() => setDetailsOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {detailsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : selectedInstance ? (
            <Grid container spacing={3}>
              {/* Basic Info */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="primary" fontWeight="600" sx={{ mb: 1 }}>
                  Basic Information
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Instance ID</Typography>
                    <Typography variant="body2" fontFamily="monospace">{selectedInstance.instanceId}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">State</Typography>
                    <Chip label={selectedInstance.state} size="small" color={getStateColor(selectedInstance.state) as any} />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Type</Typography>
                    <Typography variant="body2">{selectedInstance.instanceType}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Platform</Typography>
                    <Typography variant="body2">{selectedInstance.platform}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Architecture</Typography>
                    <Typography variant="body2">{selectedInstance.architecture}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">AMI ID</Typography>
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">{selectedInstance.amiId}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Key Pair</Typography>
                    <Typography variant="body2">{selectedInstance.keyName || '-'}</Typography>
                  </Box>
                </Box>
              </Grid>

              {/* Network Info */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="primary" fontWeight="600" sx={{ mb: 1 }}>
                  Network
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Private IP</Typography>
                    <Typography variant="body2" fontFamily="monospace">{selectedInstance.privateIp || '-'}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Public IP</Typography>
                    <Typography variant="body2" fontFamily="monospace">{selectedInstance.publicIp || '-'}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">VPC ID</Typography>
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">{selectedInstance.vpcId}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Subnet ID</Typography>
                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">{selectedInstance.subnetId}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">AZ</Typography>
                    <Typography variant="body2">{selectedInstance.availabilityZone}</Typography>
                  </Box>
                </Box>
              </Grid>

              {/* Security Groups */}
              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <SecurityIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" color="primary" fontWeight="600">
                    Security Groups ({selectedInstance.securityGroups?.length || 0})
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {selectedInstance.securityGroups?.map((sg) => (
                    <Chip
                      key={sg.groupId}
                      label={`${sg.groupName} (In: ${sg.inboundRules}, Out: ${sg.outboundRules})`}
                      size="small"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Grid>

              {/* Volumes */}
              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <StorageIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" color="primary" fontWeight="600">
                    Volumes ({selectedInstance.volumes?.length || 0})
                  </Typography>
                </Box>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Volume ID</TableCell>
                        <TableCell>Device</TableCell>
                        <TableCell>Size</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>IOPS</TableCell>
                        <TableCell>Encrypted</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedInstance.volumes?.map((vol) => (
                        <TableRow key={vol.volumeId}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{vol.volumeId}</TableCell>
                          <TableCell>{vol.deviceName}</TableCell>
                          <TableCell>{vol.size} GB</TableCell>
                          <TableCell>{vol.volumeType}</TableCell>
                          <TableCell>{vol.iops || '-'}</TableCell>
                          <TableCell>{vol.encrypted ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>

              {/* Tags */}
              {selectedInstance.tags && Object.keys(selectedInstance.tags).length > 0 && (
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" color="primary" fontWeight="600" sx={{ mb: 1 }}>
                    Tags ({Object.keys(selectedInstance.tags).length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Object.entries(selectedInstance.tags).map(([key, value]) => (
                      <Chip
                        key={key}
                        label={`${key}: ${value}`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Grid>
              )}
            </Grid>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  )
}

export default ComputeTab
