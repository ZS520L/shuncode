import { useMemo } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"

interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}

/**
 * Баннер ошибок чекпоинтов.
 *
 * Бэкенд отправляет i18n-ключ (например "checkpoint.error.slowInit"),
 * фронтенд переводит его через t(). Кнопки определяются по ключу, а не по тексту.
 *
 * Если ключ не найден в словаре — t() вернёт сам ключ (fallback для динамических ошибок).
 */
export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	const { t } = useI18n()

	const messages = useMemo(() => {
		const key = checkpointManagerErrorMessage

		// Переводим ключ через i18n; если ключа нет в словаре — покажется as-is
		const message = key ? t(key) : undefined

		// Показывать кнопку "Отключить чекпоинты" для ошибок инициализации/таймаута
		const showDisableButton =
			key === "checkpoint.error.slowInit" ||
			key === "checkpoint.error.timeout" ||
			key?.includes("multi-root")

		// Показывать ссылку на инструкции по установке git
		const showGitInstructions = key === "checkpoint.error.gitRequired"

		return { message, showDisableButton, showGitInstructions }
	}, [checkpointManagerErrorMessage, t])

	if (!checkpointManagerErrorMessage) {
		return null
	}

	return (
		<div className="flex items-center justify-center w-full">
			<Alert title={messages.message} variant="danger">
				<AlertDescription className="flex gap-2 justify-end">
					{messages.showDisableButton && (
						<Button
							aria-label={t("taskHeader.disableCheckpoints")}
							onClick={handleCheckpointSettingsClick}
							variant="ghost">
							{t("taskHeader.disableCheckpoints")}
						</Button>
					)}
				{messages.showGitInstructions && (
					<a className="text-link underline" href="https://shuncode-ai.ru/ru/docs/checkpoints">
						{t("taskHeader.seeInstructions")}
					</a>
				)}
				</AlertDescription>
			</Alert>
		</div>
	)
}
