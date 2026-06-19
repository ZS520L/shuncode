/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TargetPlatform } from '../../extensions/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { ExtensionSignatureVerificationCode } from '../common/extensionManagement.js';

export const IExtensionSignatureVerificationService = createDecorator<IExtensionSignatureVerificationService>('IExtensionSignatureVerificationService');

export interface IExtensionSignatureVerificationResult {
	readonly code: ExtensionSignatureVerificationCode;
}

/**
 * A service for verifying signed extensions.
 */
export interface IExtensionSignatureVerificationService {
	readonly _serviceBrand: undefined;

	verify(extensionId: string, version: string, vsixFilePath: string, signatureArchiveFilePath: string, clientTargetPlatform?: TargetPlatform): Promise<IExtensionSignatureVerificationResult | undefined>;
}

// --- SHUNCODE_FORK_BEGIN: skip extension signature verification ---
// OSS builds don't have Microsoft's signing key, so verification always fails.
// Return Success to bypass the check in extensionManagementService.downloadExtension(),
// which blocks installation when verificationStatus !== Success.
export class ExtensionSignatureVerificationService implements IExtensionSignatureVerificationService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
	) { }

	public async verify(extensionId: string, _version: string, _vsixFilePath: string, _signatureArchiveFilePath: string, _clientTargetPlatform?: TargetPlatform): Promise<IExtensionSignatureVerificationResult | undefined> {
		this.logService.info(`Extension signature verification skipped (Shuncode OSS build): ${extensionId}`);
		return { code: ExtensionSignatureVerificationCode.Success };
	}
}
// --- SHUNCODE_FORK_END ---
