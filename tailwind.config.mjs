/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        primary: 'var(--text)',
        secondary: 'var(--text-secondary)',
      },
      backgroundColor: {
        primary: 'var(--bg)',
        secondary: 'var(--surface)',
        tertiary: 'var(--surface-2)',
      },
    },
  },
  plugins: [],
}
