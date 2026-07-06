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
  Alert,
} from '@mui/material'
import { motion } from 'framer-motion'

// PlatformLimits has no console source page to port — MAX_LIMITS today is a
// hardcoded frontend constant in console/src/helpers/constants.js, not a
// per-account value read from any backend. There is no coordinator or admin
// endpoint for it yet, so this panel is a read-only mirror of the current
// hardcoded defaults rather than a live editor. Wiring this up to a real
// per-account limits store (coordinator vs admin-backend DB — undecided) is
// follow-up work; flagging here rather than guessing a fake API contract.

const CURRENT_DEFAULTS: { key: string; label: string; value: number | string }[] = [
  { key: 'applications', label: 'Applications per account', value: 5 },
  { key: 'secrets', label: 'Secrets per project', value: 10 },
  { key: 'postgresInstances', label: 'Postgres instances', value: 1 },
  { key: 'clusters', label: 'Clusters', value: 0 },
]

export default function PlatformLimitsTab() {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          Platform Limits
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Per-account resource limits (MAX_LIMITS).
        </Typography>

        <Alert severity="info" sx={{ mb: 3 }}>
          These values are currently hardcoded in the console frontend (
          <code>console/src/helpers/constants.js</code>) — there is no backend endpoint yet to read or
          write per-account limits. This panel mirrors today's defaults read-only. Making limits
          actually per-account requires deciding where they're persisted (coordinator vs admin-backend
          DB) before an editor can be built here.
        </Alert>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Limit</TableCell>
                <TableCell align="right">Default value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CURRENT_DEFAULTS.map((row) => (
                <TableRow key={row.key} hover>
                  <TableCell>{row.label}</TableCell>
                  <TableCell align="right">{row.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </motion.div>
  )
}
