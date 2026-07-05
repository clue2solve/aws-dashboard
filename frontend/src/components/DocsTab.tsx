import { useState } from 'react'
import {
  Box,
  Typography,
  Paper,
  Button,
  Stack,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import DescriptionIcon from '@mui/icons-material/Description'
import { motion, AnimatePresence } from 'framer-motion'

// Registry of available design docs. To add a new doc:
//   1. drop the standalone HTML file into `frontend/public/docs/`
//   2. add a one-line entry below
// The HTML files are self-contained (inline CSS) and rendered inside an
// <iframe> so their styles don't leak into the admin app's MUI theme.
interface DocEntry {
  id: string
  title: string
  description: string
  updated: string
  href: string
}

const DOCS: DocEntry[] = [
  {
    id: 'platform-decisions',
    title: 'Platform decisions — DB strategy, admin IA, rollout',
    description:
      'Decision memo combining AWS DB cost comparison, serverless-Postgres evaluation, and the Platform Admin dashboard information architecture.',
    updated: '2026-07-01',
    href: '/docs/platform-decisions.html',
  },
]

export default function DocsTab() {
  const [openDocId, setOpenDocId] = useState<string | null>(null)

  const openDoc = openDocId ? DOCS.find((d) => d.id === openDocId) ?? null : null

  return (
    <Box>
      <AnimatePresence mode="wait">
        {!openDoc && (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <Box sx={{ mb: 3 }}>
              <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
                Design docs
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Durable copies of the platform&apos;s in-flight decision memos.
                Renders the same HTML we produce as Artifacts in Claude sessions.
              </Typography>
            </Box>

            <Stack spacing={1.5}>
              {DOCS.map((doc) => (
                <Paper
                  key={doc.id}
                  elevation={0}
                  onClick={() => setOpenDocId(doc.id)}
                  sx={{
                    p: 2.5,
                    cursor: 'pointer',
                    bgcolor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    transition: 'background-color 0.15s, border-color 0.15s',
                    '&:hover': {
                      bgcolor: 'rgba(255,255,255,0.06)',
                      borderColor: 'rgba(255,255,255,0.18)',
                    },
                  }}
                >
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <DescriptionIcon
                      sx={{ mt: 0.5, color: 'primary.light', opacity: 0.9 }}
                    />
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ mb: 0.5 }}
                      >
                        <Typography variant="subtitle1" fontWeight={600}>
                          {doc.title}
                        </Typography>
                        <Chip
                          label={`Updated ${doc.updated}`}
                          size="small"
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.06)',
                            color: 'text.secondary',
                            fontSize: '0.7rem',
                            height: 20,
                          }}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {doc.description}
                      </Typography>
                    </Box>
                    <Tooltip title="Open in new tab">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(doc.href, '_blank', 'noopener,noreferrer')
                        }}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </motion.div>
        )}

        {openDoc && (
          <motion.div
            key={openDoc.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Button
                startIcon={<ArrowBackIcon />}
                variant="outlined"
                size="small"
                onClick={() => setOpenDocId(null)}
                sx={{ textTransform: 'none' }}
              >
                Back to docs list
              </Button>
              <Button
                startIcon={<OpenInNewIcon />}
                variant="text"
                size="small"
                onClick={() =>
                  window.open(openDoc.href, '_blank', 'noopener,noreferrer')
                }
                sx={{ textTransform: 'none' }}
              >
                Open in new tab
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="body2" color="text.secondary" noWrap>
                {openDoc.title}
              </Typography>
            </Stack>

            <Box
              component="iframe"
              src={openDoc.href}
              title={openDoc.title}
              sx={{
                width: '100%',
                height: '80vh',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 2,
                bgcolor: 'white',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  )
}
