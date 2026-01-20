import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        hackclub: {
          red: '#ec3750',
          orange: '#ff8c37',
          yellow: '#f1c40f',
          green: '#33d6a6',
          cyan: '#5bc0de',
          blue: '#338eda',
          purple: '#a633d6',
          muted: '#8492a6',
          dark: '#17171d',
          darker: '#0e0e10',
          light: '#ffffff',
          smoke: '#f9fafc',
          snow: '#ffffff',
          slate: '#3c4858',
        },
      },
      fontFamily: {
        sans: ['Phantom Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
