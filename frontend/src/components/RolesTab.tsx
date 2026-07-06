import { useEffect, useState } from 'react'
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
  Chip,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { motion } from 'framer-motion'
import { coordinatorGet, ApiError } from '../api'

interface Role {
  id: string
  name: string
  accountId: string | null
  accountName: string | null
  createdOn: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function RolesTab() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    coordinatorGet<Role[]>('/api/roles')
      .then((data) => { if (!cancelled) setRoles(data) })
      .catch((e: ApiError) => {
        if (cancelled) return
        setErr(e.status === 403
          ? 'SYSTEM privileges required to view all roles.'
          : `Failed to load roles: ${e.message}`)
      })
    return () => { cancelled = true }
  }, [])

  const filtered = roles?.filter((r) =>
    !q ||
    (r.name ?? '').toLowerCase().includes(q.toLowerCase()) ||
    r.id.toLowerCase().includes(q.toLowerCase())) ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>Roles</Typography>
        <Typography variant="body2" color="text.secondary">
          Cross-tenant list of roles on the platform (predefined + custom). Read-only — no permission graph shown here (would N+1).
        </Typography>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      {!roles && !err && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Loading roles…</Typography>
        </Box>
      )}

      {roles && (
        <>
          <TextField
            size="small"
            placeholder="Filter by name or id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ mb: 2, maxWidth: 360 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>ID</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                        {q ? 'No roles match.' : 'No roles.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{r.name || '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      {r.accountId === null
                        ? <Chip label="Platform" size="small" color="default" variant="outlined" />
                        : (r.accountName || '—')}
                    </TableCell>
                    <TableCell>{formatDate(r.createdOn)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                      {r.id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {filtered.length} of {roles.length} role{roles.length === 1 ? '' : 's'}
          </Typography>
        </>
      )}
    </motion.div>
  )
}
