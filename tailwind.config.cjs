/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ["class"],
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" },
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" },
				},
				"slide-in-right": {
					"0%": { transform: "translateX(10px)", opacity: "0" },
					"100%": { transform: "translateX(0)", opacity: "1" },
				},
				"slide-in-up": {
					"0%": { transform: "translateY(8px)", opacity: "0" },
					"100%": { transform: "translateY(0)", opacity: "1" },
				},
				"check-draw": {
					"0%": { strokeDashoffset: "100" },
					"100%": { strokeDashoffset: "0" },
				},
				"scale-check": {
					"0%": { transform: "scale(0)", opacity: "0" },
					"50%": { transform: "scale(1.2)", opacity: "1" },
					"100%": { transform: "scale(1)", opacity: "1" },
				},
				"progress-fill": {
					"0%": { width: "0%" },
					"100%": { width: "var(--progress-width)" },
				},
				shimmer: {
					"0%": { backgroundPosition: "-200% 0" },
					"100%": { backgroundPosition: "200% 0" },
				},
				celebrate: {
					"0%": { transform: "scale(0) rotate(0deg)", opacity: "0" },
					"50%": { transform: "scale(1.3) rotate(180deg)", opacity: "1" },
					"100%": { transform: "scale(1) rotate(360deg)", opacity: "1" },
				},
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
				"slide-in-right": "slide-in-right 0.2s ease-out",
				"slide-in-up": "slide-in-up 0.2s ease-out",
				"check-draw": "check-draw 0.5s ease-in-out forwards",
				"scale-check": "scale-check 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
				"progress-fill": "progress-fill 0.3s ease-out forwards",
				shimmer: "shimmer 1.5s infinite linear",
				celebrate: "celebrate 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
			colors: {
				brand: {
					violet: "#7c3aed",
					indigo: "#6366f1",
					lavender: "#a78bfa",
					teal: "#2dd4bf",
					red: "#f43f5e",
					dark: "#0a0a0f",
				},
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				chart: {
					1: "hsl(var(--chart-1))",
					2: "hsl(var(--chart-2))",
					3: "hsl(var(--chart-3))",
					4: "hsl(var(--chart-4))",
					5: "hsl(var(--chart-5))",
				},
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
};
