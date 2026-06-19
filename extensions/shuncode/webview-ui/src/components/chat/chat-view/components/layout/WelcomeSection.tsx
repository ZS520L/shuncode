import { EmptyRequest } from "@shared/proto/shuncode/common"
import type { Worktree } from "@shared/proto/shuncode/worktree"
import { TrackWorktreeViewOpenedRequest } from "@shared/proto/shuncode/worktree"
import { BANNER_DATA, BannerAction, BannerActionType, BannerCardData } from "@shared/shuncode/banner"
import { GitBranch } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import BannerCarousel from "@/components/common/BannerCarousel"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import CreateWorktreeModal from "@/components/worktrees/CreateWorktreeModal"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShuncodeAuth } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { AccountServiceClient, StateServiceClient, UiServiceClient, WorktreeServiceClient } from "@/services/grpc-client"
import { convertBannerData } from "@/utils/bannerUtils"
import { getCurrentPlatform } from "@/utils/platformUtils"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome section shown when there's no active task
 * Includes info banner, announcements, home header, and history preview
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
	showAnnouncement,
	hideAnnouncement,
	showHistoryView,
	version,
	taskHistory,
	shouldShowQuickWins,
}) => {
	const { t } = useI18n()
	const { lastDismissedInfoBannerVersion, lastDismissedCliBannerVersion, lastDismissedModelBannerVersion } = useExtensionState()

	// Quick launch worktree modal
	const [showCreateWorktreeModal, setShowCreateWorktreeModal] = useState(false)
	const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
	const [currentWorktree, setCurrentWorktree] = useState<Worktree | null>(null)

	// Check if we're in a git repo and get current worktree info on mount
	useEffect(() => {
		WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			.then((result) => {
				const canUseWorktrees = result.isGitRepo && !result.isMultiRoot && !result.isSubfolder
				setIsGitRepo(canUseWorktrees)
				if (canUseWorktrees) {
					const current = result.worktrees.find((w) => w.isCurrent)
					setCurrentWorktree(current || null)
				}
			})
			.catch(() => setIsGitRepo(false))
	}, [])

	const { shuncodeUser } = useShuncodeAuth()
	const {
		openRouterModels,
		setShowChatModelSelector,
		navigateToSettings,
		navigateToWorktrees,
		navigateToAccount,
		subagentsEnabled,
		worktreesEnabled,
		banners,
		freeRequestLimit,
	} = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	// Handle click on home page worktree element with telemetry
	const handleWorktreeClick = useCallback(() => {
		WorktreeServiceClient.trackWorktreeViewOpened(TrackWorktreeViewOpenedRequest.create({ source: "home_page" })).catch(
			console.error,
		)
		navigateToWorktrees()
	}, [navigateToWorktrees])

	/**
	 * Check if a banner has been dismissed based on its version
	 */
	const isBannerDismissed = useCallback(
		(bannerId: string): boolean => {
			// !! Do not keep tracking the banner versions like this. !!
			if (bannerId.startsWith("info-banner")) {
				return (lastDismissedInfoBannerVersion ?? 0) >= 1
			}
			if (bannerId.startsWith("new-model")) {
				return (lastDismissedModelBannerVersion ?? 0) >= 1
			}
			if (bannerId.startsWith("cli-")) {
				return (lastDismissedCliBannerVersion ?? 0) >= 1
			}
			return false
		},
		[lastDismissedInfoBannerVersion, lastDismissedModelBannerVersion, lastDismissedCliBannerVersion],
	)

	/**
	 * Banner configuration: local tips + remote (from BannerService API).
	 * BANNER_DATA is kept empty — local tips are built here with t().
	 */
	const bannerConfig = useMemo((): BannerCardData[] => {
		const localBanners: BannerCardData[] = [
			...BANNER_DATA,
		]

		return localBanners.filter((banner) => {
			if (isBannerDismissed(banner.id)) {
				return false
			}

			if (banner.isShuncodeUserOnly !== undefined) {
				return banner.isShuncodeUserOnly === !!shuncodeUser
			}

			if (banner.platforms && !banner.platforms.includes(getCurrentPlatform())) {
				return false
			}

			return true
		})
	}, [isBannerDismissed, shuncodeUser, t])

	/**
	 * Action handler - maps action types to actual implementations
	 */
	const handleBannerAction = useCallback(
		(action: BannerAction) => {
			switch (action.action) {
				case BannerActionType.Link:
					if (action.arg) {
						UiServiceClient.openUrl({ value: action.arg }).catch(console.error)
					}
					break

				case BannerActionType.SetModel: {
					const modelId = action.arg || "anthropic/claude-opus-4.5"
					handleFieldsChange({
						planModeOpenRouterModelId: modelId,
						actModeOpenRouterModelId: modelId,
						planModeOpenRouterModelInfo: openRouterModels[modelId],
						actModeOpenRouterModelInfo: openRouterModels[modelId],
						planModeApiProvider: "shuncode",
						actModeApiProvider: "shuncode",
					})
					setTimeout(() => setShowChatModelSelector(true), 10)
					break
				}

				case BannerActionType.ShowAccount:
					AccountServiceClient.accountLoginClicked({}).catch((err) => console.error("Failed to get login URL:", err))
					break

			case BannerActionType.ShowApiSettings:
				navigateToSettings("providers")
				break

			case BannerActionType.ShowFeatureSettings:
				navigateToSettings("permissions")
				break

				case BannerActionType.InstallCli:
					StateServiceClient.installShuncodeCli({}).catch((error) =>
						console.error("Failed to initiate CLI installation:", error),
					)
					break

				default:
					console.warn("Unknown banner action:", action.action)
			}
		},
		[handleFieldsChange, openRouterModels, setShowChatModelSelector, navigateToSettings],
	)

	/**
	 * Dismissal handler - updates version tracking
	 */
	const handleBannerDismiss = useCallback((bannerId: string) => {
		// !! Do not continue use these version numbers or add new banners that don't have unique IDs. !!
		// Banner versions are **deprecated**. Going forward, we are tracking which banners have
		// been dismissed using the **banner ID**.
		if (bannerId.startsWith("info-banner")) {
			StateServiceClient.updateInfoBannerVersion({ value: 1 }).catch(console.error)
		} else if (bannerId.startsWith("new-model")) {
			StateServiceClient.updateModelBannerVersion({ value: 1 }).catch(console.error)
		} else if (bannerId.startsWith("cli-")) {
			StateServiceClient.updateCliBannerVersion({ value: 1 }).catch(console.error)
		} else {
			// Mark the banner as dismissed by its ID.
			StateServiceClient.dismissBanner({ value: bannerId }).catch(console.error)
		}
	}, [])

	/**
	 * Build array of active banners for carousel
	 * Combines hardcoded banners (bannerConfig) with dynamic banners from extension state
	 */
	const activeBanners = useMemo(() => {
		// Start with the hardcoded banners (bannerConfig)
		const hardcodedBanners = bannerConfig.map((banner) =>
			convertBannerData(banner, {
				onAction: handleBannerAction,
				onDismiss: handleBannerDismiss,
			}),
		)

		// Add banners from extension state (exclude modal-only banners — those are shown as a dialog)
		const extensionStateBanners = (banners ?? [])
			.filter((b) => b.placement !== "modal")
			.map((banner) =>
				convertBannerData(banner, {
					onAction: handleBannerAction,
					onDismiss: handleBannerDismiss,
				}),
			)

		// Combine both sources: extension state banners first, then hardcoded banners
		return [...extensionStateBanners, ...hardcodedBanners]
	}, [bannerConfig, banners, shuncodeUser, subagentsEnabled, handleBannerAction, handleBannerDismiss])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{/* Welcome banner — always visible */}
				<div className="mx-5 mb-3 p-4 rounded-lg border border-[var(--vscode-editorWidget-border,rgba(127,127,127,0.2))] bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))]">
					<p className="m-0 text-sm leading-6 whitespace-pre-line break-words text-[var(--vscode-foreground)]">
						{t("welcome.intro")}
					</p>
				</div>
				<BannerCarousel banners={activeBanners} />
				{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
				{/* Quick launch worktree button */}
				{isGitRepo && worktreesEnabled?.featureFlag && worktreesEnabled?.user && (
					<div className="flex flex-col items-center gap-3 mt-2 mb-4 px-5">
						{currentWorktree && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										className="flex flex-col items-center gap-0.5 text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer bg-transparent border-none p-1 rounded"
										onClick={handleWorktreeClick}
										type="button">
										<div className="flex items-center gap-1.5 text-xs">
											<GitBranch className="w-3 h-3 stroke-[2.5] flex-shrink-0" />
											<span className="break-all text-center">
												<span className="font-semibold">{t("chat.current")}:</span>{" "}
												{currentWorktree.branch || t("chat.detachedHead")}
											</span>
										</div>
										<span className="break-all text-center max-w-[300px]">
											{currentWorktree.path}
										</span>
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">{t("chat.viewManageWorktreesHint")}</TooltipContent>
							</Tooltip>
						)}
					</div>
				)}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />

			{/* Quick launch worktree modal */}
			<CreateWorktreeModal
				onClose={() => setShowCreateWorktreeModal(false)}
				open={showCreateWorktreeModal}
				openAfterCreate={true}
			/>
		</div>
	)
}
