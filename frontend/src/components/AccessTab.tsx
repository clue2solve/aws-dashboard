import { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Snackbar,
} from '@mui/material'
import { motion } from 'framer-motion'
import PersonIcon from '@mui/icons-material/Person'
import GroupIcon from '@mui/icons-material/Group'
import SecurityIcon from '@mui/icons-material/Security'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import GroupAddIcon from '@mui/icons-material/GroupAdd'
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle'

interface User {
  id: string
  username: string
  displayName: string
  givenName: string
  familyName: string
  email: string | null
  title: string
  userType: string
}

interface GroupMember {
  id: string
  username: string
  displayName: string
}

interface Group {
  id: string
  name: string
  description: string
  memberCount: number
  members: GroupMember[]
}

interface PermissionSet {
  arn: string
  name: string
  description: string
  sessionDuration: string
  policies: string[]
}

interface Assignment {
  permissionSetName: string
  principalType: string
  principalName: string
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const item = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
}

function AccessTab() {
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [permissionSets, setPermissionSets] = useState<PermissionSet[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog states
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [addToGroupOpen, setAddToGroupOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  // Form states
  const [newUser, setNewUser] = useState({
    username: '',
    givenName: '',
    familyName: '',
    email: '',
    title: '',
    userType: '',
  })
  const [selectedGroupId, setSelectedGroupId] = useState('')

  const fetchData = async () => {
    try {
      const [usersRes, groupsRes, psRes, assignRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/groups'),
        fetch('/api/permission-sets'),
        fetch('/api/account-assignments'),
      ])

      const usersData = await usersRes.json()
      const groupsData = await groupsRes.json()
      const psData = await psRes.json()
      const assignData = await assignRes.json()

      setUsers(usersData.users || [])
      setGroups(groupsData.groups || [])
      setPermissionSets(psData.permissionSets || [])
      setAssignments(assignData.assignments || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateUser = async () => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to create user')
      }

      setSnackbar({ open: true, message: 'User created successfully!', severity: 'success' })
      setCreateUserOpen(false)
      setNewUser({ username: '', givenName: '', familyName: '', email: '', title: '', userType: '' })
      fetchData()
    } catch (err) {
      setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Failed to create user', severity: 'error' })
    }
  }

  const handleAddToGroup = async () => {
    if (!selectedUser || !selectedGroupId) return

    try {
      const response = await fetch('/api/groups/add-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, groupId: selectedGroupId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to add user to group')
      }

      setSnackbar({ open: true, message: `${selectedUser.displayName} added to group!`, severity: 'success' })
      setAddToGroupOpen(false)
      setSelectedUser(null)
      setSelectedGroupId('')
      fetchData()
    } catch (err) {
      setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Failed to add user to group', severity: 'error' })
    }
  }

  const handleRemoveFromGroup = async (userId: string, groupId: string, userName: string) => {
    try {
      const response = await fetch('/api/groups/remove-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, groupId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to remove user from group')
      }

      setSnackbar({ open: true, message: `${userName} removed from group`, severity: 'success' })
      fetchData()
    } catch (err) {
      setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Failed to remove user', severity: 'error' })
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getColorFromString = (str: string) => {
    const colors = [
      '#1976d2',
      '#388e3c',
      '#d32f2f',
      '#7b1fa2',
      '#f57c00',
      '#0288d1',
      '#c2185b',
      '#00796b',
    ]
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Users Section */}
        <Grid item xs={12} md={6}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon color="primary" />
                    <Typography variant="h6" fontWeight="600">
                      Users ({users.length})
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    startIcon={<PersonAddIcon />}
                    size="small"
                    onClick={() => setCreateUserOpen(true)}
                  >
                    Add User
                  </Button>
                </Box>
                <motion.div variants={container} initial="hidden" animate="show">
                  <List>
                    {users.map((user, index) => (
                      <motion.div key={user.id} variants={item}>
                        <ListItem
                          secondaryAction={
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => {
                                setSelectedUser(user)
                                setAddToGroupOpen(true)
                              }}
                              title="Add to group"
                            >
                              <GroupAddIcon />
                            </IconButton>
                          }
                        >
                          <ListItemAvatar>
                            <Avatar
                              sx={{
                                bgcolor: getColorFromString(user.displayName),
                              }}
                            >
                              {getInitials(user.displayName)}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={user.displayName}
                            secondary={
                              <Box>
                                <Typography variant="caption" display="block">
                                  @{user.username}
                                </Typography>
                                {user.email && (
                                  <Typography variant="caption" color="text.secondary">
                                    {user.email}
                                  </Typography>
                                )}
                              </Box>
                            }
                          />
                          {user.userType && (
                            <Chip label={user.userType} size="small" variant="outlined" sx={{ mr: 1 }} />
                          )}
                        </ListItem>
                        {index < users.length - 1 && <Divider variant="inset" />}
                      </motion.div>
                    ))}
                  </List>
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>
        </Grid>

        {/* Groups Section */}
        <Grid item xs={12} md={6}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <GroupIcon color="primary" />
                  <Typography variant="h6" fontWeight="600">
                    Groups ({groups.length})
                  </Typography>
                </Box>
                {groups.map((group) => (
                  <Accordion key={group.id} sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          pr: 2,
                        }}
                      >
                        <Typography fontWeight="500">{group.name}</Typography>
                        <Chip
                          label={`${group.memberCount} member${
                            group.memberCount !== 1 ? 's' : ''
                          }`}
                          size="small"
                          color="secondary"
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      {group.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          {group.description}
                        </Typography>
                      )}
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Members:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {group.members.map((member) => (
                          <Chip
                            key={member.id}
                            avatar={
                              <Avatar sx={{ bgcolor: getColorFromString(member.displayName) }}>
                                {getInitials(member.displayName)}
                              </Avatar>
                            }
                            label={member.displayName}
                            variant="outlined"
                            size="small"
                            onDelete={() => handleRemoveFromGroup(member.id, group.id, member.displayName)}
                            deleteIcon={<RemoveCircleIcon />}
                          />
                        ))}
                        {group.members.length === 0 && (
                          <Typography variant="body2" color="text.secondary">
                            No members
                          </Typography>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </Grid>

        {/* Permission Sets Section */}
        <Grid item xs={12}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <SecurityIcon color="primary" />
                  <Typography variant="h6" fontWeight="600">
                    Permission Sets ({permissionSets.length})
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  {permissionSets.map((ps) => {
                    const assignedTo = assignments.filter(
                      (a) => a.permissionSetName === ps.name
                    )
                    return (
                      <Grid item xs={12} sm={6} md={4} key={ps.arn}>
                        <Card variant="outlined">
                          <CardContent>
                            <Typography variant="subtitle1" fontWeight="600">
                              {ps.name}
                            </Typography>
                            {ps.description && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.5, mb: 1 }}
                              >
                                {ps.description}
                              </Typography>
                            )}
                            {ps.policies.length > 0 && (
                              <Box sx={{ mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                  Policies:
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {ps.policies.map((policy) => (
                                    <Chip
                                      key={policy}
                                      label={policy}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                    />
                                  ))}
                                </Box>
                              </Box>
                            )}
                            {assignedTo.length > 0 && (
                              <Box>
                                <Typography variant="caption" color="text.secondary">
                                  Assigned to:
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {assignedTo.map((a, i) => (
                                    <Chip
                                      key={i}
                                      label={a.principalName}
                                      size="small"
                                      icon={
                                        a.principalType === 'GROUP' ? (
                                          <GroupIcon />
                                        ) : (
                                          <PersonIcon />
                                        )
                                      }
                                    />
                                  ))}
                                </Box>
                              </Box>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    )
                  })}
                </Grid>
              </CardContent>
            </Card>
          </motion.div>
        </Grid>
      </Grid>

      {/* Create User Dialog */}
      <Dialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New User</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Username"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              fullWidth
              required
              helperText="e.g., john.doe"
            />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="First Name"
                value={newUser.givenName}
                onChange={(e) => setNewUser({ ...newUser, givenName: e.target.value })}
                fullWidth
                required
              />
              <TextField
                label="Last Name"
                value={newUser.familyName}
                onChange={(e) => setNewUser({ ...newUser, familyName: e.target.value })}
                fullWidth
                required
              />
            </Box>
            <TextField
              label="Email"
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Title (optional)"
              value={newUser.title}
              onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
              fullWidth
              helperText="e.g., Developer, Manager"
            />
            <FormControl fullWidth>
              <InputLabel>User Type (optional)</InputLabel>
              <Select
                value={newUser.userType}
                label="User Type (optional)"
                onChange={(e) => setNewUser({ ...newUser, userType: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                <MenuItem value="Developer">Developer</MenuItem>
                <MenuItem value="Admin">Admin</MenuItem>
                <MenuItem value="Viewer">Viewer</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateUserOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateUser}
            disabled={!newUser.username || !newUser.givenName || !newUser.familyName || !newUser.email}
          >
            Create User
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add to Group Dialog */}
      <Dialog open={addToGroupOpen} onClose={() => setAddToGroupOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add {selectedUser?.displayName} to Group</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Select Group</InputLabel>
            <Select
              value={selectedGroupId}
              label="Select Group"
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              {groups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.name}
                  {group.members.some((m) => m.id === selectedUser?.id) && ' (already member)'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddToGroupOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddToGroup}
            disabled={!selectedGroupId}
          >
            Add to Group
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default AccessTab
