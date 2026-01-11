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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Snackbar,
  Tooltip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
} from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import CloudIcon from '@mui/icons-material/Cloud'
import FolderIcon from '@mui/icons-material/Folder'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import ViewInArIcon from '@mui/icons-material/ViewInAr'
import SettingsIcon from '@mui/icons-material/Settings'
import DnsIcon from '@mui/icons-material/Dns'
import RefreshIcon from '@mui/icons-material/Refresh'
import UpgradeIcon from '@mui/icons-material/Upgrade'
import AttachMoneyIcon from '@mui/icons-material/AttachMoney'
import AllInclusiveIcon from '@mui/icons-material/AllInclusive'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import StorageIcon from '@mui/icons-material/Storage'
import LockIcon from '@mui/icons-material/Lock'
import LanguageIcon from '@mui/icons-material/Language'
import ScheduleIcon from '@mui/icons-material/Schedule'
import EventIcon from '@mui/icons-material/Event'
import ComputerIcon from '@mui/icons-material/Computer'
import LayersIcon from '@mui/icons-material/Layers'
import FilterListIcon from '@mui/icons-material/FilterList'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import InfoIcon from '@mui/icons-material/Info'
import CodeIcon from '@mui/icons-material/Code'
import DeleteIcon from '@mui/icons-material/Delete'
import ArticleIcon from '@mui/icons-material/Article'
import HistoryIcon from '@mui/icons-material/History'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import TuneIcon from '@mui/icons-material/Tune'
import CloseIcon from '@mui/icons-material/Close'

const API_BASE = 'http://localhost:54321/api'

interface EksCluster {
  name: string
  status: string
  version: string
  endpoint: string
  arn: string
  createdAt: string
  platformVersion: string
  vpcId: string
  publicAccess: boolean
  privateAccess: boolean
  error?: string
}

interface ClusterCosts {
  last30Days: number | null
  last7Days: number | null
  lastDay: number | null
}

interface UpgradeStatus {
  currentVersion: string
  latestVersion: string
  isUpToDate: boolean
  availableUpgrades: string[]
  upgradeRecommended: boolean
}

interface Namespace {
  name: string
  status: string
  createdAt: string
  labels: Record<string, string>
}

interface ScalingStatus {
  clusterState: 'running' | 'scaled_down' | 'scaling'
  totalDesiredNodes: number
  nodegroups: {
    name: string
    status: string
    desiredSize: number
    minSize: number
    maxSize: number
  }[]
}

// Resource type definition
interface ResourceType {
  key: string
  label: string
  shortcut: string
  icon: React.ReactNode
  endpoint: string
  dataKey: string
  columns: { key: string; label: string; width?: number }[]
}

const RESOURCE_TYPES: ResourceType[] = [
  {
    key: 'pods',
    label: 'Pods',
    shortcut: 'p',
    icon: <ViewInArIcon />,
    endpoint: 'all-pods',
    dataKey: 'pods',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'ready', label: 'Ready' },
      { key: 'restarts', label: 'Restarts' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'deployments',
    label: 'Deployments',
    shortcut: 'd',
    icon: <SettingsIcon />,
    endpoint: 'all-deployments',
    dataKey: 'deployments',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'ready', label: 'Ready' },
      { key: 'upToDate', label: 'Up-to-date' },
      { key: 'available', label: 'Available' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'services',
    label: 'Services',
    shortcut: 's',
    icon: <DnsIcon />,
    endpoint: 'all-services',
    dataKey: 'services',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'clusterIP', label: 'Cluster IP' },
      { key: 'ports', label: 'Ports' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'configmaps',
    label: 'ConfigMaps',
    shortcut: 'c',
    icon: <StorageIcon />,
    endpoint: 'all-configmaps',
    dataKey: 'configmaps',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'dataCount', label: 'Data' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'secrets',
    label: 'Secrets',
    shortcut: 'e',
    icon: <LockIcon />,
    endpoint: 'all-secrets',
    dataKey: 'secrets',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'dataCount', label: 'Data' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'ingresses',
    label: 'Ingresses',
    shortcut: 'i',
    icon: <LanguageIcon />,
    endpoint: 'all-ingresses',
    dataKey: 'ingresses',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'class', label: 'Class' },
      { key: 'hosts', label: 'Hosts' },
      { key: 'address', label: 'Address' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'statefulsets',
    label: 'StatefulSets',
    shortcut: 't',
    icon: <LayersIcon />,
    endpoint: 'all-statefulsets',
    dataKey: 'statefulsets',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'ready', label: 'Ready' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'daemonsets',
    label: 'DaemonSets',
    shortcut: 'a',
    icon: <LayersIcon />,
    endpoint: 'all-daemonsets',
    dataKey: 'daemonsets',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'desired', label: 'Desired' },
      { key: 'current', label: 'Current' },
      { key: 'ready', label: 'Ready' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'jobs',
    label: 'Jobs',
    shortcut: 'j',
    icon: <ScheduleIcon />,
    endpoint: 'all-jobs',
    dataKey: 'jobs',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'completions', label: 'Completions' },
      { key: 'active', label: 'Active' },
      { key: 'failed', label: 'Failed' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'cronjobs',
    label: 'CronJobs',
    shortcut: 'o',
    icon: <ScheduleIcon />,
    endpoint: 'all-cronjobs',
    dataKey: 'cronjobs',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'name', label: 'Name' },
      { key: 'schedule', label: 'Schedule' },
      { key: 'suspend', label: 'Suspend' },
      { key: 'active', label: 'Active' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'nodes',
    label: 'Nodes',
    shortcut: 'n',
    icon: <ComputerIcon />,
    endpoint: 'nodes',
    dataKey: 'nodes',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'roles', label: 'Roles' },
      { key: 'version', label: 'Version' },
      { key: 'cpu', label: 'CPU' },
      { key: 'memory', label: 'Memory' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    key: 'events',
    label: 'Events',
    shortcut: 'v',
    icon: <EventIcon />,
    endpoint: 'all-events',
    dataKey: 'events',
    columns: [
      { key: 'namespace', label: 'Namespace' },
      { key: 'type', label: 'Type' },
      { key: 'reason', label: 'Reason' },
      { key: 'object', label: 'Object' },
      { key: 'message', label: 'Message', width: 300 },
      { key: 'count', label: 'Count' },
      { key: 'age', label: 'Age' },
    ],
  },
]

interface ClusterTabProps {
  initialCluster?: string | null
  focusedView?: boolean
}

function ClusterTab({ initialCluster, focusedView = false }: ClusterTabProps) {
  // EKS state
  const [eksClusters, setEksClusters] = useState<EksCluster[]>([])
  const [clusterCosts, setClusterCosts] = useState<Record<string, ClusterCosts>>({})
  const [upgradeStatuses, setUpgradeStatuses] = useState<Record<string, UpgradeStatus>>({})
  const [selectedEksCluster, setSelectedEksCluster] = useState<string>('')
  const [eksLoading, setEksLoading] = useState(true)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_connecting, setConnecting] = useState(false)

  // Kubernetes state
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [selectedNamespace, setSelectedNamespace] = useState<string>('__all__')
  const [selectedResourceType, setSelectedResourceType] = useState<string>('pods')
  const [resources, setResources] = useState<any[]>([])
  const [resourceLoading, setResourceLoading] = useState(false)
  const [filterText, setFilterText] = useState('')

  // UI state
  const [error, setError] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  })
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandSearch, setCommandSearch] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [eventsModalOpen, setEventsModalOpen] = useState(false)
  const [nodesModalOpen, setNodesModalOpen] = useState(false)
  const [clusterDetailsExpanded, setClusterDetailsExpanded] = useState(false)
  const [modalEvents, setModalEvents] = useState<any[]>([])
  const [modalNodes, setModalNodes] = useState<any[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [scalingStatus, setScalingStatus] = useState<Record<string, ScalingStatus>>({})
  const [scalingAction, setScalingAction] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [stopConfirmInput, setStopConfirmInput] = useState('')
  const [clusterToStop, setClusterToStop] = useState('')

  // Resource action state
  const [selectedResource, setSelectedResource] = useState<any>(null)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [logsContent, setLogsContent] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsPrevious, setLogsPrevious] = useState(false)
  const [describeModalOpen, setDescribeModalOpen] = useState(false)
  const [describeContent, setDescribeContent] = useState('')
  const [describeLoading, setDescribeLoading] = useState(false)
  const [yamlModalOpen, setYamlModalOpen] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlLoading, setYamlLoading] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [scaleDialogOpen, setScaleDialogOpen] = useState(false)
  const [scaleReplicas, setScaleReplicas] = useState(1)
  const [actionLoading, setActionLoading] = useState(false)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Command palette
      if (e.key === ':') {
        e.preventDefault()
        setCommandSearch('')
        setCommandPaletteOpen(true)
        return
      }

      // Help
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      // Filter
      if (e.key === '/') {
        e.preventDefault()
        document.getElementById('filter-input')?.focus()
        return
      }

      // Refresh
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (selectedEksCluster) {
          fetchResources(selectedEksCluster, selectedResourceType)
        }
        return
      }

      // Escape
      if (e.key === 'Escape') {
        setFilterText('')
        setCommandPaletteOpen(false)
        setHelpOpen(false)
        return
      }

      // Resource type shortcuts
      const resourceType = RESOURCE_TYPES.find((rt) => rt.shortcut === e.key.toLowerCase())
      if (resourceType && selectedEksCluster) {
        e.preventDefault()
        setSelectedResourceType(resourceType.key)
        fetchResources(selectedEksCluster, resourceType.key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEksCluster, selectedResourceType])

  // Fetch EKS clusters on mount
  useEffect(() => {
    fetchEksClusters()
  }, [])

  // Auto-connect if initialCluster is provided
  useEffect(() => {
    if (initialCluster && eksClusters.length > 0 && !selectedEksCluster) {
      const clusterExists = eksClusters.some(c => c.name === initialCluster)
      if (clusterExists) {
        handleConnectToCluster(initialCluster)
      }
    }
  }, [initialCluster, eksClusters])

  const fetchEksClusters = async () => {
    setEksLoading(true)
    try {
      const [clustersRes, costsRes] = await Promise.all([
        fetch('/api/eks/clusters'),
        fetch('/api/eks/costs-summary'),
      ])

      const clustersData = await clustersRes.json()
      const costsData = await costsRes.json()

      if (clustersData.error) throw new Error(clustersData.error)
      setEksClusters(clustersData.clusters || [])
      setClusterCosts(costsData.perClusterCosts || {})

      // Fetch upgrade status for each cluster
      const clusters = clustersData.clusters || []
      const upgradePromises = clusters.map((c: EksCluster) =>
        fetch(`/api/eks/clusters/${c.name}/upgrade-status`).then((r) => r.json())
      )
      const upgradeResults = await Promise.all(upgradePromises)

      const statuses: Record<string, UpgradeStatus> = {}
      upgradeResults.forEach((result, i) => {
        if (!result.error) {
          statuses[clusters[i].name] = result
        }
      })
      setUpgradeStatuses(statuses)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load EKS clusters')
    } finally {
      setEksLoading(false)
    }
  }

  const handleConnectToCluster = async (clusterName: string) => {
    setConnecting(true)
    try {
      const response = await fetch(`/api/eks/clusters/${clusterName}/connect`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to connect')
      }

      setSnackbar({ open: true, message: `Connected to ${clusterName}!`, severity: 'success' })
      setSelectedEksCluster(clusterName)

      // Fetch namespaces for the connected cluster
      const nsResponse = await fetch(`/api/clusters/${clusterName}/namespaces`)
      const nsData = await nsResponse.json()
      setNamespaces(nsData.namespaces || [])
      setSelectedNamespace('__all__')

      // Fetch resources
      fetchResources(clusterName, selectedResourceType)
    } catch (err) {
      setSnackbar({
        open: true,
        message: err instanceof Error ? err.message : 'Failed to connect',
        severity: 'error',
      })
    } finally {
      setConnecting(false)
    }
  }

  const fetchResources = useCallback(async (clusterName: string, resourceType: string) => {
    setResourceLoading(true)
    try {
      const rt = RESOURCE_TYPES.find((r) => r.key === resourceType)
      if (!rt) return

      const response = await fetch(`/api/clusters/${clusterName}/${rt.endpoint}`)
      const data = await response.json()
      setResources(data[rt.dataKey] || [])
    } catch (err) {
      console.error('Failed to load resources:', err)
    } finally {
      setResourceLoading(false)
    }
  }, [])

  // Fetch resources when resource type changes
  useEffect(() => {
    if (selectedEksCluster) {
      fetchResources(selectedEksCluster, selectedResourceType)
    }
  }, [selectedResourceType, selectedEksCluster, fetchResources])

  const openEventsModal = async () => {
    setEventsModalOpen(true)
    setModalLoading(true)
    try {
      const response = await fetch(`/api/clusters/${selectedEksCluster}/all-events`)
      const data = await response.json()
      setModalEvents(data.events || [])
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setModalLoading(false)
    }
  }

  const openNodesModal = async () => {
    setNodesModalOpen(true)
    setModalLoading(true)
    try {
      const response = await fetch(`/api/clusters/${selectedEksCluster}/nodes`)
      const data = await response.json()
      setModalNodes(data.nodes || [])
    } catch (err) {
      console.error('Failed to load nodes:', err)
    } finally {
      setModalLoading(false)
    }
  }

  const fetchScalingStatus = async (clusterName: string) => {
    try {
      const response = await fetch(`/api/eks/clusters/${clusterName}/scaling-status`)
      const data = await response.json()
      setScalingStatus(prev => ({ ...prev, [clusterName]: data }))
    } catch (err) {
      console.error('Failed to fetch scaling status:', err)
    }
  }

  const openStopConfirmation = (clusterName: string) => {
    setClusterToStop(clusterName)
    setStopConfirmInput('')
    setStopConfirmOpen(true)
  }

  const handleScaleDown = async () => {
    if (stopConfirmInput !== clusterToStop) {
      return
    }
    setStopConfirmOpen(false)
    setScalingAction(true)
    try {
      const response = await fetch(`/api/eks/clusters/${clusterToStop}/scale-down`, { method: 'POST' })
      const data = await response.json()
      if (data.success) {
        setSnackbar({ open: true, message: `Scaling down ${clusterToStop}...`, severity: 'success' })
        // Update status after a delay
        setTimeout(() => fetchScalingStatus(clusterToStop), 2000)
      } else {
        throw new Error(data.detail || 'Scale down failed')
      }
    } catch (err) {
      setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Scale down failed', severity: 'error' })
    } finally {
      setScalingAction(false)
      setClusterToStop('')
      setStopConfirmInput('')
    }
  }

  const handleScaleUp = async (clusterName: string) => {
    setScalingAction(true)
    try {
      const response = await fetch(`/api/eks/clusters/${clusterName}/scale-up`, { method: 'POST' })
      const data = await response.json()
      if (data.success) {
        setSnackbar({ open: true, message: `Scaling up ${clusterName}...`, severity: 'success' })
        // Update status after a delay
        setTimeout(() => fetchScalingStatus(clusterName), 2000)
      } else {
        throw new Error(data.detail || 'Scale up failed')
      }
    } catch (err) {
      setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Scale up failed', severity: 'error' })
    } finally {
      setScalingAction(false)
    }
  }

  // Fetch scaling status when cluster is selected
  useEffect(() => {
    if (selectedEksCluster && !scalingStatus[selectedEksCluster]) {
      fetchScalingStatus(selectedEksCluster)
    }
  }, [selectedEksCluster])

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'running':
      case 'active':
      case 'succeeded':
      case 'ready':
      case 'bound':
        return 'success'
      case 'pending':
      case 'containercreating':
      case 'creating':
      case 'normal':
        return 'warning'
      case 'failed':
      case 'error':
      case 'crashloopbackoff':
      case 'deleting':
      case 'notready':
      case 'warning':
        return 'error'
      default:
        return 'default'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'running':
      case 'active':
      case 'ready':
        return <CheckCircleIcon fontSize="small" color="success" />
      case 'pending':
      case 'creating':
      case 'normal':
        return <WarningIcon fontSize="small" color="warning" />
      case 'failed':
      case 'error':
      case 'warning':
        return <ErrorIcon fontSize="small" color="error" />
      default:
        return null
    }
  }

  // ============================================================================
  // RESOURCE ACTION HANDLERS
  // ============================================================================

  const handleViewLogs = async (resource: any, previous: boolean = false) => {
    if (!selectedEksCluster) return
    setSelectedResource(resource)
    setLogsPrevious(previous)
    setLogsModalOpen(true)
    setLogsLoading(true)
    setLogsContent('')

    try {
      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/pods/${resource.namespace}/${resource.name}/logs?previous=${previous}&tail=500`
      )
      const data = await response.json()
      setLogsContent(data.error || data.logs || 'No logs available')
    } catch (error) {
      setLogsContent(`Error fetching logs: ${error}`)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleDescribe = async (resource: any, resourceType: string) => {
    if (!selectedEksCluster) return
    setSelectedResource(resource)
    setDescribeModalOpen(true)
    setDescribeLoading(true)
    setDescribeContent('')

    try {
      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/resources/${resourceType}/${resource.namespace}/${resource.name}/describe`
      )
      const data = await response.json()
      setDescribeContent(data.error || data.describe || 'No description available')
    } catch (error) {
      setDescribeContent(`Error fetching description: ${error}`)
    } finally {
      setDescribeLoading(false)
    }
  }

  const handleViewYaml = async (resource: any, resourceType: string) => {
    if (!selectedEksCluster) return
    setSelectedResource(resource)
    setYamlModalOpen(true)
    setYamlLoading(true)
    setYamlContent('')

    try {
      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/resources/${resourceType}/${resource.namespace}/${resource.name}/yaml`
      )
      const data = await response.json()
      setYamlContent(data.error || data.yaml || 'No YAML available')
    } catch (error) {
      setYamlContent(`Error fetching YAML: ${error}`)
    } finally {
      setYamlLoading(false)
    }
  }

  const handleDeleteResource = async () => {
    if (!selectedEksCluster || !selectedResource) return
    setDeleteLoading(true)

    try {
      const resourceType = selectedResourceType === 'pods' ? 'pod' :
                          selectedResourceType === 'deployments' ? 'deployment' :
                          selectedResourceType === 'services' ? 'service' :
                          selectedResourceType === 'configmaps' ? 'configmap' :
                          selectedResourceType === 'secrets' ? 'secret' :
                          selectedResourceType === 'statefulsets' ? 'statefulset' :
                          selectedResourceType === 'daemonsets' ? 'daemonset' :
                          selectedResourceType === 'jobs' ? 'job' :
                          selectedResourceType === 'cronjobs' ? 'cronjob' : selectedResourceType

      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/resources/${resourceType}/${selectedResource.namespace}/${selectedResource.name}`,
        { method: 'DELETE' }
      )
      const data = await response.json()

      if (response.ok) {
        setDeleteConfirmOpen(false)
        fetchResources(selectedEksCluster, selectedResourceType)
      } else {
        alert(`Error: ${data.detail || 'Failed to delete resource'}`)
      }
    } catch (error) {
      alert(`Error: ${error}`)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleRestartDeployment = async (resource: any) => {
    if (!selectedEksCluster) return
    setActionLoading(true)

    try {
      const resourceType = selectedResourceType === 'deployments' ? 'deployments' :
                          selectedResourceType === 'statefulsets' ? 'statefulsets' :
                          selectedResourceType === 'daemonsets' ? 'daemonsets' : 'deployments'

      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/${resourceType}/${resource.namespace}/${resource.name}/restart`,
        { method: 'POST' }
      )
      const data = await response.json()

      if (response.ok) {
        alert(`Restart initiated: ${data.message}`)
        fetchResources(selectedEksCluster, selectedResourceType)
      } else {
        alert(`Error: ${data.detail || 'Failed to restart'}`)
      }
    } catch (error) {
      alert(`Error: ${error}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleScaleDeployment = async () => {
    if (!selectedEksCluster || !selectedResource) return
    setActionLoading(true)

    try {
      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/deployments/${selectedResource.namespace}/${selectedResource.name}/scale?replicas=${scaleReplicas}`,
        { method: 'POST' }
      )
      const data = await response.json()

      if (response.ok) {
        setScaleDialogOpen(false)
        fetchResources(selectedEksCluster, selectedResourceType)
      } else {
        alert(`Error: ${data.detail || 'Failed to scale'}`)
      }
    } catch (error) {
      alert(`Error: ${error}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleTriggerCronJob = async (resource: any) => {
    if (!selectedEksCluster) return
    setActionLoading(true)

    try {
      const response = await fetch(
        `${API_BASE}/clusters/${selectedEksCluster}/cronjobs/${resource.namespace}/${resource.name}/trigger`,
        { method: 'POST' }
      )
      const data = await response.json()

      if (response.ok) {
        alert(`CronJob triggered! Created job: ${data.jobName}`)
      } else {
        alert(`Error: ${data.detail || 'Failed to trigger CronJob'}`)
      }
    } catch (error) {
      alert(`Error: ${error}`)
    } finally {
      setActionLoading(false)
    }
  }

  const getResourceActions = (resource: any): React.ReactNode => {
    const resourceType = selectedResourceType

    const commonActions = (
      <>
        <Tooltip title="Describe (d)">
          <IconButton size="small" onClick={() => handleDescribe(resource, resourceType.slice(0, -1))}>
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="YAML (y)">
          <IconButton size="small" onClick={() => handleViewYaml(resource, resourceType.slice(0, -1))}>
            <CodeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete (Ctrl+D)">
          <IconButton size="small" color="error" onClick={() => { setSelectedResource(resource); setDeleteConfirmOpen(true); }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    )

    switch (resourceType) {
      case 'pods':
        return (
          <>
            <Tooltip title="Logs (l)">
              <IconButton size="small" onClick={() => handleViewLogs(resource, false)}>
                <ArticleIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Previous Logs (L)">
              <IconButton size="small" onClick={() => handleViewLogs(resource, true)}>
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {commonActions}
          </>
        )

      case 'deployments':
      case 'statefulsets':
      case 'daemonsets':
        return (
          <>
            <Tooltip title="Restart (r)">
              <IconButton size="small" onClick={() => handleRestartDeployment(resource)} disabled={actionLoading}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {resourceType === 'deployments' && (
              <Tooltip title="Scale">
                <IconButton size="small" onClick={() => { setSelectedResource(resource); setScaleReplicas(1); setScaleDialogOpen(true); }}>
                  <TuneIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {commonActions}
          </>
        )

      case 'cronjobs':
        return (
          <>
            <Tooltip title="Trigger Now">
              <IconButton size="small" onClick={() => handleTriggerCronJob(resource)} disabled={actionLoading}>
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {commonActions}
          </>
        )

      default:
        return commonActions
    }
  }

  const formatAge = (timestamp: string) => {
    if (!timestamp) return '-'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMinutes = Math.floor(diffMs / (1000 * 60))

    if (diffDays > 0) return `${diffDays}d`
    if (diffHours > 0) return `${diffHours}h`
    return `${diffMinutes}m`
  }

  const formatCost = (cost: number | null | undefined) => {
    if (cost === null || cost === undefined) return '-'
    return `$${cost.toFixed(2)}`
  }

  const formatCellValue = (row: any, key: string) => {
    const value = row[key]
    if (key === 'age') return formatAge(value)
    if (key === 'ports' && Array.isArray(value)) return value.slice(0, 2).join(', ') + (value.length > 2 ? '...' : '')
    if (key === 'hosts' && Array.isArray(value)) return value.join(', ')
    if (key === 'roles' && Array.isArray(value)) return value.join(', ') || '-'
    if (key === 'accessModes' && Array.isArray(value)) return value.join(', ')
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (value === null || value === undefined) return '-'
    return String(value)
  }

  // Filter resources
  const filteredResources = resources.filter((r) => {
    if (!filterText) return true
    const searchText = filterText.toLowerCase()
    return Object.values(r).some((v) => {
      if (typeof v === 'string') return v.toLowerCase().includes(searchText)
      if (Array.isArray(v)) return v.some((item) => String(item).toLowerCase().includes(searchText))
      return String(v).toLowerCase().includes(searchText)
    })
  })

  const currentResourceType = RESOURCE_TYPES.find((r) => r.key === selectedResourceType)

  if (eksLoading) {
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: focusedView ? 'calc(100vh - 80px)' : 'calc(100vh - 200px)' }}>
      {/* Top Half: EKS Clusters - Hidden in focused view */}
      {!focusedView && (
      <Box sx={{ flex: '0 0 auto', maxHeight: '35%', overflow: 'auto', mb: 2 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card>
            <CardContent sx={{ py: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CloudIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight="600">
                    AWS EKS Clusters ({eksClusters.length})
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="Keyboard shortcuts (?)">
                    <Button size="small" onClick={() => setHelpOpen(true)} startIcon={<KeyboardIcon />}>
                      Help
                    </Button>
                  </Tooltip>
                  <Button startIcon={<RefreshIcon />} onClick={fetchEksClusters} size="small">
                    Refresh
                  </Button>
                </Box>
              </Box>

              <Grid container spacing={1.5}>
                {eksClusters.map((cluster) => {
                  const costs = clusterCosts[cluster.name]
                  const upgrade = upgradeStatuses[cluster.name]

                  return (
                    <Grid item xs={12} md={4} key={cluster.name}>
                      <Card
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          border: selectedEksCluster === cluster.name ? 2 : 1,
                          borderColor: selectedEksCluster === cluster.name ? 'primary.main' : 'divider',
                          transition: 'all 0.2s',
                          '&:hover': { boxShadow: 2 },
                        }}
                        onClick={() => handleConnectToCluster(cluster.name)}
                      >
                        <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                            <Typography variant="body2" fontWeight="600" noWrap sx={{ maxWidth: '60%' }}>
                              {cluster.name}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <Chip label={`v${cluster.version}`} size="small" variant="outlined" sx={{ height: 20 }} />
                              {upgrade && !upgrade.isUpToDate && (
                                <Tooltip title={`Upgrade: ${upgrade.availableUpgrades.join(', ')}`}>
                                  <Chip icon={<UpgradeIcon />} size="small" color="warning" sx={{ height: 20 }} />
                                </Tooltip>
                              )}
                            </Box>
                          </Box>

                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Typography variant="caption" color="text.secondary">
                                <AttachMoneyIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} />
                                30d: {formatCost(costs?.last30Days)}
                              </Typography>
                            </Box>
                            {selectedEksCluster === cluster.name ? (
                              <Chip icon={<CheckCircleIcon />} label="Connected" color="success" size="small" sx={{ height: 20 }} />
                            ) : (
                              <Chip label="Connect" size="small" variant="outlined" sx={{ height: 20 }} />
                            )}
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )
                })}
              </Grid>
            </CardContent>
          </Card>
        </motion.div>
      </Box>
      )}

      {/* Middle: Cluster Control Panel */}
      {selectedEksCluster && (
        <Box sx={{ mb: 2 }}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: 'grey.50',
                borderRadius: 2,
              }}
            >
              {/* Cluster Info */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CloudIcon color="primary" />
                <Box>
                  <Typography variant="subtitle2" fontWeight="600">
                    {selectedEksCluster}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Connected
                  </Typography>
                </Box>
              </Box>

              <Divider orientation="vertical" flexItem />

              {/* Quick Stats */}
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Tooltip title="Namespaces">
                  <Chip
                    icon={<FolderIcon />}
                    label={`${namespaces.length} NS`}
                    size="small"
                    variant="outlined"
                  />
                </Tooltip>
                <Tooltip title="Total Resources Loaded">
                  <Chip
                    icon={<LayersIcon />}
                    label={`${resources.length} ${currentResourceType?.label || 'items'}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Tooltip>
              </Box>

              <Box sx={{ flex: 1 }} />

              {/* Cluster Actions */}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="View cluster events">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<EventIcon />}
                    onClick={openEventsModal}
                  >
                    Events
                  </Button>
                </Tooltip>
                <Tooltip title="View cluster nodes">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ComputerIcon />}
                    onClick={openNodesModal}
                  >
                    Nodes
                  </Button>
                </Tooltip>
                <Tooltip title="Toggle cluster details">
                  <Button
                    size="small"
                    variant={clusterDetailsExpanded ? "contained" : "outlined"}
                    startIcon={<CloudIcon />}
                    onClick={() => setClusterDetailsExpanded(!clusterDetailsExpanded)}
                  >
                    Details {clusterDetailsExpanded ? '▲' : '▼'}
                  </Button>
                </Tooltip>
                {!focusedView && (
                  <Tooltip title={`Open ${selectedEksCluster} in new browser tab`}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => window.open(`${window.location.origin}?cluster=${selectedEksCluster}`, '_blank')}
                    >
                      ↗ New Tab
                    </Button>
                  </Tooltip>
                )}
              </Box>

              {/* Upgrade Status */}
              {upgradeStatuses[selectedEksCluster] && !upgradeStatuses[selectedEksCluster].isUpToDate && (
                <>
                  <Divider orientation="vertical" flexItem />
                  <Tooltip title={`Available upgrades: ${upgradeStatuses[selectedEksCluster].availableUpgrades.join(', ')}`}>
                    <Chip
                      icon={<UpgradeIcon />}
                      label={`Upgrade to ${upgradeStatuses[selectedEksCluster].latestVersion}`}
                      size="small"
                      color="warning"
                      onClick={() => {
                        const cluster = eksClusters.find(c => c.name === selectedEksCluster)
                        if (cluster) {
                          window.open(`https://console.aws.amazon.com/eks/home?region=us-west-2#/clusters/${cluster.name}/update-cluster-version`, '_blank')
                        }
                      }}
                    />
                  </Tooltip>
                </>
              )}
            </Paper>

            {/* Collapsible Details Panel */}
            <AnimatePresence>
              {clusterDetailsExpanded && (() => {
                const cluster = eksClusters.find(c => c.name === selectedEksCluster)
                const costs = clusterCosts[selectedEksCluster]
                const upgrade = upgradeStatuses[selectedEksCluster]
                if (!cluster) return null

                return (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Paper
                      variant="outlined"
                      sx={{
                        mt: 1,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Grid container spacing={2}>
                        {/* Basic Info */}
                        <Grid item xs={12} md={4}>
                          <Typography variant="caption" color="text.secondary" fontWeight="600">
                            CLUSTER INFO
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="body2" color="text.secondary">Version</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="body2" fontWeight="500">{cluster.version}</Typography>
                                {upgrade && !upgrade.isUpToDate && (
                                  <Chip icon={<UpgradeIcon />} label={upgrade.latestVersion} size="small" color="warning" sx={{ height: 18 }} />
                                )}
                              </Box>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="body2" color="text.secondary">Platform</Typography>
                              <Typography variant="body2">{cluster.platformVersion}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="body2" color="text.secondary">Created</Typography>
                              <Typography variant="body2">{formatAge(cluster.createdAt)} ago</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                              <Typography variant="body2" color="text.secondary">Status</Typography>
                              <Chip label={cluster.status} size="small" color="success" sx={{ height: 18 }} />
                            </Box>
                          </Box>
                        </Grid>

                        {/* Costs */}
                        <Grid item xs={12} md={4}>
                          <Typography variant="caption" color="text.secondary" fontWeight="600">
                            COST SUMMARY
                          </Typography>
                          <Box sx={{ mt: 0.5, display: 'flex', gap: 2 }}>
                            <Box sx={{ textAlign: 'center', flex: 1, bgcolor: 'grey.50', borderRadius: 1, p: 1 }}>
                              <Typography variant="caption" color="text.secondary">30 Days</Typography>
                              <Typography variant="h6" color="primary" fontWeight="600">
                                {formatCost(costs?.last30Days)}
                              </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'center', flex: 1, bgcolor: 'grey.50', borderRadius: 1, p: 1 }}>
                              <Typography variant="caption" color="text.secondary">7 Days</Typography>
                              <Typography variant="h6" color="primary" fontWeight="600">
                                {formatCost(costs?.last7Days)}
                              </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'center', flex: 1, bgcolor: 'grey.50', borderRadius: 1, p: 1 }}>
                              <Typography variant="caption" color="text.secondary">24 Hours</Typography>
                              <Typography variant="h6" color="primary" fontWeight="600">
                                {formatCost(costs?.lastDay)}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>

                        {/* Power Controls */}
                        <Grid item xs={12} md={4}>
                          <Typography variant="caption" color="text.secondary" fontWeight="600">
                            CLUSTER CONTROLS
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            {/* Scaling Status */}
                            {scalingStatus[selectedEksCluster] && (
                              <Box sx={{ mb: 1.5, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <Typography variant="body2" color="text.secondary">Nodes:</Typography>
                                  <Chip
                                    icon={scalingStatus[selectedEksCluster].totalDesiredNodes > 0 ? <PlayArrowIcon /> : <StopIcon />}
                                    label={`${scalingStatus[selectedEksCluster].totalDesiredNodes} desired`}
                                    size="small"
                                    color={scalingStatus[selectedEksCluster].totalDesiredNodes > 0 ? 'success' : 'default'}
                                    sx={{ height: 22 }}
                                  />
                                </Box>
                              </Box>
                            )}

                            {/* Power Buttons */}
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                startIcon={scalingAction ? <CircularProgress size={14} /> : <StopIcon />}
                                onClick={() => openStopConfirmation(selectedEksCluster)}
                                disabled={scalingAction || scalingStatus[selectedEksCluster]?.totalDesiredNodes === 0}
                                sx={{ flex: 1 }}
                              >
                                Stop
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="success"
                                startIcon={scalingAction ? <CircularProgress size={14} /> : <PlayArrowIcon />}
                                onClick={() => handleScaleUp(selectedEksCluster)}
                                disabled={scalingAction}
                                sx={{ flex: 1 }}
                              >
                                Start
                              </Button>
                            </Box>

                            {/* Access Info */}
                            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                              <Chip
                                label="Public"
                                size="small"
                                color={cluster.publicAccess ? 'success' : 'default'}
                                variant={cluster.publicAccess ? 'filled' : 'outlined'}
                                sx={{ height: 20 }}
                              />
                              <Chip
                                label="Private"
                                size="small"
                                color={cluster.privateAccess ? 'success' : 'default'}
                                variant={cluster.privateAccess ? 'filled' : 'outlined'}
                                sx={{ height: 20 }}
                              />
                            </Box>

                            {/* AWS Console Link */}
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<LanguageIcon />}
                              onClick={() => window.open(`https://console.aws.amazon.com/eks/home?region=us-west-2#/clusters/${selectedEksCluster}`, '_blank')}
                              fullWidth
                              sx={{ mt: 1 }}
                            >
                              Open AWS Console
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </Paper>
                  </motion.div>
                )
              })()}
            </AnimatePresence>
          </motion.div>
        </Box>
      )}

      {/* Bottom Half: Resources Browser */}
      {selectedEksCluster ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', py: 1, px: 1.5 }}>
                {/* Resource Type Bar */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                  {RESOURCE_TYPES.slice(0, 6).map((rt) => (
                    <Chip
                      key={rt.key}
                      icon={rt.icon as React.ReactElement}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {rt.label}
                          <Typography variant="caption" sx={{ opacity: 0.7, bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>
                            {rt.shortcut}
                          </Typography>
                        </Box>
                      }
                      onClick={() => setSelectedResourceType(rt.key)}
                      color={selectedResourceType === rt.key ? 'primary' : 'default'}
                      variant={selectedResourceType === rt.key ? 'filled' : 'outlined'}
                      size="small"
                    />
                  ))}
                  <Chip
                    label="More (:)"
                    onClick={() => setCommandPaletteOpen(true)}
                    variant="outlined"
                    size="small"
                  />
                </Box>

                {/* Filter and Controls */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Namespace</InputLabel>
                    <Select
                      value={selectedNamespace}
                      label="Namespace"
                      onChange={(e) => setSelectedNamespace(e.target.value)}
                    >
                      <MenuItem value="__all__">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <AllInclusiveIcon fontSize="small" />
                          All Namespaces
                        </Box>
                      </MenuItem>
                      {namespaces.map((ns) => (
                        <MenuItem key={ns.name} value={ns.name}>
                          {ns.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    id="filter-input"
                    size="small"
                    placeholder="Filter (press /)"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    sx={{ minWidth: 200 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <FilterListIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <Box sx={{ flex: 1 }} />

                  <Chip
                    label={`${filteredResources.length} ${currentResourceType?.label || 'items'}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />

                  <Tooltip title="Refresh (r)">
                    <Button
                      size="small"
                      onClick={() => fetchResources(selectedEksCluster, selectedResourceType)}
                      startIcon={resourceLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                      disabled={resourceLoading}
                    >
                      Refresh
                    </Button>
                  </Tooltip>
                </Box>

                {/* Resource Table */}
                <Box sx={{ flex: 1, overflow: 'auto' }}>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '100%' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {currentResourceType?.columns.map((col) => (
                            <TableCell key={col.key} sx={{ fontWeight: 600, width: col.width }}>
                              {col.label}
                            </TableCell>
                          ))}
                          <TableCell sx={{ fontWeight: 600, width: 180 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredResources.map((row, i) => (
                          <TableRow key={`${row.namespace}-${row.name}-${i}`} hover>
                            {currentResourceType?.columns.map((col) => (
                              <TableCell key={col.key}>
                                {col.key === 'status' || col.key === 'type' ? (
                                  <Chip
                                    icon={getStatusIcon(row[col.key]) || undefined}
                                    label={row[col.key]}
                                    size="small"
                                    color={getStatusColor(row[col.key]) as any}
                                  />
                                ) : col.key === 'namespace' ? (
                                  <Chip label={row[col.key]} size="small" variant="outlined" />
                                ) : col.key === 'name' ? (
                                  <Typography variant="body2" fontWeight="500" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                    {row[col.key]}
                                  </Typography>
                                ) : (
                                  formatCellValue(row, col.key)
                                )}
                              </TableCell>
                            ))}
                            <TableCell>
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                {getResourceActions(row)}
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredResources.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={currentResourceType?.columns.length || 1} align="center">
                              <Typography color="text.secondary">
                                No {currentResourceType?.label.toLowerCase()} found
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
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Card sx={{ textAlign: 'center', p: 4 }}>
            <CloudIcon sx={{ fontSize: 60, color: 'grey.400', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Click on an EKS cluster to connect and view resources
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Press <kbd>?</kbd> for keyboard shortcuts
            </Typography>
          </Card>
        </Box>
      )}

      {/* Command Palette (k9s style) */}
      <Dialog
        open={commandPaletteOpen}
        onClose={() => {
          setCommandPaletteOpen(false)
          setCommandSearch('')
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { position: 'fixed', top: '15%', m: 0 }
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            autoFocus
            fullWidth
            placeholder={commandSearch.toLowerCase().startsWith('ns') ? "Select namespace..." : "Type resource name or 'ns' for namespaces..."}
            value={commandSearch}
            onChange={(e) => setCommandSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Handle namespace selection
                if (commandSearch.toLowerCase().startsWith('ns')) {
                  const nsSearch = commandSearch.slice(2).trim().toLowerCase()
                  const filtered = [{ name: '__all__', label: 'All Namespaces' }, ...namespaces.map(n => ({ name: n.name, label: n.name }))]
                    .filter(ns => !nsSearch || ns.label.toLowerCase().includes(nsSearch))
                  if (filtered.length > 0) {
                    setSelectedNamespace(filtered[0].name)
                    setCommandPaletteOpen(false)
                    setCommandSearch('')
                  }
                } else {
                  const filtered = RESOURCE_TYPES.filter(rt =>
                    rt.label.toLowerCase().includes(commandSearch.toLowerCase()) ||
                    rt.key.toLowerCase().includes(commandSearch.toLowerCase())
                  )
                  if (filtered.length > 0) {
                    setSelectedResourceType(filtered[0].key)
                    setCommandPaletteOpen(false)
                    setCommandSearch('')
                    if (selectedEksCluster) {
                      fetchResources(selectedEksCluster, filtered[0].key)
                    }
                  }
                }
              }
              if (e.key === 'Escape') {
                setCommandPaletteOpen(false)
                setCommandSearch('')
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Typography variant="h6" color="primary" sx={{ fontFamily: 'monospace' }}>:</Typography>
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '1.1rem',
              }
            }}
          />
        </Box>
        <List sx={{ maxHeight: 400, overflow: 'auto', py: 0 }}>
          {/* Show namespaces if command starts with 'ns' */}
          {commandSearch.toLowerCase().startsWith('ns') ? (
            <>
              {[{ name: '__all__', label: 'All Namespaces' }, ...namespaces.map(n => ({ name: n.name, label: n.name }))]
                .filter(ns => {
                  const nsSearch = commandSearch.slice(2).trim().toLowerCase()
                  return !nsSearch || ns.label.toLowerCase().includes(nsSearch)
                })
                .map((ns, index) => (
                  <ListItem key={ns.name} disablePadding>
                    <ListItemButton
                      onClick={() => {
                        setSelectedNamespace(ns.name)
                        setCommandPaletteOpen(false)
                        setCommandSearch('')
                      }}
                      selected={selectedNamespace === ns.name || index === 0}
                      sx={{ py: 1.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <FolderIcon color={ns.name === '__all__' ? 'primary' : 'inherit'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={ns.label}
                        secondary={ns.name === '__all__' ? 'Show resources from all namespaces' : undefined}
                        primaryTypographyProps={{ fontWeight: selectedNamespace === ns.name ? 600 : 400 }}
                      />
                      {selectedNamespace === ns.name && (
                        <Chip label="current" size="small" color="primary" variant="outlined" />
                      )}
                    </ListItemButton>
                  </ListItem>
                ))
              }
            </>
          ) : (
            /* Show resource types */
            RESOURCE_TYPES
              .filter(rt =>
                !commandSearch ||
                rt.label.toLowerCase().includes(commandSearch.toLowerCase()) ||
                rt.key.toLowerCase().includes(commandSearch.toLowerCase())
              )
              .map((rt, index) => (
                <ListItem key={rt.key} disablePadding>
                  <ListItemButton
                    onClick={() => {
                      setSelectedResourceType(rt.key)
                      setCommandPaletteOpen(false)
                      setCommandSearch('')
                      if (selectedEksCluster) {
                        fetchResources(selectedEksCluster, rt.key)
                      }
                    }}
                    selected={selectedResourceType === rt.key || (!!commandSearch && index === 0)}
                    sx={{ py: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>{rt.icon}</ListItemIcon>
                    <ListItemText
                      primary={rt.label}
                    secondary={rt.key}
                    primaryTypographyProps={{ fontWeight: 500 }}
                    secondaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                  />
                  <Chip label={rt.shortcut} size="small" variant="outlined" sx={{ mr: 1 }} />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </Dialog>

      {/* Events Modal */}
      <Dialog open={eventsModalOpen} onClose={() => setEventsModalOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EventIcon color="primary" />
          Cluster Events
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {selectedEksCluster}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {modalLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: 100 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>Reason</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Object</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Message</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 60 }}>Count</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 100 }}>Namespace</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {modalEvents.slice(0, 50).map((event, i) => (
                    <TableRow key={i} hover>
                      <TableCell>
                        <Chip
                          label={event.type}
                          size="small"
                          color={event.type === 'Warning' ? 'error' : event.type === 'Normal' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="500">{event.reason}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {event.object}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                          {event.message?.substring(0, 100)}{event.message?.length > 100 ? '...' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>{event.count}</TableCell>
                      <TableCell>
                        <Chip label={event.namespace} size="small" variant="outlined" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Nodes Modal */}
      <Dialog open={nodesModalOpen} onClose={() => setNodesModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ComputerIcon color="primary" />
          Cluster Nodes
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {selectedEksCluster}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {modalLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Grid container spacing={2}>
              {modalNodes.map((node, i) => (
                <Grid item xs={12} key={i}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <ComputerIcon color="action" />
                          <Typography variant="subtitle2" fontWeight="600" sx={{ fontFamily: 'monospace' }}>
                            {node.name}
                          </Typography>
                        </Box>
                        <Chip
                          icon={node.status === 'Ready' ? <CheckCircleIcon /> : <ErrorIcon />}
                          label={node.status}
                          size="small"
                          color={node.status === 'Ready' ? 'success' : 'error'}
                        />
                      </Box>
                      <Grid container spacing={2}>
                        <Grid item xs={6} md={3}>
                          <Typography variant="caption" color="text.secondary">Version</Typography>
                          <Typography variant="body2">{node.version}</Typography>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Typography variant="caption" color="text.secondary">CPU / Memory</Typography>
                          <Typography variant="body2">{node.cpu} cores / {node.memory}</Typography>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Typography variant="caption" color="text.secondary">Internal IP</Typography>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{node.internalIP}</Typography>
                        </Grid>
                        <Grid item xs={6} md={3}>
                          <Typography variant="caption" color="text.secondary">External IP</Typography>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{node.externalIP || '-'}</Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">OS / Container Runtime</Typography>
                          <Typography variant="body2">{node.os} | {node.container}</Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </DialogContent>
      </Dialog>

      {/* Help Dialog */}
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogContent>
          <List dense>
            <ListItem>
              <ListItemText primary="Open resource selector" secondary="Press : to open command palette" />
              <Chip label=":" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText primary="Show help" secondary="Display this help dialog" />
              <Chip label="?" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText primary="Focus filter" secondary="Jump to filter input" />
              <Chip label="/" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText primary="Refresh" secondary="Reload current resources" />
              <Chip label="r" size="small" variant="outlined" />
            </ListItem>
            <ListItem>
              <ListItemText primary="Clear/Close" secondary="Clear filter or close dialogs" />
              <Chip label="Esc" size="small" variant="outlined" />
            </ListItem>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ px: 2, py: 1 }}>
              Resource Shortcuts
            </Typography>
            {RESOURCE_TYPES.map((rt) => (
              <ListItem key={rt.key}>
                <ListItemIcon sx={{ minWidth: 36 }}>{rt.icon}</ListItemIcon>
                <ListItemText primary={rt.label} />
                <Chip label={rt.shortcut} size="small" variant="outlined" />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>

      {/* Stop Confirmation Dialog */}
      <Dialog open={stopConfirmOpen} onClose={() => setStopConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <WarningIcon color="error" />
          Stop Cluster Workers
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="600" gutterBottom>
              This action will scale all node groups to 0 nodes!
            </Typography>
            <Typography variant="body2">
              • All running pods will be terminated<br />
              • All workloads will stop<br />
              • The control plane will remain running (still incurs costs)<br />
              • You can start the cluster again later
            </Typography>
          </Alert>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              To confirm, type the cluster name:
            </Typography>
            <Chip
              label={clusterToStop}
              size="small"
              deleteIcon={<ContentCopyIcon sx={{ fontSize: '14px !important' }} />}
              onDelete={() => {
                navigator.clipboard.writeText(clusterToStop || '')
              }}
              onClick={() => {
                navigator.clipboard.writeText(clusterToStop || '')
              }}
              sx={{
                fontFamily: 'monospace',
                fontWeight: 600,
                cursor: 'pointer',
                '& .MuiChip-deleteIcon': {
                  color: 'inherit',
                  '&:hover': { color: 'primary.main' }
                }
              }}
            />
          </Box>

          <TextField
            fullWidth
            placeholder="Type cluster name to confirm"
            value={stopConfirmInput}
            onChange={(e) => setStopConfirmInput(e.target.value)}
            error={stopConfirmInput.length > 0 && stopConfirmInput !== clusterToStop}
            helperText={
              stopConfirmInput.length > 0 && stopConfirmInput !== clusterToStop
                ? "Cluster name doesn't match"
                : ' '
            }
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'monospace',
              }
            }}
          />

          <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
            <Button onClick={() => setStopConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              startIcon={<StopIcon />}
              disabled={stopConfirmInput !== clusterToStop}
              onClick={handleScaleDown}
            >
              Stop Cluster
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Logs Modal */}
      <Dialog open={logsModalOpen} onClose={() => setLogsModalOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ArticleIcon color="primary" />
            {logsPrevious ? 'Previous Logs' : 'Logs'}: {selectedResource?.name}
          </Box>
          <IconButton onClick={() => setLogsModalOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {logsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: '60vh',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {logsContent || 'No logs available'}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Describe Modal */}
      <Dialog open={describeModalOpen} onClose={() => setDescribeModalOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoIcon color="primary" />
            Describe: {selectedResource?.name}
          </Box>
          <IconButton onClick={() => setDescribeModalOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {describeLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: '60vh',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {describeContent || 'No description available'}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* YAML Modal */}
      <Dialog open={yamlModalOpen} onClose={() => setYamlModalOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CodeIcon color="primary" />
            YAML: {selectedResource?.name}
          </Box>
          <Box>
            <Tooltip title="Copy YAML">
              <IconButton onClick={() => navigator.clipboard.writeText(yamlContent)} size="small">
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
            <IconButton onClick={() => setYamlModalOpen(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {yamlLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: '60vh',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {yamlContent || 'No YAML available'}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <WarningIcon color="error" />
          Delete {selectedResourceType?.slice(0, -1)}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete <strong>{selectedResource?.name}</strong> in namespace <strong>{selectedResource?.namespace}</strong>?
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
            <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteResource}
              disabled={deleteLoading}
            >
              {deleteLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Scale Dialog */}
      <Dialog open={scaleDialogOpen} onClose={() => setScaleDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Scale Deployment</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Scale <strong>{selectedResource?.name}</strong> to desired replicas
          </Typography>
          <TextField
            fullWidth
            type="number"
            label="Replicas"
            value={scaleReplicas}
            onChange={(e) => setScaleReplicas(Math.max(0, parseInt(e.target.value) || 0))}
            inputProps={{ min: 0 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
            <Button onClick={() => setScaleDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleScaleDeployment}
              disabled={actionLoading}
            >
              {actionLoading ? 'Scaling...' : 'Scale'}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Modern Keyboard Hints Bar */}
      <AnimatePresence>
        {selectedEksCluster && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <Paper
              elevation={3}
              sx={{
                position: 'fixed',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                px: 2,
                py: 1,
                borderRadius: 3,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                zIndex: 1000,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>p</Kbd>
                <Typography variant="caption" color="text.secondary">Pods</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>d</Kbd>
                <Typography variant="caption" color="text.secondary">Deploy</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>s</Kbd>
                <Typography variant="caption" color="text.secondary">Services</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>n</Kbd>
                <Typography variant="caption" color="text.secondary">Nodes</Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>/</Kbd>
                <Typography variant="caption" color="text.secondary">Filter</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>r</Kbd>
                <Typography variant="caption" color="text.secondary">Refresh</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>:</Kbd>
                <Typography variant="caption" color="text.secondary">More</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>?</Kbd>
                <Typography variant="caption" color="text.secondary">Help</Typography>
              </Box>
            </Paper>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

// Keyboard key component
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 22,
        px: 0.75,
        fontSize: '0.75rem',
        fontWeight: 600,
        fontFamily: 'monospace',
        color: 'text.primary',
        bgcolor: 'grey.100',
        border: '1px solid',
        borderColor: 'grey.300',
        borderRadius: 1,
        boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
      }}
    >
      {children}
    </Box>
  )
}

export default ClusterTab
