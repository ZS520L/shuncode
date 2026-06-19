import { Logger } from "../services/Logger"
import { getStorageAdapter, StorageAdapter } from "./adapters"
import { ShuncodeStorage } from "./ShuncodeStorage"

export interface BlobStoreSettings {
	bucket: string
	adapterType: "s3" | "r2" | string
	accessKeyId: string
	secretAccessKey: string
	region?: string
	endpoint?: string
	accountId?: string

	/** Interval between sync attempts in milliseconds (default: 30000 = 30s) */
	intervalMs?: number
	/** Maximum number of retries before giving up on an item (default: 5) */
	maxRetries?: number
	/** Batch size - how many items to process per interval (default: 10) */
	batchSize?: number
	/** Maximum queue size before eviction (default: 1000) */
	maxQueueSize?: number
	/** Maximum age for failed items in milliseconds (default: 7 days) */
	maxFailedAgeMs?: number
	/** Whether to backfill existing unsynced items on startup (default: false) */
	backfillEnabled?: boolean
}

/**
 * S3/R2 blob storage implementation of ShuncodeStorage.
 * Uses AWS S3 or Cloudflare R2 as the backend storage.
 */
export class ShuncodeBlobStorage extends ShuncodeStorage {
	override name = "ShuncodeBlobStorage"

	private static store: ShuncodeBlobStorage | null = null
	static get instance(): ShuncodeBlobStorage {
		if (!ShuncodeBlobStorage.store) {
			ShuncodeBlobStorage.store = new ShuncodeBlobStorage()
		}
		return ShuncodeBlobStorage.store
	}

	private adapter: StorageAdapter | undefined
	private settings: BlobStoreSettings | undefined
	private initialized = false

	/**
	 * Initialize the storage adapter with the given settings.
	 * Can be called multiple times - will reinitialize if settings change.
	 */
	public init(settings?: BlobStoreSettings) {
		if (!settings) {
			return
		}

		// Check if settings have changed (compare key fields)
		const settingsChanged =
			!this.settings ||
			this.settings.adapterType !== settings.adapterType ||
			this.settings.bucket !== settings.bucket ||
			this.settings.accessKeyId !== settings.accessKeyId ||
			this.settings.endpoint !== settings.endpoint ||
			this.settings.accountId !== settings.accountId

		// Skip if already initialized with same settings
		if (this.initialized && !settingsChanged) {
			return
		}

		try {
			if (!ShuncodeBlobStorage.isConfigured(settings)) {
				// Not configured - this is expected and not an error
				return
			}

			const adapter = getStorageAdapter(settings)
			if (adapter) {
				this.adapter = adapter
				this.settings = settings
				this.initialized = true
				Logger.log("[ShuncodeBlobStorage] Adapter created")
			}
		} catch (error) {
			// Log but don't throw - allow startup to continue
			Logger.error("[ShuncodeBlobStorage] initialization failed:", error)
		}
	}

	/**
	 * Check if the storage is properly initialized and ready to use.
	 */
	public isReady(): boolean {
		return this.initialized && this.adapter !== undefined
	}

	public static isConfigured(settings: BlobStoreSettings): boolean {
		const adapter = settings.adapterType
		if (adapter !== "s3" && adapter !== "r2") {
			return false
		}

		const hasRequiredVars = !!settings.bucket && !!settings.accessKeyId && !!settings.secretAccessKey

		if (adapter === "r2") {
			return hasRequiredVars && !!settings.accountId
		}

		return hasRequiredVars
	}

	protected async _get(key: string): Promise<string | undefined> {
		if (!this.isReady()) {
			return undefined
		}
		try {
			return await this.adapter!.read(key)
		} catch (error) {
			Logger.error(`[ShuncodeBlobStorage] failed to get '${key}':`, error)
			return undefined
		}
	}

	protected async _store(key: string, value: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		try {
			await this.adapter!.write(key, value)
		} catch (error) {
			Logger.error(`[ShuncodeBlobStorage] failed to store '${key}':`, error)
			throw error
		}
	}

	protected async _delete(key: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		try {
			await this.adapter!.remove(key)
		} catch (error) {
			Logger.error(`[ShuncodeBlobStorage] failed to delete '${key}':`, error)
			throw error
		}
	}
}

/**
 * Get the blob storage instance if S3/R2 storage is configured.
 * Returns null if not configured.
 */
export const blobStorage = ShuncodeBlobStorage.instance
