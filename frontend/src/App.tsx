import { useState, useMemo } from 'react'
import {
  Box,
  Container,
  Tabs,
  Tab,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Chip,
} from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import CloudIcon from '@mui/icons-material/Cloud'
import CloseIcon from '@mui/icons-material/Close'
import ClusterTab from './components/ClusterTab'
import AwsSection from './components/AwsSection'
import PlatformSection from './components/PlatformSection'

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <AnimatePresence mode="wait">
      {value === index && (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
        >
          <Box sx={{ py: 3 }}>{children}</Box>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Top-level nav: only two sections. Each renders its own sub-tab bar.
// - AWS      → Services / Compute / Clusters / Access
// - Platform → Cost / Agents / Directory / Docs
//
// Rationale: separates cloud infra from c2a-platform surfaces cleanly.
// Directory nests under Platform (Orgs/Users/Groups/Roles/Invitations)
// because those are c2a-platform tenants, not AWS-side users.
const TOP = {
  aws: 0,
  platform: 1,
} as const

function App() {
  // Deep-link support: ?cluster=NAME opens a focused single-cluster view
  // (unchanged behavior). Without focused view, we still open on AWS→Clusters
  // when the param is present.
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialCluster = urlParams.get('cluster')
  const isFocusedView = !!initialCluster

  // With ?cluster, we intentionally start on AWS section — Clusters sub-tab
  // opens itself via AwsSection's initialSub prop below.
  const [tabValue, setTabValue] = useState<number>(TOP.aws)

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue)
  }

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
            <Chip label="EKS Cluster" size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <CloudIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Platform Admin — Clue2App
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 3 }}>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs
              value={tabValue}
              onChange={handleTabChange}
              sx={{
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '1rem',
                },
              }}
            >
              <Tab label="AWS" />
              <Tab label="Platform" />
            </Tabs>
          </Box>
        </motion.div>

        <TabPanel value={tabValue} index={TOP.aws}>
          <AwsSection initialCluster={null} />
        </TabPanel>
        <TabPanel value={tabValue} index={TOP.platform}>
          <PlatformSection />
        </TabPanel>
      </Container>
    </Box>
  )
}

export default App
