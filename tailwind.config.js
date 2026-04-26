/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zinc: {
          950: '#09090b',
        },
        method: {
          get: '#3b82f6',    // Changed to blue for modern feel
          post: '#10b981',   // Changed to emerald
          put: '#f59e0b',    // amber-500
          patch: '#eab308',  // yellow-500
          delete: '#ef4444', // red-500
          options: '#6366f1',// indigo-500
          default: '#6b7280',// gray-500
        }
      },
      borderRadius: {
        'xl': '12px',
      },
      backdropBlur: {
        'xs': '2px',
      }
    },
  },
  plugins: [],
}
