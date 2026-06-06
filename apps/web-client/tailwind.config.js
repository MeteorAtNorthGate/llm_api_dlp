import { lightTheme, darkTheme } from './src/styles/colors.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Convenience aliases for use in arbitrary values / custom CSS
        // (daisyUI semantic classes like bg-primary, text-base-content
        //  are preferred in components)
        brand: {
          primary:  'oklch(var(--p))',
          secondary:'oklch(var(--s))',
          accent:   'oklch(var(--a))',
          neutral:  'oklch(var(--n))',
          surface:  'oklch(var(--b1))',
          card:     'oklch(var(--b2))',
          border:   'oklch(var(--b3))',
          text:     'oklch(var(--bc))',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography'), require('daisyui')],
  daisyui: {
    themes: [
      {
        // Custom theme — edit src/styles/colors.js to change
        llm: lightTheme,
      },
      {
        // Dark variant — edit src/styles/colors.js to change
        llmDark: darkTheme,
      },
      'corporate',
    ],
  },
};
