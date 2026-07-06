import { useState } from 'react'
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  useTheme,
  CircularProgress,
  Stack,
  Tooltip,
  IconButton,
} from '@mui/material'
import {
  PlayArrow,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  ContentCopy,
} from '@mui/icons-material'
import { motion } from 'framer-motion'
import { coordinatorPost, ApiError } from '../api'

// PreBuild Audit runs a critical-only rule pack against a git ref. This is a
// core-only endpoint (not gated behind the coordinator's normal auth model
// the way most other pages here are) — coordinatorPost still works since it's
// just a cross-app POST to the coordinator host, same idiom as everywhere
// else in this file tree.

interface AuditFinding {
  severity?: string
  rule?: string
  file?: string
  line?: number
  message?: string
  snippet?: string
  suggestedFix?: string
}

interface AuditResult {
  criticalCount?: number
  revision?: string
  scannedAt?: string
  findings?: AuditFinding[]
}

export default function AuditTab() {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const [gitUrl, setGitUrl] = useState('')
  const [revision, setRevision] = useState('main')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runAudit = async () => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const body: Record<string, string> = {
        gitUrl: gitUrl.trim(),
        revision: revision.trim() || 'main',
      }
      if (username) body.authUsername = username
      if (token) body.authPassword = token
      const data = await coordinatorPost<AuditResult>('/api/v1/k8s/code/audit', body)
      setResult(data)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to run audit')
    } finally {
      setLoading(false)
    }
  }

  const panelSx = {
    p: 2,
    borderRadius: 2,
    mb: 2,
    bgcolor: isDark ? 'background.paper' : '#fff',
    border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
  }
  const thSx = {
    fontWeight: 600,
    fontSize: '0.75rem',
    color: 'text.secondary',
    borderColor: isDark ? '#1e293b' : undefined,
  }
  const tdSx = { borderColor: isDark ? '#1e293b' : undefined }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" fontWeight={600} sx={{ flexGrow: 1 }}>
            PreBuild Audit
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Run the critical-only rule pack against a git ref
          </Typography>
        </Box>

        <Paper sx={panelSx}>
          <Stack spacing={2}>
            <TextField
              label="Git URL"
              placeholder="https://github.com/org/repo"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              size="small"
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Revision (branch)"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                size="small"
                sx={{ width: 240 }}
              />
              <Button size="small" variant="text" onClick={() => setShowAuth((v) => !v)}>
                {showAuth ? 'Hide auth' : 'Private repo? Add auth'}
              </Button>
            </Stack>
            {showAuth && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Token / password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  size="small"
                  type="password"
                  fullWidth
                />
              </Stack>
            )}
            <Box>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <PlayArrow />}
                onClick={runAudit}
                disabled={loading || !gitUrl.trim()}
              >
                {loading ? 'Running…' : 'Run audit'}
              </Button>
            </Box>
          </Stack>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {result && (
          <>
            <Paper sx={{ ...panelSx, py: 1.5 }}>
              <Stack direction="row" spacing={4} flexWrap="wrap" alignItems="center">
                {(result.criticalCount ?? 0) > 0 ? (
                  <Chip
                    icon={<ErrorIcon />}
                    label={`${result.criticalCount} critical finding${result.criticalCount === 1 ? '' : 's'}`}
                    sx={{ bgcolor: '#fee2e2', color: '#b91c1c', fontWeight: 600 }}
                  />
                ) : (
                  <Chip
                    icon={<CheckCircle />}
                    label="No critical findings — safe to build"
                    sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }}
                  />
                )}
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Resolved commit
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                      {(result.revision || '').slice(0, 12)}
                    </Typography>
                    <Tooltip title="Copy SHA">
                      <IconButton
                        size="small"
                        onClick={() => navigator.clipboard.writeText(result.revision || '')}
                      >
                        <ContentCopy sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Scanned at
                  </Typography>
                  <Typography variant="body2">{result.scannedAt || '—'}</Typography>
                </Box>
              </Stack>
            </Paper>

            {(result.findings || []).length > 0 && (
              <Paper sx={{ ...panelSx, p: 0, overflow: 'hidden' }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  textTransform="uppercase"
                  letterSpacing={0.5}
                  sx={{ px: 2, pt: 2, display: 'block' }}
                >
                  Findings
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={thSx}>Severity</TableCell>
                        <TableCell sx={thSx}>Rule</TableCell>
                        <TableCell sx={thSx}>Location</TableCell>
                        <TableCell sx={thSx}>Message</TableCell>
                        <TableCell sx={thSx}>Suggested fix</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(result.findings ?? []).map((f, idx) => {
                        const isCritical = (f.severity || '').toLowerCase() === 'critical'
                        return (
                          <TableRow key={idx} hover>
                            <TableCell sx={tdSx}>
                              <Chip
                                size="small"
                                icon={
                                  isCritical ? (
                                    <ErrorIcon sx={{ fontSize: 14 }} />
                                  ) : (
                                    <Warning sx={{ fontSize: 14 }} />
                                  )
                                }
                                label={f.severity || 'info'}
                                sx={{
                                  fontSize: '0.65rem',
                                  height: 20,
                                  fontWeight: 600,
                                  color: isCritical ? '#ef4444' : '#f59e0b',
                                  borderColor: isCritical ? '#ef4444' : '#f59e0b',
                                }}
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                                {f.rule}
                              </Typography>
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                                {f.file}
                                {f.line ? `:${f.line}` : ''}
                              </Typography>
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <Typography variant="body2">{f.message}</Typography>
                              {f.snippet && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ fontFamily: 'ui-monospace, monospace', display: 'block', mt: 0.5 }}
                                >
                                  {f.snippet}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <Typography variant="caption" color="text.secondary">
                                {f.suggestedFix || '—'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
          </>
        )}
      </Box>
    </motion.div>
  )
}
