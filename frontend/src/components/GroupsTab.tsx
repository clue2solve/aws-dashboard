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
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { motion } from 'framer-motion'
import { coordinatorGet, ApiError } from '../api'

interface Group {
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

export default function GroupsTab() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    coordinatorGet<Group[]>('/api/groups')
      .then((data) => { if (!cancelled) setGroups(data) })
      .catch((e: ApiError) => {
        if (cancelled) return
        setErr(e.status === 403
          ? 'SYSTEM privileges required to view all groups.'
          : `Failed to load groups: ${e.message}`)
      })
    return () => { cancelled = true }
  }, [])

  const filtered = groups?.filter((g) =>
    !q ||
    (g.name ?? '').toLowerCase().includes(q.toLowerCase()) ||
    g.id.toLowerCase().includes(q.toLowerCase())) ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>Groups</Typography>
        <Typography variant="body2" color="text.secondary">
          Cross-tenant list of groups on the platform. Read-only — no member list shown here (would N+1).
        </Typography>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      {!groups && !err && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Loading groups…</Typography>
        </Box>
      )}

      {groups && (
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
                        {q ? 'No groups match.' : 'No groups.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((g) => (
                  <TableRow key={g.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{g.name || '—'}</Typography>
                    </TableCell>
                    <TableCell>{g.accountName || '—'}</TableCell>
                    <TableCell>{formatDate(g.createdOn)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                      {g.id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {filtered.length} of {groups.length} group{groups.length === 1 ? '' : 's'}
          </Typography>
        </>
      )}
    </motion.div>
  )
}
