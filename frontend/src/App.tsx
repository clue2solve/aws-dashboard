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
import ServicesTab from './components/ServicesTab'
import AccessTab from './components/AccessTab'
import ClusterTab from './components/ClusterTab'

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

function App() {
  // Check for cluster query param
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialCluster = urlParams.get('cluster')
  const isFocusedView = !!initialCluster // Focused view when cluster param exists

  // If cluster param exists, start on Clusters tab (index 2)
  const [tabValue, setTabValue] = useState(initialCluster ? 2 : 0)

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue)
  }

  // Focused cluster-only view
  if (isFocusedView) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Minimal header */}
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

        {/* Cluster content only */}
        <Box sx={{ p: 2, height: 'calc(100vh - 48px)', overflow: 'auto' }}>
          <ClusterTab initialCluster={initialCluster} focusedView />
        </Box>
      </Box>
    )
  }

  // Normal dashboard view
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <CloudIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            AWS Dashboard - Clue2Solve
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
              <Tab label="Services" />
              <Tab label="Users, Roles & Groups" />
              <Tab label="Clusters" />
            </Tabs>
          </Box>
        </motion.div>

        <TabPanel value={tabValue} index={0}>
          <ServicesTab />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <AccessTab />
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <ClusterTab initialCluster={null} />
        </TabPanel>
      </Container>
    </Box>
  )
}

export default App
