import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  CircularProgress,
  Alert,
  Stack,
  Drawer,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import { motion } from 'framer-motion'
import {
  coordinatorGet,
  coordinatorPost,
  coordinatorPut,
  coordinatorDelete,
  ApiError,
} from '../api'

// -----------------------------------------------------------------------------
// Types mirroring the coordinator's FeatureFlagRecord / FeatureFlagOverrideRecord
// -----------------------------------------------------------------------------

type FlagKind = 'BOOLEAN' | 'STRING' | 'NUMBER' | 'JSON'
type OverrideScope = 'GLOBAL' | 'ACCOUNT' | 'USER'

interface FeatureFlagRecord {
  id: string
  key: string
  description: string | null
  kind: FlagKind
  defaultValue: string
  enabled: boolean
  overrideCount?: number
  createdOn: string
  createdBy: string | null
  updatedOn: string
  updatedBy: string | null
}

interface FeatureFlagOverrideRecord {
  id: string
  flagId: string
  scope: OverrideScope
  scopeId: string | null
  value: string
  enabled: boolean
  createdOn: string
  createdBy: string | null
}

const FLAG_KINDS: FlagKind[] = ['BOOLEAN', 'STRING', 'NUMBER', 'JSON']
const OVERRIDE_SCOPES: OverrideScope[] = ['GLOBAL', 'ACCOUNT', 'USER']

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// -----------------------------------------------------------------------------
// Sub-nav shell
// -----------------------------------------------------------------------------

const SUB_TABS = ['Flags', 'Config', 'Defaults', 'Kill-switches', 'Change log'] as const
type SubTab = (typeof SUB_TABS)[number]

function ComingSoonStub({ label }: { label: string }) {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {label} — Coming soon
      </Typography>
    </Box>
  )
}

export default function AdministrationTab() {
  const [tab, setTab] = useState<SubTab>('Flags')

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>Administration</Typography>
        <Typography variant="body2" color="text.secondary">
          Platform-wide feature flags, configuration, defaults, and kill-switches.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(_e, v: SubTab) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {SUB_TABS.map((t) => (
            <Tab key={t} value={t} label={t} />
          ))}
        </Tabs>
      </Paper>

      {tab === 'Flags' ? <FlagsSubTab /> : <ComingSoonStub label={tab} />}
    </motion.div>
  )
}

// -----------------------------------------------------------------------------
// Flags sub-tab
// -----------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000

function FlagsSubTab() {
  const [flags, setFlags] = useState<FeatureFlagRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FeatureFlagRecord | null>(null)

  const [drawerFlag, setDrawerFlag] = useState<FeatureFlagRecord | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const loadFlags = useCallback(() => {
    coordinatorGet<FeatureFlagRecord[]>('/api/v1/platform/flags')
      .then((data) => {
        setFlags(data)
        setListError(null)
      })
      .catch((e: ApiError) => {
        setListError(
          e.status === 403
            ? 'SYSTEM privileges required to view feature flags.'
            : `Failed to load feature flags: ${e.message}`,
        )
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadFlags()
    const t = setInterval(loadFlags, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [loadFlags])

  const filteredFlags = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return flags
    return flags.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q),
    )
  }, [flags, search])

  const handleDelete = async (flag: FeatureFlagRecord) => {
    if (!window.confirm(`Delete flag "${flag.key}"? This also deletes its overrides.`)) {
      return
    }
    setDeletingKey(flag.key)
    try {
      await coordinatorDelete(`/api/v1/platform/flags/${flag.key}`)
      loadFlags()
    } catch (e) {
      const err = e as ApiError
      setListError(err.message || 'Failed to delete flag.')
    } finally {
      setDeletingKey(null)
    }
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <TextField
          size="small"
          placeholder="Search flags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
          }}
          sx={{ minWidth: 260 }}
        />
        <Button
          variant="contained"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          New flag
        </Button>
      </Stack>

      {listError && <Alert severity="error" sx={{ mb: 2 }}>{listError}</Alert>}

      {loading && !listError && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Loading feature flags…</Typography>
        </Box>
      )}

      {!loading && !listError && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Key</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell>Default</TableCell>
                  <TableCell>Enabled</TableCell>
                  <TableCell>Overrides</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredFlags.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                        {flags.length === 0
                          ? 'No feature flags yet. Create one to get started.'
                          : 'No flags match your search.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {filteredFlags.map((f) => (
                  <TableRow
                    key={f.id}
                    hover
                    onClick={() => setDrawerFlag(f)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">{f.key}</Typography>
                      {f.description && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {f.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={f.kind} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.defaultValue}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={f.enabled ? 'success' : 'default'}
                        label={f.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </TableCell>
                    <TableCell>{f.overrideCount ?? '—'}</TableCell>
                    <TableCell>{formatDate(f.updatedOn)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditing(f)
                              setDialogOpen(true)
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={deletingKey === f.key}
                              onClick={() => handleDelete(f)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {filteredFlags.length} of {flags.length} flags
          </Typography>
        </>
      )}

      <FlagFormDialog
        open={dialogOpen}
        flag={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false)
          loadFlags()
        }}
      />

      <OverridesDrawer
        flag={drawerFlag}
        onClose={() => setDrawerFlag(null)}
        onOverridesChanged={loadFlags}
      />
    </Box>
  )
}

// -----------------------------------------------------------------------------
// Create / edit dialog
// -----------------------------------------------------------------------------

interface FlagFormDialogProps {
  open: boolean
  flag: FeatureFlagRecord | null
  onClose: () => void
  onSaved: () => void
}

function FlagFormDialog({ open, flag, onClose, onSaved }: FlagFormDialogProps) {
  const isEdit = !!flag

  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<FlagKind>('BOOLEAN')
  const [defaultValue, setDefaultValue] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (flag) {
      setKey(flag.key)
      setDescription(flag.description ?? '')
      setKind(flag.kind)
      setDefaultValue(flag.defaultValue)
      setEnabled(flag.enabled)
    } else {
      setKey('')
      setDescription('')
      setKind('BOOLEAN')
      setDefaultValue('')
      setEnabled(true)
    }
    setError(null)
  }, [open, flag])

  const handleSubmit = async () => {
    setError(null)
    if (!isEdit && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key.trim())) {
      setError('Key must be kebab-case (e.g. my-new-feature).')
      return
    }
    if (!defaultValue.trim()) {
      setError('Default value is required.')
      return
    }
    setSubmitting(true)
    try {
      if (isEdit && flag) {
        await coordinatorPut(`/api/v1/platform/flags/${flag.key}`, {
          description: description.trim() || undefined,
          kind,
          defaultValue: defaultValue.trim(),
          enabled,
        })
      } else {
        await coordinatorPost('/api/v1/platform/flags', {
          key: key.trim(),
          description: description.trim() || undefined,
          kind,
          defaultValue: defaultValue.trim(),
        })
      }
      onSaved()
    } catch (e) {
      const err = e as ApiError
      setError(err.message || 'Failed to save flag.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {isEdit ? `Edit flag: ${flag?.key}` : 'New flag'}
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Key"
            size="small"
            required
            disabled={isEdit}
            placeholder="my-new-feature"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            helperText={isEdit ? 'Key cannot be changed after creation.' : 'kebab-case identifier'}
          />
          <TextField
            label="Description"
            size="small"
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <FormControl size="small">
            <InputLabel id="flag-kind-label">Kind</InputLabel>
            <Select
              labelId="flag-kind-label"
              label="Kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as FlagKind)}
            >
              {FLAG_KINDS.map((k) => (
                <MenuItem key={k} value={k}>{k}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Default value"
            size="small"
            required
            placeholder={kind === 'BOOLEAN' ? 'true / false' : kind === 'JSON' ? '{"a":1}' : ''}
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            helperText='Serialized per kind (e.g. "true", "42", raw JSON text).'
          />
          {isEdit && (
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label="Enabled"
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create flag'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// -----------------------------------------------------------------------------
// Overrides drawer
// -----------------------------------------------------------------------------

interface OverridesDrawerProps {
  flag: FeatureFlagRecord | null
  onClose: () => void
  onOverridesChanged: () => void
}

function OverridesDrawer({ flag, onClose, onOverridesChanged }: OverridesDrawerProps) {
  const [overrides, setOverrides] = useState<FeatureFlagOverrideRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [scope, setScope] = useState<OverrideScope>('GLOBAL')
  const [scopeId, setScopeId] = useState('')
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadOverrides = useCallback(() => {
    if (!flag) return
    setLoading(true)
    coordinatorGet<FeatureFlagOverrideRecord[]>(`/api/v1/platform/flags/${flag.key}/overrides`)
      .then((data) => {
        setOverrides(data)
        setError(null)
      })
      .catch((e: ApiError) => setError(e.message || 'Failed to load overrides.'))
      .finally(() => setLoading(false))
  }, [flag])

  useEffect(() => {
    if (flag) {
      setScope('GLOBAL')
      setScopeId('')
      setValue('')
      setFormError(null)
      loadOverrides()
    }
  }, [flag, loadOverrides])

  const handleAddOverride = async () => {
    if (!flag) return
    setFormError(null)
    if (scope !== 'GLOBAL' && !scopeId.trim()) {
      setFormError(`Scope ID is required for ${scope} overrides.`)
      return
    }
    if (!value.trim()) {
      setFormError('Value is required.')
      return
    }
    setSubmitting(true)
    try {
      await coordinatorPost(`/api/v1/platform/flags/${flag.key}/overrides`, {
        scope,
        scopeId: scope === 'GLOBAL' ? undefined : scopeId.trim(),
        value: value.trim(),
      })
      setScopeId('')
      setValue('')
      loadOverrides()
      onOverridesChanged()
    } catch (e) {
      const err = e as ApiError
      setFormError(err.message || 'Failed to create override.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteOverride = async (id: string) => {
    if (!flag) return
    setDeletingId(id)
    try {
      await coordinatorDelete(`/api/v1/platform/flags/${flag.key}/overrides/${id}`)
      loadOverrides()
      onOverridesChanged()
    } catch (e) {
      const err = e as ApiError
      setError(err.message || 'Failed to delete override.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Drawer anchor="right" open={!!flag} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 480 }, p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600} fontFamily="monospace">
              {flag?.key}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {flag?.description || 'No description.'}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
          <Chip size="small" label={flag?.kind} variant="outlined" />
          <Chip
            size="small"
            color={flag?.enabled ? 'success' : 'default'}
            label={flag?.enabled ? 'Enabled' : 'Disabled'}
          />
          <Chip size="small" variant="outlined" label={`Default: ${flag?.defaultValue}`} />
        </Stack>

        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Overrides
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading overrides…</Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Scope</TableCell>
                  <TableCell>Scope ID</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Enabled</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overrides.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No overrides. Falls back to default value for everyone.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {overrides.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={o.scope} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {o.scopeId ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">{o.value}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={o.enabled ? 'success' : 'default'} label={o.enabled ? 'Yes' : 'No'} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Delete override">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={deletingId === o.id}
                            onClick={() => handleDeleteOverride(o.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Add override
        </Typography>
        <Stack spacing={2}>
          <FormControl size="small">
            <InputLabel id="override-scope-label">Scope</InputLabel>
            <Select
              labelId="override-scope-label"
              label="Scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as OverrideScope)}
            >
              {OVERRIDE_SCOPES.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {scope !== 'GLOBAL' && (
            <TextField
              label={scope === 'ACCOUNT' ? 'Account ID' : 'User ID'}
              size="small"
              required
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            />
          )}
          <TextField
            label="Value"
            size="small"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            helperText="Serialized per flag kind."
          />
          {formError && <Alert severity="error">{formError}</Alert>}
          <Box>
            <Button
              variant="contained"
              onClick={handleAddOverride}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting ? 'Adding…' : 'Add override'}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Drawer>
  )
}
