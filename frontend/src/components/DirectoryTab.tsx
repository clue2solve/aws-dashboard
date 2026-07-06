import { useState } from 'react'
import { Box, Tabs, Tab, Typography, Paper } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import OrgsTab from './OrgsTab'

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

function Stub({ name, blockedOn }: { name: string; blockedOn: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto' }}>
        Coming soon. Blocked on: <strong>{blockedOn}</strong>.
      </Typography>
    </Paper>
  )
}

export default function DirectoryTab() {
  const [sub, setSub] = useState(0)

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
          <Tab label="Orgs" />
          <Tab label="Users" />
          <Tab label="Groups" />
          <Tab label="Roles" />
          <Tab label="Invitations" />
        </Tabs>
      </Box>

      <SubPanel index={0} value={sub}><OrgsTab /></SubPanel>
      <SubPanel index={1} value={sub}>
        <Stub name="Users" blockedOn="coordinator GET /api/users cross-tenant list (SYSTEM only) — next PR" />
      </SubPanel>
      <SubPanel index={2} value={sub}>
        <Stub name="Groups" blockedOn="coordinator Groups CRUD API (RBAC Step 4+ tracked in memory)" />
      </SubPanel>
      <SubPanel index={3} value={sub}>
        <Stub name="Roles" blockedOn="coordinator GET /api/roles cross-tenant list (SYSTEM only) — next PR" />
      </SubPanel>
      <SubPanel index={4} value={sub}>
        <Stub name="Invitations" blockedOn="operator wizard PR (new account + single-project user invites — migrating from console PRs 2/3/4)" />
      </SubPanel>
    </Box>
  )
}
