import { EmptyRequest } from "@shared/proto/shuncode/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShuncodeAuth } from "@/context/ShuncodeAuthContext"
import { AccountServiceClient } from "@/services/grpc-client"

export const ShuncodeAccountInfoCard = () => {
	const { shuncodeUser } = useShuncodeAuth()
	const { navigateToAccount } = useExtensionState()
	const [isLoading, setIsLoading] = useState(false)

	const user = shuncodeUser || undefined

	const handleLogin = () => {
		setIsLoading(true)
		AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			.catch((err) => console.error("Failed to get login URL:", err))
			.finally(() => {
				setIsLoading(false)
			})
	}

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				<div>
					<VSCodeButton className="mt-0" disabled={isLoading} onClick={handleLogin}>
						Sign Up with ShunCode
						{isLoading && (
							<span className="ml-1 animate-spin">
								<span className="codicon codicon-refresh"></span>
							</span>
						)}
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}
