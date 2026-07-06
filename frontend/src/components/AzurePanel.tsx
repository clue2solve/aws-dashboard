import { Box, Paper, Typography, Chip, useTheme } from '@mui/material'
import CloudQueueIcon from '@mui/icons-material/CloudQueue'
import { motion } from 'framer-motion'

/**
 * Coming-soon panel for the Azure integration. Rendered when the user clicks
 * Infra → Azure in the left nav. Kept intentionally minimal — enough to signal
 * intent without pretending we have anything real to show.
 */
export default function AzurePanel() {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'calc(100vh - 160px)',
          px: 3,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            maxWidth: 520,
            width: '100%',
            p: 5,
            textAlign: 'center',
            borderRadius: 3,
            bgcolor: isDark ? 'background.paper' : '#fff',
            borderColor: isDark ? '#1e293b' : '#e2e8f0',
          }}
        >
          <CloudQueueIcon
            sx={{
              fontSize: 56,
              color: 'primary.main',
              mb: 2,
            }}
          />
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
            Azure
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}
          >
            Azure integration is on the roadmap. Chat about priorities.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Chip
              label="Azure Cost Management"
              variant="outlined"
              sx={{ fontWeight: 500 }}
            />
            <Chip label="AKS clusters" variant="outlined" sx={{ fontWeight: 500 }} />
          </Box>
        </Paper>
      </Box>
    </motion.div>
  )
}
