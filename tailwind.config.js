/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: {
          950: '#04060c',
          900: '#070b14',
          850: '#0a101d',
          800: '#0d1424',
          750: '#101930',
          700: '#15203a',
          600: '#1d2b4a',
        },
        ops: {
          cyan: '#38c4e0',
          teal: '#2dd4bf',
          green: '#2fe08a',
          amber: '#e8a13c',
          red: '#ef3d52',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      letterSpacing: {
        widest2: '0.22em',
      },
      keyframes: {
        'soft-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'soft-pulse': 'soft-pulse 2.4s ease-in-out infinite',
        blink: 'blink 1.1s steps(1) infinite',
      },
    },
  },
  plugins: [],
}
