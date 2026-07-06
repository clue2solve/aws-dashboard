import { useMemo } from 'react'
import { Box, Typography, IconButton, Chip } from '@mui/material'
import CloudIcon from '@mui/icons-material/Cloud'
import CloseIcon from '@mui/icons-material/Close'
import ClusterTab from './components/ClusterTab'
import AppShell from './components/AppShell'

/**
 * App is intentionally thin. Two responsibilities:
 *
 *   1. The ?cluster=X focused-cluster escape hatch — a single-cluster view
 *      opened by ClusterTab's "open in new tab" affordance. It renders a
 *      minimal chrome (no sidebar) so the tab reads as a dedicated cluster
 *      inspector. Kept verbatim from the original App shell.
 *
 *   2. Otherwise, delegate to <AppShell/>, which owns the left-nav + content
 *      dispatch.
 */
function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialCluster = urlParams.get('cluster')
  const isFocusedView = !!initialCluster

  if (isFocusedView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Box
          sx={{
            bgcolor: 'primary.main',
            color: 'white',
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudIcon />
            <Typography variant="subtitle1" fontWeight="600">
              {initialCluster}
            </Typography>
            <Chip
              label="EKS Cluster"
              size="small"
              sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
            />
          </Box>
          <IconButton
            size="small"
            sx={{ color: 'white' }}
            onClick={() => window.close()}
            title="Close"
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ p: 2, height: 'calc(100vh - 48px)', overflow: 'auto' }}>
          <ClusterTab initialCluster={initialCluster} focusedView />
        </Box>
      </Box>
    )
  }

  return <AppShell />
}

export default App
