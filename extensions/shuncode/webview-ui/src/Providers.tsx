import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"
import { ShuncodeAuthProvider } from "./context/ShuncodeAuthContext"
import { I18nProvider } from "./i18n"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<I18nProvider>
					<CustomPostHogProvider>
						<ShuncodeAuthProvider>
							<HeroUIProvider>{children}</HeroUIProvider>
						</ShuncodeAuthProvider>
					</CustomPostHogProvider>
				</I18nProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
