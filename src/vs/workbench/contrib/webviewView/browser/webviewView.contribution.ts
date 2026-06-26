/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWebviewViewService, WebviewViewService } from './webviewViewService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';

registerSingleton(IWebviewViewService, WebviewViewService, InstantiationType.Delayed);

// --- SHUNCODE: command to update session tabs in native title bar ---
// Uses lazy import to avoid circular dependency and ensure command is registered early
CommandsRegistry.registerCommand('shuncode.internal.updateSessionTabs', async (_accessor, args: { tabs: Array<{ id: string; title: string; state?: string }>; currentId?: string }) => {
	const { WebviewViewPane } = await import('./webviewViewPane.js');
	WebviewViewPane.updateShuncodeSessionTabs(args.tabs, args.currentId);
});
