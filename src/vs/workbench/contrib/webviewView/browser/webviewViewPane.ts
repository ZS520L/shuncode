/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataTransfers } from '../../../../base/browser/dnd.js';
import { addDisposableListener, Dimension, EventType, findParentWithClass, getWindow } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { UriList } from '../../../../base/common/dataTransfer.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane, ViewPaneShowActions } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { Memento } from '../../../common/memento.js';
import { IViewBadge, IViewDescriptorService } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ExtensionKeyedWebviewOriginStore, IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { WebviewWindowDragMonitor } from '../../webview/browser/webviewWindowDragMonitor.js';
import { IWebviewViewService, WebviewView } from './webviewViewService.js';
import { IActivityService, NumberBadge } from '../../../services/activity/common/activity.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { CodeDataTransfers, containsDragType, extractEditorsDropData } from '../../../../platform/dnd/browser/dnd.js';
import { TerminalDataTransfers } from '../../terminal/browser/terminal.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';

const storageKeys = {
	webviewState: 'webviewState',
} as const;

interface WebviewViewState {
	[storageKeys.webviewState]?: string | undefined;
}

export class WebviewViewPane extends ViewPane {

	private static _originStore?: ExtensionKeyedWebviewOriginStore;
	private static _shuncodeInstance?: WebviewViewPane;
	private static _pendingShuncodeTabs?: { tabs: Array<{ id: string; title: string; state?: string }>; currentId?: string };

	public static getShuncodeInstance(): WebviewViewPane | undefined {
		return WebviewViewPane._shuncodeInstance;
	}

	public static updateShuncodeSessionTabs(tabs: Array<{ id: string; title: string; state?: string }>, currentId?: string): void {
		WebviewViewPane._pendingShuncodeTabs = { tabs, currentId };
		WebviewViewPane._shuncodeInstance?.updateSessionTabs(tabs, currentId);
	}

	private static getOriginStore(storageService: IStorageService): ExtensionKeyedWebviewOriginStore {
		this._originStore ??= new ExtensionKeyedWebviewOriginStore('webviewViews.origins', storageService);
		return this._originStore;
	}

	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private readonly _webviewDisposables = this._register(new DisposableStore());
	private _activated = false;

	private _container?: HTMLElement;
	private _rootContainer?: HTMLElement;
	private _resizeObserver?: ResizeObserver;

	private readonly defaultTitle: string;
	private setTitle: string | undefined;

	private badge: IViewBadge | undefined;
	private readonly activity = this._register(new MutableDisposable<IDisposable>());

	private readonly memento: Memento<WebviewViewState>;
	private readonly viewState: WebviewViewState;
	private readonly extensionId?: ExtensionIdentifier;

	private _repositionTimeout?: Timeout;

	// --- SHUNCODE: session tabs in title bar ---
	private _sessionTabsContainer?: HTMLElement;
	private _sessionTabs: Array<{ id: string; title: string; state?: string }> = [];
	private _currentSessionId?: string;
	private _sessionTabsRetry?: Timeout;

	constructor(
		options: IViewletViewOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IActivityService private readonly activityService: IActivityService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IProgressService private readonly progressService: IProgressService,
		@IStorageService private readonly storageService: IStorageService,
		@IViewsService private readonly viewService: IViewsService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IWebviewViewService private readonly webviewViewService: IWebviewViewService,
	) {
		super({ ...options, titleMenuId: MenuId.ViewTitle, showActions: ViewPaneShowActions.WhenExpanded }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.extensionId = options.fromExtensionId;
		this.defaultTitle = this.title;

		this.memento = new Memento(`webviewView.${this.id}`, storageService);
		this.viewState = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);

		// --- SHUNCODE: register static instance for command access ---
		if (this._isShuncodeView) {
			WebviewViewPane._shuncodeInstance = this;
			const pending = WebviewViewPane._pendingShuncodeTabs;
			if (pending) {
				setTimeout(() => this.updateSessionTabs(pending.tabs, pending.currentId), 0);
			}
		}

		this._register(this.onDidChangeBodyVisibility(() => this.updateTreeVisibility()));

		this._register(this.webviewViewService.onNewResolverRegistered(e => {
			if (e.viewType === this.id) {
				// Potentially re-activate if we have a new resolver
				this.updateTreeVisibility();
			}
		}));

		this.updateTreeVisibility();
	}

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	override dispose() {
		this._onDispose.fire();

		clearTimeout(this._repositionTimeout);
		clearTimeout(this._sessionTabsRetry);

		super.dispose();
	}

	override focus(): void {
		super.focus();
		this._webview.value?.focus();
	}

	// --- SHUNCODE: Override header title to render session tabs ---
	private get _isShuncodeView(): boolean {
		return this.id === 'shuncode.SidebarProvider';
	}

	protected override renderHeaderTitle(container: HTMLElement, title: string): void {
		super.renderHeaderTitle(container, title);
	}

	public updateSessionTabs(tabs: Array<{ id: string; title: string; state?: string }>, currentId?: string): void {
		this._sessionTabs = tabs;
		this._currentSessionId = currentId;
		this._ensureContainerTabsInjected();
		this._renderSessionTabs();
	}

	/**
	 * When the view is merged with its container, ViewPane header is hidden.
	 * The visible title bar is the container's title area (.title-label > h2).
	 * We inject our session tabs container there instead.
	 */
	private _ensureContainerTabsInjected(): void {
		if (this._sessionTabsContainer?.closest('.part.auxiliarybar > .title > .composite-bar-container, .pane-composite-part > .title > .composite-bar-container')) {
			return;
		}

		const ownerDocument = this.element?.ownerDocument;
		if (!ownerDocument) {
			this._scheduleSessionTabsInjection();
			return;
		}

		const compositeBarContainers = Array.from(ownerDocument.querySelectorAll<HTMLElement>('.part.auxiliarybar > .title > .composite-bar-container, .pane-composite-part > .title > .composite-bar-container'));
		const compositeBarContainer = compositeBarContainers.find(container => {
			if (container.offsetParent === null) {
				return false;
			}
			const labels = Array.from(container.querySelectorAll<HTMLElement>('.action-item, .action-label'));
			return labels.some(label => label.textContent?.trim().toLowerCase() === 'shuncode' || label.getAttribute('aria-label')?.trim().toLowerCase().startsWith('shuncode'));
		});

		if (!compositeBarContainer) {
			this._scheduleSessionTabsInjection();
			return;
		}

		const compositeBar = compositeBarContainer.querySelector<HTMLElement>('.composite-bar');
		if (compositeBar) {
			compositeBar.style.display = 'none';
		}

		compositeBarContainer.style.flex = '1';
		compositeBarContainer.style.minWidth = '0';
		compositeBarContainer.style.alignItems = 'center';

		let existing = compositeBarContainer.querySelector('.shuncode-session-tabs') as HTMLElement;
		if (!existing) {
			existing = document.createElement('div');
			existing.className = 'shuncode-session-tabs';
			existing.style.cssText = 'display:flex;align-items:center;justify-content:flex-start;gap:2px;overflow:hidden;flex:1;min-width:0;padding:0 4px;';
			compositeBarContainer.appendChild(existing);
		}
		this._sessionTabsContainer = existing;
	}

	private _scheduleSessionTabsInjection(): void {
		if (this._sessionTabsRetry) {
			return;
		}
		this._sessionTabsRetry = setTimeout(() => {
			this._sessionTabsRetry = undefined;
			this._ensureContainerTabsInjected();
			this._renderSessionTabs();
		}, 100);
	}

	private _renderSessionTabs(): void {
		if (!this._sessionTabsContainer) {
			return;
		}

		this._sessionTabsContainer.replaceChildren();
		this._sessionTabsContainer.style.justifyContent = 'flex-start';

		for (const tab of this._sessionTabs) {
			const isActive = tab.id === this._currentSessionId;
			const tabEl = document.createElement('div');
			tabEl.className = 'shuncode-session-tab' + (isActive ? ' active' : '');
			tabEl.style.cssText = `
				display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:3px;cursor:pointer;flex-shrink:0;
				font-size:11px;white-space:nowrap;user-select:none;max-width:120px;
				${isActive
					? 'background:var(--vscode-tab-activeBackground);color:var(--vscode-tab-activeForeground);'
					: 'color:var(--vscode-tab-inactiveForeground);'
				}
			`;
			tabEl.title = tab.title;

			// State dot
			if (tab.state === 'running') {
				const dot = document.createElement('span');
				dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0;';
				tabEl.appendChild(dot);
			} else if (tab.state === 'paused') {
				const dot = document.createElement('span');
				dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#facc15;flex-shrink:0;';
				tabEl.appendChild(dot);
			}

			// Title
			const titleSpan = document.createElement('span');
			titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
			titleSpan.textContent = tab.title;
			tabEl.appendChild(titleSpan);

			tabEl.addEventListener('click', () => {
				this._webview.value?.postMessage({ type: 'sessionTabClicked', sessionId: tab.id });
			});

			const closeBtn = document.createElement('span');
			closeBtn.className = 'codicon codicon-close';
			closeBtn.style.cssText = 'font-size:12px;opacity:0;cursor:pointer;flex-shrink:0;margin-left:2px;';
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this._webview.value?.postMessage({ type: 'sessionTabClosed', sessionId: tab.id });
			});
			tabEl.addEventListener('mouseenter', () => {
				closeBtn.style.opacity = '1';
			});
			tabEl.addEventListener('mouseleave', () => {
				closeBtn.style.opacity = '0';
			});
			tabEl.appendChild(closeBtn);

			this._sessionTabsContainer.appendChild(tabEl);
		}

		this._sessionTabsContainer.style.justifyContent = this._sessionTabsContainer.scrollWidth > this._sessionTabsContainer.clientWidth ? 'flex-end' : 'flex-start';
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = container;
		this._rootContainer = undefined;

		if (!this._resizeObserver) {
			this._resizeObserver = new ResizeObserver(() => {
				setTimeout(() => {
					this.layoutWebview();
				}, 0);
			});

			this._register(toDisposable(() => {
				this._resizeObserver?.disconnect();
			}));
			this._resizeObserver.observe(container);
		}
	}

	public override saveState() {
		if (this._webview.value) {
			this.viewState[storageKeys.webviewState] = this._webview.value.state;
		}

		this.memento.saveMemento();
		super.saveState();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		this.layoutWebview(new Dimension(width, height));
	}

	private updateTreeVisibility() {
		if (this.isBodyVisible()) {
			this.activate();
			this._webview.value?.claim(this, getWindow(this.element), undefined);
		} else {
			this._webview.value?.release(this);
		}
	}

	private activate() {
		if (this._activated) {
			return;
		}

		this._activated = true;

		const origin = this.extensionId ? WebviewViewPane.getOriginStore(this.storageService).getOrigin(this.id, this.extensionId) : undefined;
		const webview = this.webviewService.createWebviewOverlay({
			origin,
			providedViewType: this.id,
			title: this.title,
			options: { purpose: WebviewContentPurpose.WebviewView },
			contentOptions: {},
			extension: this.extensionId ? { id: this.extensionId } : undefined
		});
		webview.state = this.viewState[storageKeys.webviewState];
		this._webview.value = webview;

		if (this._container) {
			this.layoutWebview();
		}

		this._webviewDisposables.add(toDisposable(() => {
			this._webview.value?.release(this);
		}));

		this._webviewDisposables.add(webview.onDidUpdateState(() => {
			this.viewState[storageKeys.webviewState] = webview.state;
		}));

		// Re-dispatch all drag events back to the drop target to support view drag drop
		// For the ShunCode view, skip redispatch of DRAG_ENTER/DRAG_LEAVE when it's a file drag
		// to prevent the view rearrangement overlay from intercepting subsequent dragover/drop.
		for (const event of [EventType.DRAG, EventType.DRAG_END, EventType.DRAG_ENTER, EventType.DRAG_LEAVE, EventType.DRAG_START]) {
			this._webviewDisposables.add(addDisposableListener(this._webview.value.container, event, e => {
				if (this._isShuncodeView && (e.type === 'dragenter' || e.type === 'dragleave') && containsDragType(e, DataTransfers.FILES, CodeDataTransfers.EDITORS, CodeDataTransfers.FILES, DataTransfers.RESOURCES, DataTransfers.INTERNAL_URI_LIST, TerminalDataTransfers.Terminals)) {
					e.preventDefault();
					e.stopImmediatePropagation();
					return; // Do NOT redispatch file drags — let our drop target handle them
				}
				e.preventDefault();
				e.stopImmediatePropagation();
				this.dropTargetElement.dispatchEvent(new DragEvent(e.type, e));
			}));
		}

		this._webviewDisposables.add(new WebviewWindowDragMonitor(getWindow(this.element), () => this._webview.value));

		// --- SHUNCODE: Support direct file drag-and-drop into the webview panel ---
		// When files are dragged from the explorer, the WebviewWindowDragMonitor sets pointer-events:none
		// on the webview iframe, causing events to fall through to the webview container.
		// We capture DRAG_OVER (to allow drop) and DROP (to extract file URIs and forward to the webview).
		// Only activate for file/editor drags, not view rearrangement drags.
		if (this._isShuncodeView) {
			this._registerShuncodeDropTarget(webview.container);
		}

		const source = this._webviewDisposables.add(new CancellationTokenSource());

		this.withProgress(async () => {
			await this.extensionService.activateByEvent(`onView:${this.id}`);

			const self = this;
			const webviewView: WebviewView = {
				webview,
				onDidChangeVisibility: this.onDidChangeBodyVisibility,
				onDispose: this.onDispose,

				get title(): string | undefined { return self.setTitle; },
				set title(value: string | undefined) { self.updateTitle(value); },

				get description(): string | undefined { return self.titleDescription; },
				set description(value: string | undefined) { self.updateTitleDescription(value); },

				get badge(): IViewBadge | undefined { return self.badge; },
				set badge(badge: IViewBadge | undefined) { self.updateBadge(badge); },

				dispose: () => {
					// Only reset and clear the webview itself. Don't dispose of the view container
					this._activated = false;
					this._webview.clear();
					this._webviewDisposables.clear();
				},

				show: (preserveFocus) => {
					this.viewService.openView(this.id, !preserveFocus);
				}
			};

			await this.webviewViewService.resolve(this.id, webviewView, source.token);
		});
	}

	protected override updateTitle(value: string | undefined) {
		this.setTitle = value;
		super.updateTitle(typeof value === 'string' ? value : this.defaultTitle);
	}

	protected updateBadge(badge: IViewBadge | undefined) {

		if (this.badge?.value === badge?.value &&
			this.badge?.tooltip === badge?.tooltip) {
			return;
		}

		this.badge = badge;
		if (badge) {
			const activity = {
				badge: new NumberBadge(badge.value, () => badge.tooltip),
				priority: 150
			};
			this.activity.value = this.activityService.showViewActivity(this.id, activity);
		}
	}

	private async withProgress(task: () => Promise<void>): Promise<void> {
		return this.progressService.withProgress({ location: this.id, delay: 500 }, task);
	}

	override onDidScrollRoot() {
		this.layoutWebview();
	}

	private doLayoutWebview(dimension?: Dimension) {
		const webviewEntry = this._webview.value;
		if (!this._container || !webviewEntry) {
			return;
		}

		if (!this._rootContainer || !this._rootContainer.isConnected) {
			this._rootContainer = this.findRootContainer(this._container);
		}

		webviewEntry.layoutWebviewOverElement(this._container, dimension, this._rootContainer);
	}

	private layoutWebview(dimension?: Dimension) {
		this.doLayoutWebview(dimension);
		// Temporary fix for https://github.com/microsoft/vscode/issues/110450
		// There is an animation that lasts about 200ms, update the webview positioning once this animation is complete.
		clearTimeout(this._repositionTimeout);
		this._repositionTimeout = setTimeout(() => this.doLayoutWebview(dimension), 200);
	}

	private findRootContainer(container: HTMLElement): HTMLElement | undefined {
		return findParentWithClass(container, 'monaco-scrollable-element') ?? undefined;
	}

	// --- SHUNCODE: Handle file drop from explorer/editor tabs ---
	// The OverlayWebview container and our drop zone cannot receive drag events directly
	// because VS Code's view rearrangement system has a higher-level overlay that intercepts
	// them. We solve this by using window-level CAPTURE phase listeners that fire before
	// any other handler, checking if the cursor is within the ShunCode panel's bounds.
	private _registerShuncodeDropTarget(container: HTMLElement): void {
		// Visual overlay inside the webview container (for "drop here" feedback)
		const overlay = document.createElement('div');
		overlay.className = 'shuncode-drop-overlay';
		overlay.style.cssText = 'display:none;position:absolute;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(0,0,0,.22);color:var(--vscode-editor-foreground);font-size:13px;font-weight:600;pointer-events:none;';
		overlay.textContent = 'Drop to attach as context';
		container.appendChild(overlay);
		this._webviewDisposables.add(toDisposable(() => overlay.remove()));

		const isFileDrag = (e: DragEvent): boolean => {
			return containsDragType(e, DataTransfers.FILES, CodeDataTransfers.EDITORS, CodeDataTransfers.FILES, DataTransfers.RESOURCES, DataTransfers.INTERNAL_URI_LIST, 'text/uri-list');
		};

		const isTerminalDrag = (e: DragEvent): boolean => {
			return containsDragType(e, TerminalDataTransfers.Terminals);
		};

		const isSupportedDrag = (e: DragEvent): boolean => {
			return isFileDrag(e) || isTerminalDrag(e);
		};

		// Check if cursor is within the ShunCode panel body area
		const isCursorOverPanel = (e: DragEvent): boolean => {
			// Use the view pane body element as the hit area (this._container)
			const panelEl = this._container;
			if (!panelEl) {
				return false;
			}
			const rect = panelEl.getBoundingClientRect();
			return e.clientX >= rect.left && e.clientX <= rect.right &&
				e.clientY >= rect.top && e.clientY <= rect.bottom;
		};

		const win = getWindow(this.element);
		let isOverPanel = false;

		// Use CAPTURE phase on window to intercept events before any element-level handler
		let dragLogCount = 0;
		const onDragOver = (e: DragEvent) => {
			if (dragLogCount < 3) {
				dragLogCount++;
				console.log('[ShunCode DnD] dragover types:', Array.from(e.dataTransfer?.types || []),
					'isFile:', isFileDrag(e), 'isTerminal:', isTerminalDrag(e), 'isSupported:', isSupportedDrag(e),
					'overPanel:', isCursorOverPanel(e));
			}
			if (!isSupportedDrag(e)) {
				if (isOverPanel) {
					isOverPanel = false;
					overlay.style.display = 'none';
				}
				return;
			}
			if (isCursorOverPanel(e)) {
				e.preventDefault();
				e.stopPropagation();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'copy';
				}
				if (!isOverPanel) {
					isOverPanel = true;
					overlay.style.display = 'flex';
					console.log('[ShunCode DnD] ENTERED PANEL — overlay shown, isTerminal:', isTerminalDrag(e));
				}
			} else {
				if (isOverPanel) {
					isOverPanel = false;
					overlay.style.display = 'none';
					console.log('[ShunCode DnD] LEFT PANEL — overlay hidden');
				}
			}
		};

		const onDrop = (e: DragEvent) => {
			console.log('[ShunCode DnD] DROP fired, isSupported:', isSupportedDrag(e), 'overPanel:', isCursorOverPanel(e), 'isTerminal:', isTerminalDrag(e));
			if (!isSupportedDrag(e) || !isCursorOverPanel(e)) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			isOverPanel = false;
			overlay.style.display = 'none';

			if (isTerminalDrag(e)) {
				this._handleShuncodeTerminalDrop();
			} else {
				this._handleShuncodeDrop(e);
			}
		};

		const onDragEnd = () => {
			if (isOverPanel) {
				isOverPanel = false;
				overlay.style.display = 'none';
			}
		};

		// Register in CAPTURE phase (true) so we fire before any bubble-phase handlers
		win.addEventListener('dragover', onDragOver, true);
		win.addEventListener('drop', onDrop, true);
		win.addEventListener('dragend', onDragEnd, true);

		this._webviewDisposables.add(toDisposable(() => {
			win.removeEventListener('dragover', onDragOver, true);
			win.removeEventListener('drop', onDrop, true);
			win.removeEventListener('dragend', onDragEnd, true);
		}));
	}

	private _handleShuncodeDrop(e: DragEvent): void {
		const uris = this._getShuncodeDropUris(e);
		if (uris.length === 0) {
			return;
		}

		// Forward to the webview as a message
		this._webview.value?.postMessage({
			type: 'shuncodeFileDrop',
			uris,
		});
	}

	private _handleShuncodeTerminalDrop(): void {
		// Forward terminal drop to the webview — the webview will insert @terminal
		// which triggers the existing mention system to read the latest terminal output
		this._webview.value?.postMessage({
			type: 'shuncodeTerminalDrop',
		});
	}

	private _getShuncodeDropUris(e: DragEvent): string[] {
		const dataTransfer = e.dataTransfer;
		if (!dataTransfer) {
			return [];
		}

		const uris = new Set<string>();

		// 1. Try VS Code internal resource URIs (from explorer tree)
		for (const editor of extractEditorsDropData(e)) {
			if (editor.resource) {
				uris.add(editor.resource.toString());
			}
		}

		// 2. Try VS Code URI list (from editor tabs, etc.)
		for (const type of [DataTransfers.INTERNAL_URI_LIST, 'text/uri-list']) {
			const rawUriList = dataTransfer.getData(type);
			if (rawUriList) {
				for (const uri of UriList.parse(rawUriList)) {
					uris.add(uri);
				}
			}
		}

		// 4. Try text/plain as fallback (may contain a file path)
		const text = dataTransfer.getData(DataTransfers.TEXT);
		if (text && (text.startsWith('file:') || text.startsWith('vscode-file:') || text.startsWith('vscode-remote:'))) {
			uris.add(text);
		}

		return Array.from(uris);
	}
}
