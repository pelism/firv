/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        method: {
          get: '#10b981',    // emerald-500
          post: '#3b82f6',   // blue-500
          put: '#f59e0b',    // amber-500
          patch: '#eab308',  // yellow-500
          delete: '#ef4444', // red-500
          options: '#6366f1',// indigo-500
          default: '#6b7280',// gray-500
        }
      }
    },
  },
  plugins: [],
}
