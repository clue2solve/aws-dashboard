import { createTheme } from '@mui/material/styles'

// -----------------------------------------------------------------------------
// Clue2App brand theme for the admin dashboard.
//
// These values are copied BY HAND from the console's design tokens at
//   console/src/helpers/designSystem.js
// (brand orange palette, darkSurface palette, glassCard/brandButton recipes).
// This file intentionally does NOT import that module — admin must not take a
// runtime dependency on console. Keep the two files in sync manually if the
// console tokens change.
// -----------------------------------------------------------------------------

// brand.orange* from designSystem.js
const brand = {
  orange300: '#FDBA74',
  orange400: '#FB923C',
  orange500: '#F97316',
  orange600: '#EA580C',
  orange700: '#C2410C',
}

// darkSurface.* from designSystem.js
const darkSurface = {
  base: '#0a0e27',
  raised: '#0f172a',
  card: '#131a3a',
  border: 'rgba(255,255,255,0.08)',
  text: 'rgba(255,255,255,0.92)',
  textMuted: 'rgba(255,255,255,0.65)',
  textFaint: 'rgba(255,255,255,0.45)',
}

// gradients.pageDark from designSystem.js
const pageDarkGradient =
  'radial-gradient(ellipse at 20% 0%, rgba(234,88,12,0.10), transparent 50%), ' +
  'radial-gradient(ellipse at 80% 100%, rgba(99,102,241,0.10), transparent 55%), ' +
  `linear-gradient(180deg, ${darkSurface.base} 0%, ${darkSurface.raised} 60%, ${darkSurface.card} 100%)`

// gradients.brand / gradients.brandHover from designSystem.js
const brandGradient = `linear-gradient(135deg, ${brand.orange600} 0%, ${brand.orange500} 100%)`
const brandHoverGradient = `linear-gradient(135deg, ${brand.orange700} 0%, ${brand.orange600} 100%)`

export const adminTheme = createTheme({
  palette: {
    mode: 'dark', // console's dark-glass look is the brand default
    primary: {
      main: brand.orange500,
      light: brand.orange400,
      dark: brand.orange600,
      contrastText: '#ffffff',
    },
    secondary: {
      main: brand.orange300,
      dark: brand.orange700,
      contrastText: '#0a0e27',
    },
    background: {
      default: darkSurface.base,
      paper: darkSurface.card,
    },
    text: {
      primary: darkSurface.text,
      secondary: darkSurface.textMuted,
      disabled: darkSurface.textFaint,
    },
    divider: darkSurface.border,
  },
  typography: {
    // Inter is already preloaded in index.html.
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h6: { fontWeight: 700, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 700, letterSpacing: '0.02em' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: pageDarkGradient,
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: `linear-gradient(135deg, rgba(19,26,58,0.85) 0%, rgba(10,14,39,0.85) 100%)`,
          backdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${darkSurface.border}`,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          // Kill MUI's default dark-mode elevation overlay tint so the custom
          // glass gradient below isn't fought by it.
          backgroundImage: 'none',
        },
        outlined: {
          borderRadius: 12,
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
          border: `1px solid ${darkSurface.border}`,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
          border: `1px solid ${darkSurface.border}`,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          transition: 'border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
        },
        colorPrimary: {
          background: brandGradient,
          color: '#fff',
          border: 'none',
        },
        outlined: {
          borderColor: 'rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.85)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 10,
        },
        containedPrimary: {
          background: brandGradient,
          boxShadow: '0 2px 12px rgba(234,88,12,0.35)',
          '&:hover': {
            background: brandHoverGradient,
            boxShadow: '0 4px 20px rgba(234,88,12,0.45)',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&.Mui-selected': {
            backgroundColor: 'rgba(255,255,255,0.08)',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.10)' },
          },
        },
      },
    },
  },
})
