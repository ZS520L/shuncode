import { isShuncodeInternalTester } from "@shared/internal/account"
import type { UserOrganization } from "@shared/proto/shuncode/account"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { handleSignOut, type ShuncodeUser } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { getShuncodeEnvironmentClassname } from "@/utils/environmentColors"
import { updateSetting } from "../settings/utils/settingsHandlers"
import { AccountWelcomeView } from "./AccountWelcomeView"

type AccountViewProps = {
	shuncodeUser: ShuncodeUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	onDone: () => void
}

type ShuncodeAccountViewProps = {
	shuncodeUser: ShuncodeUser
	shuncodeEnv: "Production" | "Staging" | "Local"
}

const ShuncodeEnvOptions = ["Production", "Staging", "Local"] as const

const AccountView = ({ onDone, shuncodeUser, organizations, activeOrganization }: AccountViewProps) => {
	const { t } = useI18n()
	const { environment } = useExtensionState()
	const titleColor = getShuncodeEnvironmentClassname(environment)

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className={cn("text-(--vscode-foreground) m-0", titleColor)}>
					{t("account.account")} {environment !== "production" ? ` - ${environment} ${t("account.environment")}` : ""}
				</h3>
				<VSCodeButton onClick={onDone}>{t("account.done")}</VSCodeButton>
			</div>
			<div className="grow overflow-hidden pr-[8px] flex flex-col">
				<div className="h-full mb-1.5">
					{shuncodeUser?.uid ? (
						<ShuncodeAccountView
							key={shuncodeUser.uid}
							shuncodeEnv={environment === "local" ? "Local" : environment === "staging" ? "Staging" : "Production"}
							shuncodeUser={shuncodeUser}
						/>
					) : (
						<AccountWelcomeView />
					)}
				</div>
			</div>
		</div>
	)
}

export const ShuncodeAccountView = ({ shuncodeUser, shuncodeEnv }: ShuncodeAccountViewProps) => {
	const { t } = useI18n()
	const { email, displayName } = shuncodeUser

	const isShuncodeTester = useMemo(() => (email ? isShuncodeInternalTester(email) : false), [email])

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col pr-3 h-full">
				<div className="flex flex-col w-full gap-1 mb-6">
					<div className="flex items-center flex-wrap gap-y-4">
						<div className="size-16 rounded-full bg-button-background flex items-center justify-center text-2xl text-button-foreground mr-4">
							{displayName?.[0] || email?.[0] || "?"}
						</div>

						<div className="flex flex-col">
							{displayName && <h2 className="text-foreground m-0 text-lg font-medium">{displayName}</h2>}
							{email && <div className="text-sm text-description">{email}</div>}
						</div>
					</div>
				</div>

				{/* Support / Donate */}
				<div className="w-full mt-4 rounded-lg bg-gradient-to-r from-[#2b5ea7] to-[#6b4fbb] p-4 shadow-md">
					<div className="flex flex-col items-center gap-1.5 mb-3">
						<div className="flex items-center gap-2 text-white">
							<span className="codicon codicon-heart-filled text-base" />
							<span className="text-[15px] font-semibold tracking-wide">{t("account.sayThanks")}</span>
						</div>
						<span className="text-[11px] text-white opacity-80 font-normal">{t("account.sayThanksSubtitle")}</span>
					</div>

					<div className="flex gap-2 w-full mb-2">
						{[300, 500, 1000, 5000].map((sum) => (
							<a
								key={sum}
								href={`https://yoomoney.ru/quickpay/confirm?receiver=4100117726681107&sum=${sum}&quickpay-form=donate&targets=${encodeURIComponent("Поддержка ShunCode AI")}`}
								target="_blank"
								rel="noopener noreferrer"
								style={{ textDecoration: "none" }}
								className="flex-1">
								<div className="w-full py-2 rounded-md bg-white/20 hover:bg-white/30 text-white text-sm font-semibold text-center cursor-pointer transition-colors">
									{sum} ₽
								</div>
							</a>
						))}
					</div>

					<a
						href="https://boosty.to/shuncodeai"
						target="_blank"
						rel="noopener noreferrer"
						style={{ textDecoration: "none" }}
						className="block">
						<div className="text-[11px] text-white/60 hover:text-white/90 text-center cursor-pointer transition-colors mt-1">
							{t("account.orViaBoosty")}
						</div>
					</a>
				</div>

				<div className="w-full flex gap-2 flex-col min-[225px]:flex-row mt-3">
					<VSCodeButton appearance="secondary" className="w-full" onClick={() => handleSignOut()}>
						{t("account.logOut")}
					</VSCodeButton>
				</div>

				{isShuncodeTester && (
					<div className="w-full gap-1 items-end mt-6">
						<div className="text-sm font-semibold">{t("account.shuncodeEnvironment")}</div>
						<VSCodeDropdown
							className="w-full mt-1"
							currentValue={shuncodeEnv}
							onChange={async (e) => {
								const target = e.target as HTMLSelectElement
								if (target?.value) {
									const value = target.value as "Local" | "Staging" | "Production"
									updateSetting("shuncodeEnv", value.toLowerCase())
								}
							}}>
							{ShuncodeEnvOptions.map((env) => (
								<VSCodeOption key={env} value={env}>
									{env}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(AccountView)
