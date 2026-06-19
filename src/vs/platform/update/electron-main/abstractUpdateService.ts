/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { IntervalTimer, timeout } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import * as semver from '../../../base/common/semver/semver.js';
import { getWindowsReleaseSync } from '../../../base/node/windowsVersion.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { AvailableForDownload, DisablementReason, IUpdate, IUpdateService, State, StateType, UpdateType } from '../common/update.js';

export interface IUpdateURLOptions {
	readonly background?: boolean;
	readonly internalOrg?: string;
}

export function createUpdateURL(baseUpdateUrl: string, platform: string, quality: string, commit: string, options?: IUpdateURLOptions): string {
	const url = new URL(`${baseUpdateUrl}/api/update/${platform}/${quality}/${commit}`);

	if (options?.background) {
		url.searchParams.set('bg', 'true');
	}

	url.searchParams.set('u', options?.internalOrg ?? 'none');

	return url.toString();
}

/**
 * Builds common headers for update requests, including those issued
 * via Electron's auto-updater (e.g. setFeedURL({ url, headers })) and
 * manual HTTP requests that bypass the auto-updater. The headers include
 * OS version information which the update server uses for EOL detection.
 *
 * On macOS, the User-Agent includes the Darwin kernel version.
 * On Windows, the User-Agent includes accurate Windows version from the registry.
 */
export function getUpdateRequestHeaders(productVersion: string): Record<string, string> | undefined {
	if (isMacintosh) {
		const darwinVersion = os.release();
		return {
			'User-Agent': `Code/${productVersion} Darwin/${darwinVersion}`
		};
	}

	if (isWindows) {
		const match = getWindowsReleaseSync().match(/^(\d+\.\d+)/);
		if (match) {
			return {
				'User-Agent': `Code/${productVersion} Electron/${process.versions.electron} Windows NT ${match[1]}`
			};
		}
	}

	return undefined;
}

interface IGitHubReleaseAsset {
	readonly name: string;
	readonly browser_download_url?: string;
	readonly digest?: string;
}

interface IGitHubRelease {
	readonly tag_name: string;
	readonly name?: string;
	readonly draft?: boolean;
	readonly prerelease?: boolean;
	readonly published_at?: string;
	readonly assets?: IGitHubReleaseAsset[];
}

export type UpdateErrorClassification = {
	owner: 'joaomoreno';
	messageHash: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The hash of the error message.' };
	comment: 'This is used to know how often VS Code updates have failed.';
};

export abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	protected quality: string | undefined;

	private _state: State = State.Uninitialized;
	protected _overwrite: boolean = false;
	private _hasCheckedForOverwriteOnQuit: boolean = false;
	private readonly overwriteUpdatesCheckInterval = new IntervalTimer();
	private _internalOrg: string | undefined = undefined;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	get state(): State {
		return this._state;
	}

	protected setState(state: State): void {
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);

		// Schedule 5-minute checks when in Ready state and overwrite is supported
		if (this.supportsUpdateOverwrite) {
			if (state.type === StateType.Ready) {
				this.overwriteUpdatesCheckInterval.cancelAndSet(() => this.checkForOverwriteUpdates(), 5 * 60 * 1000);
			} else {
				this.overwriteUpdatesCheckInterval.cancel();
			}
		}
	}

	constructor(
		@ILifecycleMainService protected readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IEnvironmentMainService protected environmentMainService: IEnvironmentMainService,
		@IRequestService protected requestService: IRequestService,
		@ILogService protected logService: ILogService,
		@IProductService protected readonly productService: IProductService,
		@IMeteredConnectionService protected readonly meteredConnectionService: IMeteredConnectionService,
		protected readonly supportsUpdateOverwrite: boolean,
	) {
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => this.initialize());
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	 */
	protected async initialize(): Promise<void> {
		if (!this.environmentMainService.isBuilt) {
			this.setState(State.Disabled(DisablementReason.NotBuilt));
			return; // updates are never enabled when running out of sources
		}

		if (this.environmentMainService.disableUpdates) {
			this.setState(State.Disabled(DisablementReason.DisabledByEnvironment));
			this.logService.info('update#ctor - updates are disabled by the environment');
			return;
		}

		if ((!this.productService.updateUrl || !this.productService.commit) && !this.hasGitHubUpdateConfiguration()) {
			this.setState(State.Disabled(DisablementReason.MissingConfiguration));
			this.logService.info('update#ctor - updates are disabled as there is no update URL or GitHub update configuration');
			return;
		}

		const updateMode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');
		const quality = this.getProductQuality(updateMode);

		if (!quality) {
			this.setState(State.Disabled(DisablementReason.ManuallyDisabled));
			this.logService.info('update#ctor - updates are disabled by user preference');
			return;
		}

		if (this.productService.updateUrl && this.productService.commit && !this.buildUpdateFeedUrl(quality, this.productService.commit!)) {
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.info('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}

		this.quality = quality;

		this.setState(State.Idle(this.getUpdateType()));

		await this.postInitialize();

		if (updateMode === 'manual') {
			this.logService.info('update#ctor - manual checks only; automatic updates are disabled by user preference');
			return;
		}

		if (updateMode === 'start') {
			this.logService.info('update#ctor - startup checks only; automatic updates are disabled by user preference');

			// Check for updates only once after 30 seconds
			setTimeout(() => this.checkForUpdates(false), 30 * 1000);
		} else {
			// Start checking for updates after 30 seconds
			this.scheduleCheckForUpdates(30 * 1000).then(undefined, err => this.logService.error(err));
		}
	}

	private getProductQuality(updateMode: string): string | undefined {
		return updateMode === 'none' ? undefined : this.productService.quality;
	}

	private scheduleCheckForUpdates(delay = 60 * 60 * 1000): Promise<void> {
		return timeout(delay)
			.then(() => this.checkForUpdates(false))
			.then(() => {
				// Check again after 1 hour
				return this.scheduleCheckForUpdates(60 * 60 * 1000);
			});
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.doCheckForUpdates(explicit);
	}

	async downloadUpdate(explicit: boolean): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		if (!explicit && this.meteredConnectionService.isConnectionMetered) {
			this.logService.info('update#downloadUpdate - skipping download because connection is metered');
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// noop
	}

	async applyUpdate(): Promise<void> {
		this.logService.trace('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	protected async doApplyUpdate(): Promise<void> {
		// noop
	}

	async quitAndInstall(): Promise<void> {
		this.logService.trace('update#quitAndInstall, state = ', this.state.type);

		if (this.state.type !== StateType.Ready) {
			return undefined;
		}

		if (this.supportsUpdateOverwrite && !this._hasCheckedForOverwriteOnQuit) {
			this._hasCheckedForOverwriteOnQuit = true;
			const didOverwrite = await this.checkForOverwriteUpdates(true);

			if (didOverwrite) {
				this.logService.info('update#quitAndInstall(): overwrite update detected, postponing quitAndInstall');
				return;
			}
		}

		this.logService.trace('update#quitAndInstall(): before lifecycle quit()');

		this.lifecycleMainService.quit(true /* will restart */).then(vetod => {
			this.logService.trace(`update#quitAndInstall(): after lifecycle quit() with veto: ${vetod}`);
			if (vetod) {
				return;
			}

			this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
			this.doQuitAndInstall();
		});

		return Promise.resolve(undefined);
	}

	private async checkForOverwriteUpdates(explicit: boolean = false): Promise<boolean> {
		if (this._state.type !== StateType.Ready) {
			return false;
		}

		const pendingUpdateCommit = this._state.update.version;

		let isLatest: boolean | undefined;

		try {
			const cts = new CancellationTokenSource();
			const timeoutPromise = timeout(2000).then(() => { cts.cancel(); return undefined; });
			isLatest = await Promise.race([this.isLatestVersion(pendingUpdateCommit, cts.token), timeoutPromise]);
			cts.dispose();
		} catch (error) {
			this.logService.warn('update#checkForOverwriteUpdates(): failed to check for updates, proceeding with restart');
			this.logService.warn(error);
			return false;
		}

		if (isLatest === false && this._state.type === StateType.Ready) {
			this.logService.info('update#readyStateCheck: newer update available, restarting update machinery');

			try {
				await this.cancelPendingUpdate();
			} catch (error) {
				this.logService.error('update#checkForOverwriteUpdates(): failed to cancel pending update, aborting overwrite');
				this.logService.error(error);
				return false;
			}

			this._overwrite = true;
			this.setState(State.Overwriting(this._state.update, explicit));
			this.doCheckForUpdates(explicit, pendingUpdateCommit);
			return true;
		}

		return false;
	}

	async isLatestVersion(commit?: string, token: CancellationToken = CancellationToken.None): Promise<boolean | undefined> {
		if (!this.quality) {
			return undefined;
		}

		const mode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');

		if (mode === 'none') {
			return undefined;
		}

		if (this.hasGitHubUpdateConfiguration()) {
			try {
				const update = await this.getGitHubReleaseUpdate(this.getGitHubUpdatePlatform(), token);
				return !update || update.version === commit;
			} catch (error) {
				this.logService.error('update#isLatestVersion(): failed to check GitHub Releases for updates');
				this.logService.error(error);
				return undefined;
			}
		}

		const url = this.buildUpdateFeedUrl(this.quality, commit ?? this.productService.commit!);

		if (!url) {
			return undefined;
		}

		const headers = getUpdateRequestHeaders(this.productService.version);
		this.logService.trace('update#isLatestVersion() - checking update server', { url, headers });

		try {
			const context = await this.requestService.request({ url, headers }, token);
			const statusCode = context.res.statusCode;
			this.logService.trace('update#isLatestVersion() - response', { statusCode });
			// The update server replies with 204 (No Content) when no
			// update is available - that's all we want to know.
			return statusCode === 204;

		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check for updates');
			this.logService.error(error);
			return undefined;
		}
	}

	async _applySpecificUpdate(packagePath: string): Promise<void> {
		// noop
	}

	async setInternalOrg(internalOrg: string | undefined): Promise<void> {
		if (this._internalOrg === internalOrg) {
			return;
		}

		this.logService.info('update#setInternalOrg', internalOrg);
		this._internalOrg = internalOrg;
	}

	protected getInternalOrg(): string | undefined {
		return this._internalOrg;
	}

	protected getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

	protected getGitHubUpdatePlatform(): string {
		return process.platform === 'win32' ? `win32-${process.arch}` : `${process.platform}-${process.arch}`;
	}

	protected hasGitHubUpdateConfiguration(): boolean {
		const githubUpdate = this.productService.githubUpdate;
		return !!githubUpdate?.owner && !!githubUpdate.repo;
	}

	protected async getGitHubReleaseUpdate(platform: string, token: CancellationToken = CancellationToken.None): Promise<IUpdate | null> {
		const githubUpdate = this.productService.githubUpdate;
		if (!githubUpdate?.owner || !githubUpdate.repo) {
			return null;
		}

		const apiBaseUrl = githubUpdate.apiUrl ?? 'https://api.github.com';
		const releasesUrl = `${apiBaseUrl.replace(/\/$/, '')}/repos/${encodeURIComponent(githubUpdate.owner)}/${encodeURIComponent(githubUpdate.repo)}/releases`;
		const url = githubUpdate.includePrereleases ? `${releasesUrl}?per_page=10` : `${releasesUrl}/latest`;
		const headers = {
			'Accept': 'application/vnd.github+json',
			'User-Agent': `${this.productService.applicationName}/${this.productService.version}`
		};

		this.logService.trace('update#getGitHubReleaseUpdate - checking GitHub Releases', { url, platform });

		const context = await this.requestService.request({ url, headers }, token);
		const response = await asJson<IGitHubRelease | IGitHubRelease[]>(context);
		const release = Array.isArray(response) ? response.find(candidate => !candidate.draft) : response;

		if (!release?.tag_name || release.draft) {
			return null;
		}

		const releaseVersion = this.normalizeVersion(release.tag_name);
		const currentVersion = this.normalizeVersion(this.productService.version);
		if (!releaseVersion || !currentVersion || !semver.gt(releaseVersion, currentVersion)) {
			return null;
		}

		const asset = this.selectGitHubReleaseAsset(release.assets ?? [], platform);
		if (!asset?.browser_download_url) {
			this.logService.warn('update#getGitHubReleaseUpdate - no matching GitHub release asset found', { platform, release: release.tag_name });
			return null;
		}

		const sha256hash = asset.digest?.startsWith('sha256:') ? asset.digest.substring('sha256:'.length) : undefined;
		return {
			version: release.tag_name,
			productVersion: releaseVersion,
			timestamp: release.published_at ? Date.parse(release.published_at) || undefined : undefined,
			url: asset.browser_download_url,
			sha256hash
		};
	}

	private normalizeVersion(version: string): string | undefined {
		return semver.valid(version) ?? semver.valid(version.replace(/^v/i, '')) ?? semver.coerce(version)?.version;
	}

	private selectGitHubReleaseAsset(assets: readonly IGitHubReleaseAsset[], platform: string): IGitHubReleaseAsset | undefined {
		const configuredPatterns = this.productService.githubUpdate?.assetNamePatterns;
		const patterns = configuredPatterns?.[platform] ?? configuredPatterns?.default ?? this.getDefaultGitHubAssetNamePatterns(platform);
		return assets.find(asset => patterns.some(pattern => this.matchesAssetPattern(asset.name, pattern)));
	}

	private getDefaultGitHubAssetNamePatterns(platform: string): readonly string[] {
		if (platform.startsWith('win32-') && platform.endsWith('-archive')) {
			return ['*.zip'];
		}
		if (platform.startsWith('win32-')) {
			return ['*.exe'];
		}
		if (platform.startsWith('linux-')) {
			return ['*.deb', '*.rpm', '*.tar.gz', '*.AppImage'];
		}
		if (platform.startsWith('darwin')) {
			return ['*.zip', '*.dmg'];
		}
		return ['*'];
	}

	private matchesAssetPattern(assetName: string, pattern: string): boolean {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
		return new RegExp(`^${escaped}$`, 'i').test(assetName);
	}

	protected doQuitAndInstall(): void {
		// noop
	}

	protected async postInitialize(): Promise<void> {
		// noop
	}

	protected async cancelPendingUpdate(): Promise<void> {
		// noop
	}

	protected abstract buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string | undefined;
	protected abstract doCheckForUpdates(explicit: boolean, pendingCommit?: string): void;
}
