import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"

// Global error handler for debugging black screen crashes
window.onerror = (message, source, lineno, colno, error) => {
	console.error("[FATAL]", message, source, lineno, colno, error)
	const root = document.getElementById("root")
	if (root && !root.querySelector(".fatal-error-overlay")) {
		const overlay = document.createElement("div")
		overlay.className = "fatal-error-overlay"
		overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-errorForeground,#f48771);padding:16px;overflow:auto;font-size:12px;font-family:monospace;white-space:pre-wrap"
		overlay.textContent = `[FATAL ERROR]\n${message}\n\nSource: ${source}:${lineno}:${colno}\n\nStack:\n${error?.stack || "(no stack)"}`
		root.appendChild(overlay)
	}
}

window.addEventListener("unhandledrejection", (event) => {
	console.error("[UNHANDLED PROMISE]", event.reason)
})

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
