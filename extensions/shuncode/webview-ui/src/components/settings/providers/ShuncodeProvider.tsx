import { Mode } from "@shared/storage/types"
import OpenRouterModelPicker from "../OpenRouterModelPicker"
import { ShuncodeAccountInfoCard } from "../ShuncodeAccountInfoCard"

/**
 * Props for the ShuncodeProvider component
 */
interface ShuncodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Shuncode provider configuration component
 */
export const ShuncodeProvider = ({ showModelOptions, isPopup, currentMode }: ShuncodeProviderProps) => {
	return (
		<div>
			{/* Shuncode Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ShuncodeAccountInfoCard />
			</div>

			{showModelOptions && (
				<>
					{/* OpenRouter Model Picker - includes Provider Routing in Advanced section */}
					<OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />
				</>
			)}
		</div>
	)
}
