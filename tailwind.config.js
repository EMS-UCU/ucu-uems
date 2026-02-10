/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '10%': { transform: 'scale(1.1)' },
          '20%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(1.1)' },
          '40%': { transform: 'scale(1)' },
        },
      },
      animation: {
        heartbeat: 'heartbeat 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
