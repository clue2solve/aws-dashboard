import { useState } from 'react'
import { Box, Typography, Tabs, Tab } from '@mui/material'
import { motion } from 'framer-motion'
import BuildersPanel from './BuildersPanel'
import ClusterStacksPanel from './ClusterStacksPanel'
import ClusterStoresPanel from './ClusterStoresPanel'

// Single sidebar leaf ('platform/kpack') fanning out to three kpack resource
// panels via an internal MUI Tabs strip, rather than three separate sidebar
// leaves — these are a niche, rarely-touched admin surface that share one
// data domain (Builders depends on Stacks/Stores for its create-form
// dropdowns), so one container keeps the left nav from growing a 3-deep
// accordion for it.

export default function KpackTab() {
  const [tab, setTab] = useState(0)

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          kpack
        </Typography>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
          <Tab label="Builders" />
          <Tab label="Cluster Stacks" />
          <Tab label="Cluster Stores" />
        </Tabs>

        {tab === 0 && <BuildersPanel />}
        {tab === 1 && <ClusterStacksPanel />}
        {tab === 2 && <ClusterStoresPanel />}
      </Box>
    </motion.div>
  )
}
