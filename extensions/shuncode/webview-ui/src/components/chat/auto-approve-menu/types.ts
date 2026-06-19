import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications"
	/** i18n key for the label */
	labelKey: string
	/** i18n key for the short name */
	shortNameKey: string
	icon: string
	subAction?: ActionMetadata
	sub?: boolean
	parentActionId?: string
}
