/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#080808',
          1: '#0f0f0f',
          2: '#161616',
          3: '#1e1e1e',
          4: '#262626',
        },
        border: {
          DEFAULT: '#2a2a2a',
          light: '#383838',
        },
        content: {
          primary: '#f0f0f0',
          secondary: '#a0a0a0',
          muted: '#555555',
        },
        accent: {
          DEFAULT: '#7c3aed',
          hover: '#6d28d9',
          light: '#a78bfa',
          subtle: 'rgba(124,58,237,0.12)',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
