import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"

export function RemotelyConfiguredInputWrapper({ hidden, children }: React.PropsWithChildren<{ hidden: boolean }>) {
	const { t } = useI18n()
	return (
		<Tooltip>
			<TooltipContent hidden={hidden}>{t("provider.settingManagedByOrg")}</TooltipContent>
			<TooltipTrigger>{children}</TooltipTrigger>
		</Tooltip>
	)
}

export const LockIcon = () => <i className="codicon codicon-lock text-description text-sm" />
