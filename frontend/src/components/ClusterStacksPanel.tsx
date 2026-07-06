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

// ClusterStack = a kpack ClusterStack CR (build/run base images). Direct
// coordinator CRUD, same contract the console's ClusterStacks.js page used
// (K8S_API_URL === coordinator base + /api).

export interface ClusterStackMetadata {
  name: string
  displayName?: string
  generation?: number
  resourceVersion?: string
  creationTimestamp?: string
  labels?: Record<string, string>
}

export interface ClusterStackSpec {
  id?: string
  buildImage?: { image?: string }
  runImage?: { image?: string }
}

export interface ClusterStackCondition {
  status?: string
  type?: string
  message?: string
}

export interface ClusterStack {
  metadata?: ClusterStackMetadata
  spec?: ClusterStackSpec
  status?: { conditions?: ClusterStackCondition[] }
}

interface StackForm {
  name?: string
  displayName?: string
  resourceVersion?: string
  imageID?: string
  imageBuild?: string
  imageRun?: string
}

function statusColor(status?: string): 'success' | 'error' | 'default' {
  if (status === 'True') return 'success'
  if (status === 'False') return 'error'
  return 'default'
}

export default function ClusterStacksPanel() {
  const [rows, setRows] = useState<ClusterStack[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit' | 'json'>('create')
  const [form, setForm] = useState<StackForm>({})
  const [jsonTarget, setJsonTarget] = useState<ClusterStack | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ClusterStack | null>(null)

  const fetchData = useCallback(() => {
    setErr(null)
    return coordinatorGet<ClusterStack[]>('/api/k8s-cluster-stack/')
      .then((data) => setRows(data))
      .catch((e: ApiError) => setErr(`Failed to load cluster stacks: ${e.message}`))
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const openCreate = () => {
    setForm({})
    setMode('create')
    setDialogOpen(true)
  }

  const openEdit = (row: ClusterStack) => {
    setForm({
      name: row.metadata?.name,
      displayName: row.metadata?.displayName,
      resourceVersion: row.metadata?.resourceVersion,
      imageID: row.spec?.id,
      imageBuild: row.spec?.buildImage?.image,
      imageRun: row.spec?.runImage?.image,
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
      if (mode === 'create') {
        await coordinatorPost('/api/k8s-cluster-stack/', {
          displayName: form.displayName,
          id: form.imageID,
          buildImage: form.imageBuild,
          runImage: form.imageRun,
        })
      } else {
        await coordinatorPut(`/api/k8s-cluster-stack/${form.name}`, {
          resourceVersion: form.resourceVersion,
          id: form.imageID,
          buildImage: form.imageBuild,
          runImage: form.imageRun,
        })
      }
      closeDialog()
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save cluster stack')
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget?.metadata?.name) return
    setSubmitting(true)
    try {
      await coordinatorDelete(`/api/k8s-cluster-stack/${deleteTarget.metadata.name}`)
      setDeleteTarget(null)
      await fetchData()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to delete cluster stack')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Cluster Stacks
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add stack
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
            Loading cluster stacks…
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
                      No cluster stacks.
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
        <DialogTitle>{mode === 'create' ? 'Create cluster stack' : 'Update cluster stack'}</DialogTitle>
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
              label="Stack ID"
              value={form.imageID || ''}
              onChange={(e) => setForm((p) => ({ ...p, imageID: e.target.value }))}
              size="small"
            />
            <TextField
              label="Build image"
              value={form.imageBuild || ''}
              onChange={(e) => setForm((p) => ({ ...p, imageBuild: e.target.value }))}
              size="small"
            />
            <TextField
              label="Run image"
              value={form.imageRun || ''}
              onChange={(e) => setForm((p) => ({ ...p, imageRun: e.target.value }))}
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
        <DialogTitle>Cluster stack JSON</DialogTitle>
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
        <DialogTitle>Delete cluster stack</DialogTitle>
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
