import { Logger } from "../services/Logger"
import { ShuncodeStorage } from "./ShuncodeStorage"

export type SecretStores = VSCodeSecretStorage | ShuncodeStorage

/**
 * Wrapper around VSCode Secret Storage or any other storage type for managing secrets.
 */
export class ShuncodeSecretStorage extends ShuncodeStorage {
	override readonly name = "ShuncodeSecretStorage"
	private static store: ShuncodeSecretStorage | null = null
	static get instance(): ShuncodeSecretStorage {
		if (!ShuncodeSecretStorage.store) {
			ShuncodeSecretStorage.store = new ShuncodeSecretStorage()
		}
		return ShuncodeSecretStorage.store
	}

	private secretStorage: SecretStores | null = null

	public get storage(): SecretStores {
		if (!this.secretStorage) {
			throw new Error("[ShuncodeSecretStorage] init not called")
		}
		return this.secretStorage
	}

	public init(store: SecretStores) {
		if (!this.secretStorage) {
			this.secretStorage = store
			Logger.info("[ShuncodeSecretStorage] initialized")
		}
		return this.secretStorage
	}

	protected async _get(key: string): Promise<string | undefined> {
		try {
			return key ? await this.storage.get(key) : undefined
		} catch (error) {
			Logger.error("[ShuncodeSecretStorage]", error)
			return undefined
		}
	}

	/**
	 * [SECURITY] Avoid logging secrets values.
	 */
	protected async _store(key: string, value: string): Promise<void> {
		try {
			if (value && value.length > 0) {
				await this.storage.store(key, value)
			}
		} catch (error) {
			Logger.error("[ShuncodeSecretStorage]", error)
		}
	}

	protected async _delete(key: string): Promise<void> {
		Logger.info("[ShuncodeSecretStorage] deleting secret")
		await this.storage.delete(key)
	}
}

interface VSCodeSecretStorage {
	get(key: string): Thenable<string | undefined>

	store(key: string, value: string): Thenable<void>

	delete(key: string): Thenable<void>

	onDidChange: any
}

/**
 * Singleton instance of ShuncodeSecretStorage
 */
export const secretStorage = ShuncodeSecretStorage.instance
