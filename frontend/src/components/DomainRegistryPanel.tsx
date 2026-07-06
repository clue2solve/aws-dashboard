import { useState } from 'react'
import {
  Box,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Button,
  IconButton,
  TextField,
  MenuItem,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import CodeIcon from '@mui/icons-material/Code'
import InfoIcon from '@mui/icons-material/Info'
import { coordinatorPost, coordinatorDelete, coordinatorGet, ApiError } from '../api'
import type { Domain } from './DomainsTab'

const DNS_METHODS = [
  { id: 'DELEGATION', name: 'Full Delegation' },
  { id: 'SUBDOMAIN_DELEGATION', name: 'Subdomain Delegation' },
  { id: 'CNAME_ONLY', name: 'CNAME Only' },
]

function statusColor(status?: string): 'success' | 'warning' | 'error' | 'default' {
  const map: Record<string, 'success' | 'warning' | 'error'> = {
    ACTIVE: 'success',
    VERIFIED: 'success',
    PENDING: 'warning',
    PENDING_VERIFICATION: 'warning',
    FAILED: 'error',
  }
  return map[status || ''] || 'default'
}

interface DomainStatusResult {
  domain?: string
  status?: string
  nameservers?: string[]
  [key: string]: unknown
}

interface DomainRegistryPanelProps {
  domains: Domain[]
  projectId: string | null
  onRefresh: () => void
  setErr: (e: string | null) => void
}

export default function DomainRegistryPanel({ domains, projectId, onRefresh, setErr }: DomainRegistryPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'json' | 'status' | 'delete'>('create')
  const [target, setTarget] = useState<Domain | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [dnsMethod, setDnsMethod] = useState('DELEGATION')
  const [submitting, setSubmitting] = useState(false)
  const [statusResult, setStatusResult] = useState<DomainStatusResult | null>(null)

  const openCreate = () => {
    setDomainInput('')
    setDnsMethod('DELEGATION')
    setMode('create')
    setDialogOpen(true)
  }

  const openJson = (row: Domain) => {
    setTarget(row)
    setMode('json')
    setDialogOpen(true)
  }

  const openStatus = async (row: Domain) => {
    setTarget(row)
    setStatusResult(null)
    setMode('status')
    setDialogOpen(true)
    try {
      const data = await coordinatorGet<DomainStatusResult>(`/api/domains/${row.domain}/status`)
      setStatusResult(data)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to check domain status')
    }
  }

  const openDelete = (row: Domain) => {
    setTarget(row)
    setMode('delete')
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setTarget(null)
    setStatusResult(null)
  }

  const onRegister = async () => {
    setSubmitting(true)
    try {
      await coordinatorPost('/api/domains/', {
        domain: domainInput,
        projectId,
        dnsMethod,
      })
      closeDialog()
      onRefresh()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to register domain')
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmDelete = async () => {
    if (!target?.id) return
    setSubmitting(true)
    try {
      await coordinatorDelete(`/api/domains/${target.id}`)
      closeDialog()
      onRefresh()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to delete domain')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box>
      <Button
        sx={{ mb: 2 }}
        variant="contained"
        startIcon={<AddIcon />}
        onClick={openCreate}
        disabled={!projectId}
      >
        Register domain
      </Button>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Domain</TableCell>
              <TableCell>DNS Method</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {domains.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No domains registered.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {domains.map((d) => (
              <TableRow key={d.id || d.domain} hover>
                <TableCell>{d.domain}</TableCell>
                <TableCell>{d.dnsMethod || '-'}</TableCell>
                <TableCell>{d.isPlatformDomain ? 'Platform' : 'Custom'}</TableCell>
                <TableCell>
                  <Chip size="small" label={d.status || 'UNKNOWN'} color={statusColor(d.status)} variant="outlined" />
                </TableCell>
                <TableCell>{d.createdOn ? new Date(d.createdOn).toLocaleString() : '-'}</TableCell>
                <TableCell align="right">
                  <Tooltip title="View JSON">
                    <IconButton size="small" onClick={() => openJson(d)}>
                      <CodeIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {!d.isPlatformDomain && (
                    <>
                      <Tooltip title="Check status">
                        <IconButton size="small" onClick={() => openStatus(d)}>
                          <InfoIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => openDelete(d)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Register dialog */}
      <Dialog open={dialogOpen && mode === 'create'} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Register domain</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridRowGap: '1rem', mt: 1 }}>
            <TextField
              label="Domain"
              placeholder="example.com"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              size="small"
            />
            <TextField
              select
              label="DNS method"
              value={dnsMethod}
              onChange={(e) => setDnsMethod(e.target.value)}
              size="small"
            >
              {DNS_METHODS.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={onRegister} disabled={submitting || !domainInput.trim()}>
            {submitting ? <CircularProgress size={16} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JSON dialog */}
      <Dialog open={dialogOpen && mode === 'json'} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>Domain JSON</DialogTitle>
        <DialogContent>
          <Paper
            variant="outlined"
            sx={{ p: 1.5, maxHeight: 500, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}
          >
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(target, null, 2)}
            </pre>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Status dialog */}
      <Dialog open={dialogOpen && mode === 'status'} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Domain status</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridRowGap: '1rem' }}>
            <Typography variant="subtitle2">
              Domain: <strong>{target?.domain}</strong>
            </Typography>
            {statusResult ? (
              <Paper
                variant="outlined"
                sx={{ p: 1.5, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(statusResult, null, 2)}
                </pre>
              </Paper>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Checking…
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={dialogOpen && mode === 'delete'} onClose={closeDialog}>
        <DialogTitle>Delete domain</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete <strong>{target?.domain}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete} disabled={submitting}>
            {submitting ? <CircularProgress size={16} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
