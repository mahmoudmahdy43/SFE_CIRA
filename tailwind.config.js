/** @type {import('tailwindcss').Config} */
const c = (n) => `hsl(var(--${n}) / <alpha-value>)`
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: c('background'), foreground: c('foreground'),
        card: c('card'), popover: c('popover'), muted: c('muted'),
        'muted-foreground': c('muted-foreground'), border: c('border'), ring: c('ring'),
        accent: c('accent'), 'accent-foreground': c('accent-foreground'),
        primary: c('primary'), 'primary-foreground': c('primary-foreground'),
        success: c('success'), 'success-soft': c('success-soft'),
        warning: c('warning'), 'warning-soft': c('warning-soft'),
        danger: c('danger'), 'danger-soft': c('danger-soft'),
        info: c('info'), 'info-soft': c('info-soft'),
      },
      borderRadius: { card: '10px', control: '8px' },
      fontSize: { 13: ['13px', '18px'], kpi: ['30px', '36px'] },
      boxShadow: { pop: '0 6px 20px -8px rgb(20 34 28 / 0.18)' },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(.97)' }, to: { opacity: '1', transform: 'none' } },
        'slide-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out', 'pop-in': 'pop-in .12s ease-out',
        'slide-left': 'slide-left .2s ease-out',
      },
    },
  },
  plugins: [],
}
