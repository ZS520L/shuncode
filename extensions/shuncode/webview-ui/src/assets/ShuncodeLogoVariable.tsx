import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
import { getEnvironmentColor } from "../utils/environmentColors"

const ShuncodeLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" viewBox="0 0 29 30" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<path d="M6.3,5.71l2.99,7.27c1.48,1.91,2.97,3.81,4.45,5.72-3.15-1.92-6.3-3.85-9.45-5.77l2-7.22Z" fill={fillColor} />
			<path d="M10.55,13.76c2.87,1.3,5.74,2.61,8.6,3.91-.5.83-.99,1.65-1.49,2.48-1.07-.51-2.15-1.02-3.22-1.52-1.3-1.62-2.6-3.24-3.89-4.86Z" fill={fillColor} />
			<path d="M9.8,12.8c.49-.89.97-1.79,1.46-2.68,4.57,2.25,9.14,4.5,13.71,6.76l-5.29.4-9.87-4.48Z" fill={fillColor} />
			<polygon points="13.73 0 24.96 4.44 6.93 4.47 13.73 0" fill={fillColor} />
			<polygon points="14.17 5 19.7 8.69 24.96 5 14.17 5" fill={fillColor} />
			<path d="M6.61,5h6.79c-1.27,2.32-2.53,4.65-3.8,6.97-1-2.32-2-4.65-3-6.97Z" fill={fillColor} />
			<path d="M22.8,24.67c-.99-2.28-1.97-4.56-2.96-6.84,1.71-.13,3.41-.26,5.12-.39-.72,2.41-1.44,4.82-2.16,7.23Z" fill={fillColor} />
			<path d="M22.08,24.67c-2.15.01-4.3.03-6.46.04,1.28-2.16,2.56-4.32,3.85-6.48l2.61,6.44Z" fill={fillColor} />
			<path d="M9.04,20.9c2,1.26,4.01,2.53,6.01,3.79H4.19c1.62-1.26,3.23-2.53,4.85-3.79Z" fill={fillColor} />
			<path d="M15.47,30c-3.76-1.58-7.52-3.16-11.28-4.73h18.46c-1.25.85-6.07,4.03-7.18,4.73Z" fill={fillColor} />
		</svg>
	)
}
export default ShuncodeLogoVariable
