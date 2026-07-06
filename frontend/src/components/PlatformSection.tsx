import { useState } from 'react'
import { Box, Tabs, Tab } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import PlatformCostTab from './PlatformCostTab'
import AgentsTab from './AgentsTab'
import DirectoryTab from './DirectoryTab'
import DocsTab from './DocsTab'

export const PLATFORM_SUB = {
  cost: 0,
  agents: 1,
  directory: 2,
  docs: 3,
} as const

interface SubPanelProps {
  index: number
  value: number
  children: React.ReactNode
}

function SubPanel({ index, value, children }: SubPanelProps) {
  return (
    <AnimatePresence mode="wait">
      {value === index && (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <Box sx={{ py: 2 }}>{children}</Box>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function PlatformSection() {
  const [sub, setSub] = useState<number>(PLATFORM_SUB.cost)

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}>
        <Tabs
          value={sub}
          onChange={(_, v) => setSub(v)}
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '0.9rem',
              minHeight: 40,
              py: 0.5,
            },
          }}
        >
          <Tab label="Cost" />
          <Tab label="Agents" />
          <Tab label="Directory" />
          <Tab label="Docs" />
        </Tabs>
      </Box>

      <SubPanel index={PLATFORM_SUB.cost} value={sub}><PlatformCostTab /></SubPanel>
      <SubPanel index={PLATFORM_SUB.agents} value={sub}><AgentsTab /></SubPanel>
      <SubPanel index={PLATFORM_SUB.directory} value={sub}><DirectoryTab /></SubPanel>
      <SubPanel index={PLATFORM_SUB.docs} value={sub}><DocsTab /></SubPanel>
    </Box>
  )
}
