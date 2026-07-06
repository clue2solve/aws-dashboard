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

// ClusterStore = a kpack ClusterStore CR (buildpack package sources). Direct
// coordinator CRUD, mirrors console's ClusterStores.js contract.

export interface ClusterStoreMetadata {
  name: string
  displayName?: string
  generation?: number
  resourceVersion?: string
  creationTimestamp?: string
  labels?: Record<string, string>
}

export interface ClusterStoreSpec {
  sources?: { image?: string }[]
}

export interface ClusterStoreCondition {
  status?: string
  type?: string
  message?: string
}

export interface ClusterStore {
  metadata?: ClusterStoreMetadata
  spec?: ClusterStoreSpec
  status?: { conditions?: ClusterStoreCondition[] }
}

interface StoreForm {
  name?: string
  displayName?: string
  resourceVersion?: string
  images?: string
}

function statusColor(status?: string): 'success' | 'error' | 'default' {
  if (status === 'True') return 'success'
  if (status === 'False') return 'error'
  return 'default'
}

// Mirrors console's string2Array helper: splits a newline/comma separated
// textarea value into a clean string array.
function string2Array(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function ClusterStoresPanel() {
  const [rows, setRows] = useState<ClusterStore[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit' | 'json'>('create')
  const [form, setForm] = useState<StoreForm>({})
  const [jsonTarget, setJsonTarget] = useState<ClusterStore | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ClusterStore | null>(null)

  const fetchData = useCallback(() => {
    setErr(null)
    return coordinatorGet<ClusterStore[]>('/api/k8s-cluster-store/')
      .then((data) => setRows(data))
      .catch((e: ApiError) => setErr(`Failed to load cluster stores: ${e.message}`))
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const openCreate = () => {
    setForm({})
    setMode('create')
    setDialogOpen(true)
  }

  const openEdit = (row: ClusterStore) => {
    setForm({
      name: row.metadata?.name,
      displayName: row.metadata?.displayName,
      resourceVersion: row.metadata?.resourceVersion,
      images: (row.spec?.sources ?? []).map((s) => s.image).join(',\n'),
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
      const clusterStoreImages = string2Array(form.images)
      if (mode === 'create') {
        await coordinatorPost('/api/k8s-cluster-store/', {
          displayName: form.displayName,
          images: clusterStoreImages,
        })
      } else {
        await coordinatorPut(`/api/k8s-cluster-store/${form.name}`, {
          resourceVersion: form.resourceVersion,
          images: clusterStoreImages,
        })
      }
      closeDialog()
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save cluster store')
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget?.metadata?.name) return
    setSubmitting(true)
    try {
      await coordinatorDelete(`/api/k8s-cluster-store/${deleteTarget.metadata.name}`)
      setDeleteTarget(null)
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to delete cluster store')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Cluster Stores
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add store
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
            Loading cluster stores…
          </Typography>
        </Box>
      )}

      {rows && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
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
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      No cluster stores.
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
        <DialogTitle>{mode === 'create' ? 'Create cluster store' : 'Update cluster store'}</DialogTitle>
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
              label="Buildpack package images"
              value={form.images || ''}
              onChange={(e) => setForm((p) => ({ ...p, images: e.target.value }))}
              helperText="Separate each image with a comma or newline"
              multiline
              rows={3}
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
        <DialogTitle>Cluster store JSON</DialogTitle>
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
        <DialogTitle>Delete cluster store</DialogTitle>
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
