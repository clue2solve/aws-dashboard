import { useState } from 'react'
import { Box, Tabs, Tab } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import ServicesTab from './ServicesTab'
import ComputeTab from './ComputeTab'
import ClusterTab from './ClusterTab'
import AccessTab from './AccessTab'

// AWS section sub-tab indices — exported so ServicesTab and any deep-link
// caller can jump to a specific sub-tab. Keep in sync with the <Tab/> order.
export const AWS_SUB = {
  services: 0,
  compute: 1,
  clusters: 2,
  access: 3,
} as const
export type AwsSubKey = keyof typeof AWS_SUB

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

interface AwsSectionProps {
  /** Optional initial sub-tab to open. Used for deep-linking (e.g. ?cluster=X → Clusters). */
  initialSub?: AwsSubKey
  /** Optional initialCluster to focus when landing on the Clusters sub-tab. */
  initialCluster?: string | null
}

export default function AwsSection({ initialSub, initialCluster }: AwsSectionProps) {
  const [sub, setSub] = useState<number>(initialSub ? AWS_SUB[initialSub] : AWS_SUB.services)

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
          <Tab label="Services" />
          <Tab label="Compute" />
          <Tab label="Clusters" />
          <Tab label="Access" />
        </Tabs>
      </Box>

      <SubPanel index={AWS_SUB.services} value={sub}>
        {/* onNavigateToTab jumps within this section — e.g. click EC2 tile → Compute sub-tab */}
        <ServicesTab onNavigateToTab={(idx) => setSub(idx)} />
      </SubPanel>
      <SubPanel index={AWS_SUB.compute} value={sub}>
        <ComputeTab />
      </SubPanel>
      <SubPanel index={AWS_SUB.clusters} value={sub}>
        <ClusterTab initialCluster={initialCluster ?? null} />
      </SubPanel>
      <SubPanel index={AWS_SUB.access} value={sub}>
        <AccessTab />
      </SubPanel>
    </Box>
  )
}
