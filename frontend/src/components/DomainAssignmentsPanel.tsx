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
  Checkbox,
  FormControlLabel,
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
import { coordinatorPost, coordinatorDelete, ApiError } from '../api'
import type { Domain, DomainAssignment } from './DomainsTab'

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

interface DomainAssignmentsPanelProps {
  assignments: DomainAssignment[]
  domains: Domain[]
  platformDomains: Domain[]
  projectId: string | null
  onRefresh: () => void
  setErr: (e: string | null) => void
}

export default function DomainAssignmentsPanel({
  assignments,
  domains,
  platformDomains,
  projectId,
  onRefresh,
  setErr,
}: DomainAssignmentsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'assign' | 'json' | 'unassign'>('assign')
  const [target, setTarget] = useState<DomainAssignment | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [selectedDomain, setSelectedDomain] = useState('')
  const [apex, setApex] = useState(false)
  const [subdomain, setSubdomain] = useState('')
  const [appName, setAppName] = useState('')

  const allDomains = [...platformDomains, ...domains.filter((d) => !d.isPlatformDomain)]
  const selectedDomainObj = selectedDomain ? allDomains.find((d) => d.domain === selectedDomain) : null
  const canApex =
    Boolean(selectedDomainObj) &&
    !selectedDomainObj?.isPlatformDomain &&
    (selectedDomainObj?.dnsMethod === 'DELEGATION' || selectedDomainObj?.dnsMethod === 'SUBDOMAIN_DELEGATION')

  const openAssign = () => {
    setSelectedDomain('')
    setApex(false)
    setSubdomain('')
    setAppName('')
    setMode('assign')
    setDialogOpen(true)
  }

  const openJson = (row: DomainAssignment) => {
    setTarget(row)
    setMode('json')
    setDialogOpen(true)
  }

  const openUnassign = (row: DomainAssignment) => {
    setTarget(row)
    setMode('unassign')
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setTarget(null)
  }

  const onAssign = async () => {
    setSubmitting(true)
    try {
      await coordinatorPost('/api/domains/assignments', {
        // Apex assignments send an empty subdomain — the API treats that as the apex.
        subdomain: apex ? '' : subdomain,
        domain: selectedDomain,
        appName,
        projectId,
      })
      closeDialog()
      onRefresh()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to assign domain')
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmUnassign = async () => {
    if (!target?.id) return
    setSubmitting(true)
    try {
      await coordinatorDelete(`/api/domains/assignments/${target.id}`)
      closeDialog()
      onRefresh()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to unassign domain')
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
        onClick={openAssign}
        disabled={!projectId}
      >
        Assign domain
      </Button>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>FQDN</TableCell>
              <TableCell>Subdomain</TableCell>
              <TableCell>Domain</TableCell>
              <TableCell>App</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {assignments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No domain assignments.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {assignments.map((a) => (
              <TableRow key={a.id} hover>
                <TableCell>{a.fqdn}</TableCell>
                <TableCell>{a.subdomain}</TableCell>
                <TableCell>{a.domainName}</TableCell>
                <TableCell>{a.appName}</TableCell>
                <TableCell>
                  <Chip size="small" label={a.status || 'UNKNOWN'} color={statusColor(a.status)} variant="outlined" />
                </TableCell>
                <TableCell>{a.createdOn ? new Date(a.createdOn).toLocaleString() : '-'}</TableCell>
                <TableCell align="right">
                  <Tooltip title="View JSON">
                    <IconButton size="small" onClick={() => openJson(a)}>
                      <CodeIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Unassign">
                    <IconButton size="small" onClick={() => openUnassign(a)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Assign dialog */}
      <Dialog open={dialogOpen && mode === 'assign'} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Assign domain</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridRowGap: '1rem', mt: 1 }}>
            <TextField
              select
              label="Domain"
              value={selectedDomain}
              onChange={(e) => {
                const next = allDomains.find((d) => d.domain === e.target.value)
                const nextCanApex =
                  Boolean(next) &&
                  !next?.isPlatformDomain &&
                  (next?.dnsMethod === 'DELEGATION' || next?.dnsMethod === 'SUBDOMAIN_DELEGATION')
                setSelectedDomain(e.target.value)
                if (!nextCanApex) setApex(false)
              }}
              size="small"
            >
              {allDomains.map((d) => (
                <MenuItem key={d.id || d.domain} value={d.domain}>
                  {d.domain}{' '}
                  {d.isPlatformDomain
                    ? '(Platform)'
                    : d.dnsMethod === 'DELEGATION'
                    ? '(Delegated)'
                    : d.dnsMethod === 'SUBDOMAIN_DELEGATION'
                    ? '(Subdomain delegated)'
                    : '(CNAME)'}
                </MenuItem>
              ))}
            </TextField>
            {canApex && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={apex}
                    onChange={(e) => {
                      setApex(e.target.checked)
                      if (e.target.checked) setSubdomain('')
                    }}
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: '0.85rem' }}>
                    Map domain at the apex (no subdomain) — full URL will be{' '}
                    <code>https://{selectedDomain}</code>
                  </Typography>
                }
              />
            )}
            {!apex && (
              <TextField
                label="Subdomain"
                placeholder="api"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                size="small"
                helperText={subdomain && selectedDomain ? `Full URL: ${subdomain}.${selectedDomain}` : ''}
              />
            )}
            <TextField
              label="App name"
              placeholder="my-app"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={onAssign} disabled={submitting || !selectedDomain || !appName.trim()}>
            {submitting ? <CircularProgress size={16} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JSON dialog */}
      <Dialog open={dialogOpen && mode === 'json'} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>Assignment JSON</DialogTitle>
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

      {/* Unassign confirm */}
      <Dialog open={dialogOpen && mode === 'unassign'} onClose={closeDialog}>
        <DialogTitle>Unassign domain</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Unassign <strong>{target?.fqdn}</strong> → {target?.appName}? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button color="error" variant="contained" onClick={onConfirmUnassign} disabled={submitting}>
            {submitting ? <CircularProgress size={16} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
