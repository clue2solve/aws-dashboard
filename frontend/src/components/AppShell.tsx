import { useEffect, useMemo, useState, useCallback } from 'react'
import { Box, AppBar, Toolbar, Typography, Paper } from '@mui/material'
import CloudIcon from '@mui/icons-material/Cloud'
import { motion, AnimatePresence } from 'framer-motion'
import Sidebar from './Sidebar'
import ServicesTab from './ServicesTab'
import ComputeTab from './ComputeTab'
import ClusterTab from './ClusterTab'
import AccessTab from './AccessTab'
import PlatformCostTab from './PlatformCostTab'
import BillingTab from './BillingTab'
import AgentsTab from './AgentsTab'
import AgentDetailPage from './AgentDetailPage'
import OrgsTab from './OrgsTab'
import UsersTab from './UsersTab'
import GroupsTab from './GroupsTab'
import RolesTab from './RolesTab'
import DocsTab from './DocsTab'
import AzurePanel from './AzurePanel'

// -----------------------------------------------------------------------------
// The path model. Every leaf in the sidebar owns a slash-delimited path — no
// router package, just a hash + hashchange listener. `platform/agents/<name>`
// is a special deep-link that renders the AgentDetailPage while keeping the
// Agents leaf highlighted.
// -----------------------------------------------------------------------------

const DEFAULT_PATH = 'infra/aws/services'

function readHashPath(): string {
  const raw = window.location.hash
  if (!raw) return DEFAULT_PATH
  return raw.replace(/^#\/?/, '') || DEFAULT_PATH
}

function writeHashPath(path: string) {
  const target = `#/${path}`
  // Skip pushing an identical hash to avoid a spurious hashchange loop.
  if (window.location.hash !== target) {
    window.location.hash = target
  }
}

// Small centered stub for directory sub-paths that don't have a component yet.
function DirectoryStub({ name, blockedOn }: { name: string; blockedOn: string }) {
  return (
    <Box sx={{ p: 4 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          {name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Coming soon. Blocked on: <strong>{blockedOn}</strong>.
        </Typography>
      </Paper>
    </Box>
  )
}

function NotFound({ path }: { path: string }) {
  return (
    <Box sx={{ p: 4 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          Unknown section
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No content wired for path <code>{path}</code>. Pick another item from the
          left nav.
        </Typography>
      </Paper>
    </Box>
  )
}

export default function AppShell(): JSX.Element {
  const [selectedPath, setSelectedPath] = useState<string>(() => readHashPath())

  // Sync the hash → state on external navigation (browser back/forward, or
  // paste-a-link). Ignore programmatic pushes we made ourselves — those already
  // updated state via onSelect.
  useEffect(() => {
    const handler = () => {
      const next = readHashPath()
      setSelectedPath((prev) => (prev === next ? prev : next))
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path)
    writeHashPath(path)
  }, [])

  // The Sidebar highlights `platform/agents` when we're on
  // `platform/agents/<name>`; when the user clicks Back on the detail page we
  // land back on `platform/agents`.
  const isAgentDetail = useMemo(() => {
    return selectedPath.startsWith('platform/agents/') && selectedPath !== 'platform/agents'
  }, [selectedPath])

  const agentDetailName = useMemo(() => {
    if (!isAgentDetail) return null
    return selectedPath.slice('platform/agents/'.length)
  }, [isAgentDetail, selectedPath])

  // Dispatch table. Kept flat and readable — one branch per leaf path.
  const content = useMemo(() => {
    if (agentDetailName) {
      return (
        <AgentDetailPage
          agentName={agentDetailName}
          onBack={() => handleSelect('platform/agents')}
        />
      )
    }
    switch (selectedPath) {
      case 'infra/aws/services':
        return <ServicesTab onNavigateToTab={(p) => handleSelect(p)} />
      case 'infra/aws/compute':
        return <ComputeTab />
      case 'infra/aws/clusters':
        return <ClusterTab initialCluster={null} />
      case 'infra/aws/access':
        return <AccessTab />
      case 'infra/azure':
        return <AzurePanel />
      case 'platform/cost':
        return <PlatformCostTab />
      case 'platform/billing':
        return <BillingTab />
      case 'platform/agents':
        return (
          <AgentsTab
            onOpenAgent={(name) => handleSelect(`platform/agents/${name}`)}
          />
        )
      case 'platform/directory/orgs':
        return <OrgsTab />
      case 'platform/directory/users':
        return <UsersTab />
      case 'platform/directory/groups':
        return <GroupsTab />
      case 'platform/directory/roles':
        return <RolesTab />
      case 'platform/directory/invitations':
        return (
          <DirectoryStub
            name="Invitations"
            blockedOn="operator wizard PR (new account + single-project user invites — migrating from console PRs 2/3/4)"
          />
        )
      case 'platform/docs':
        return <DocsTab />
      default:
        return <NotFound path={selectedPath} />
    }
  }, [selectedPath, agentDetailName, handleSelect])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar>
          <CloudIcon sx={{ mr: 2, color: 'primary.light' }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Clue2App - Administration
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
        <Sidebar selectedPath={selectedPath} onSelect={handleSelect} />

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            px: { xs: 2, md: 3 },
            py: 2,
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedPath}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  )
}
