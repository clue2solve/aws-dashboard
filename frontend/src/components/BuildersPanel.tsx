import { useEffect, useState, useCallback } from 'react'
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Chip,
  Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CodeIcon from '@mui/icons-material/Code'
import { motion } from 'framer-motion'
import { coordinatorGet, coordinatorPost, coordinatorPut, coordinatorDelete, ApiError } from '../api'

// Builder = a kpack Builder CR. Its create/edit form needs Service Account /
// ClusterStack / ClusterStore dropdowns, so this panel fetches those three
// alongside its own list — same as console's Builders.js did.

interface BuilderMetadata {
  name: string
  displayName?: string
  generation?: number
  resourceVersion?: string
  creationTimestamp?: string
  labels?: Record<string, string>
}

interface BuilderOrderGroup {
  id?: string
}

interface BuilderOrder {
  group?: BuilderOrderGroup[]
}

interface BuilderSpec {
  tag?: string
  serviceAccountName?: string
  store?: { name?: string }
  stack?: { name?: string }
  order?: BuilderOrder[]
}

interface BuilderCondition {
  status?: string
}

interface Builder {
  metadata?: BuilderMetadata
  spec?: BuilderSpec
  status?: { latestImage?: string; conditions?: BuilderCondition[] }
}

interface NamedOption {
  name: string
  displayName: string
}

interface BuilderForm {
  name?: string
  displayName?: string
  resourceVersion?: string
  tag?: string
  serviceAccountName?: string
  clusterStack?: string
  clusterStore?: string
  buildpack?: string
}

function statusColor(status?: string): 'success' | 'error' | 'default' {
  if (status === 'True') return 'success'
  if (status === 'False') return 'error'
  return 'default'
}

function string2Array(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Shape returned by the k8s-* CRD list endpoints for named cross-references
// (service accounts, cluster stacks, cluster stores) — we only need name +
// displayName for the dropdown options.
interface NamedResource {
  metadata?: { name?: string; displayName?: string }
}

function toOptions(items: NamedResource[]): NamedOption[] {
  return items
    .map((it) => ({ name: it.metadata?.name || '', displayName: it.metadata?.displayName || it.metadata?.name || '' }))
    .filter((o) => o.name)
}

export default function BuildersPanel() {
  const [rows, setRows] = useState<Builder[] | null>(null)
  const [serviceAccounts, setServiceAccounts] = useState<NamedOption[]>([])
  const [clusterStacks, setClusterStacks] = useState<NamedOption[]>([])
  const [clusterStores, setClusterStores] = useState<NamedOption[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit' | 'json'>('create')
  const [form, setForm] = useState<BuilderForm>({})
  const [jsonTarget, setJsonTarget] = useState<Builder | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Builder | null>(null)

  const fetchData = useCallback(() => {
    setErr(null)
    return coordinatorGet<Builder[]>('/api/k8s-builder/')
      .then((data) => setRows(data))
      .catch((e: ApiError) => setErr(`Failed to load builders: ${e.message}`))
  }, [])

  useEffect(() => {
    fetchData()
    coordinatorGet<NamedResource[]>('/api/k8s-service-account/')
      .then((data) => setServiceAccounts(toOptions(data)))
      .catch(() => setServiceAccounts([]))
    coordinatorGet<NamedResource[]>('/api/k8s-cluster-stack/')
      .then((data) => setClusterStacks(toOptions(data)))
      .catch(() => setClusterStacks([]))
    coordinatorGet<NamedResource[]>('/api/k8s-cluster-store/')
      .then((data) => setClusterStores(toOptions(data)))
      .catch(() => setClusterStores([]))
  }, [fetchData])

  const openCreate = () => {
    setForm({})
    setMode('create')
    setDialogOpen(true)
  }

  const openEdit = (row: Builder) => {
    setForm({
      name: row.metadata?.name,
      displayName: row.metadata?.displayName,
      resourceVersion: row.metadata?.resourceVersion,
      tag: row.spec?.tag,
      serviceAccountName: row.spec?.serviceAccountName,
      clusterStore: row.spec?.store?.name,
      clusterStack: row.spec?.stack?.name,
      buildpack: (row.spec?.order ?? [])
        .map((o) => (o.group ?? []).map((g) => g.id).join(',\n'))
        .join(',\n'),
    })
    setMode('edit')
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setForm({})
  }

  const onSave = async () => {
    setSubmitting(true)
    try {
      const buildpackIds = string2Array(form.buildpack)
      if (mode === 'create') {
        await coordinatorPost('/api/k8s-builder/', {
          displayName: form.displayName,
          tag: form.tag,
          serviceAccountName: form.serviceAccountName,
          clusterStack: { name: form.clusterStack },
          clusterStore: { name: form.clusterStore },
          buildpackIds,
        })
      } else {
        await coordinatorPut(`/api/k8s-builder/${form.name}`, {
          resourceVersion: form.resourceVersion,
          tag: form.tag,
          serviceAccountName: form.serviceAccountName,
          clusterStack: { name: form.clusterStack },
          clusterStore: { name: form.clusterStore },
          buildpackIds,
        })
      }
      closeDialog()
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save builder')
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget?.metadata?.name) return
    setSubmitting(true)
    try {
      await coordinatorDelete(`/api/k8s-builder/${deleteTarget.metadata.name}`)
      setDeleteTarget(null)
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to delete builder')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Builders
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add builder
        </Button>
      </Box>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      {!rows && !err && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading builders…
          </Typography>
        </Box>
      )}

      {rows && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Latest image</TableCell>
                <TableCell>Generation</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Resource Version</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      No builders.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => {
                const cond = row.status?.conditions?.[0]
                const isDefault = Boolean(row.metadata?.labels?.default)
                return (
                  <TableRow key={row.metadata?.name} hover>
                    <TableCell>{row.metadata?.displayName}</TableCell>
                    <TableCell
                      sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={row.status?.latestImage}
                    >
                      {row.status?.latestImage || '—'}
                    </TableCell>
                    <TableCell>{row.metadata?.generation}</TableCell>
                    <TableCell>
                      <Chip size="small" label={cond?.status || 'Unknown'} color={statusColor(cond?.status)} variant="outlined" />
                    </TableCell>
                    <TableCell>{row.metadata?.resourceVersion}</TableCell>
                    <TableCell>
                      {row.metadata?.creationTimestamp
                        ? new Date(row.metadata.creationTimestamp).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="View JSON">
                        <IconButton size="small" onClick={() => { setJsonTarget(row); setMode('json'); setDialogOpen(true) }}>
                          <CodeIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {!isDefault && (
                        <>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => openEdit(row)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => setDeleteTarget(row)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen && mode !== 'json'} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{mode === 'create' ? 'Create builder' : 'Update builder'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridRowGap: '1rem', mt: 1 }}>
            <TextField
              label="Name"
              value={form.displayName || ''}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
              InputProps={{ readOnly: Boolean(form.resourceVersion) }}
              size="small"
            />
            <TextField
              label="Tag"
              value={form.tag || ''}
              onChange={(e) => setForm((p) => ({ ...p, tag: e.target.value }))}
              size="small"
            />
            <TextField
              select
              label="Service account"
              value={form.serviceAccountName || ''}
              onChange={(e) => setForm((p) => ({ ...p, serviceAccountName: e.target.value }))}
              size="small"
            >
              {serviceAccounts.map((sa) => (
                <MenuItem key={sa.name} value={sa.name}>
                  {sa.displayName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Cluster stack"
              value={form.clusterStack || ''}
              onChange={(e) => setForm((p) => ({ ...p, clusterStack: e.target.value }))}
              size="small"
            >
              {clusterStacks.map((cs) => (
                <MenuItem key={cs.name} value={cs.name}>
                  {cs.displayName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Cluster store"
              value={form.clusterStore || ''}
              onChange={(e) => setForm((p) => ({ ...p, clusterStore: e.target.value }))}
              size="small"
            >
              {clusterStores.map((cs) => (
                <MenuItem key={cs.name} value={cs.name}>
                  {cs.displayName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Buildpacks"
              value={form.buildpack || ''}
              onChange={(e) => setForm((p) => ({ ...p, buildpack: e.target.value }))}
              helperText="Separate each buildpack id with a comma or newline"
              multiline
              rows={2}
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={onSave} disabled={submitting}>
            {submitting ? <CircularProgress size={16} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JSON viewer dialog */}
      <Dialog open={dialogOpen && mode === 'json'} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>Builder JSON</DialogTitle>
        <DialogContent>
          <Paper
            variant="outlined"
            sx={{ p: 1.5, maxHeight: 500, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}
          >
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(jsonTarget, null, 2)}
            </pre>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete builder</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete <strong>{deleteTarget?.metadata?.displayName}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete} disabled={submitting}>
            {submitting ? <CircularProgress size={16} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </motion.div>
  )
}
