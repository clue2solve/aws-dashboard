import { useState, useEffect, useCallback } from 'react'
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
import { apiFetch } from '../api'

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
      setInstances(instancesData.instances || [])
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
      (instance.publicIp && instance.publicIp.includes(search))
    )
  })

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

      {/* Instances Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
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

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Instance ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Private IP</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Public IP</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>AZ</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Uptime</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 180 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredInstances.map((instance) => (
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
                      <TableCell>
                        <Chip label={instance.instanceType} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {instance.privateIp || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {instance.publicIp || '-'}
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
                  ))}
                  {filteredInstances.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center">
                        <Typography color="text.secondary">No instances found</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
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
