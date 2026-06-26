/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = [], cwd?: string) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: cwd || rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	const product = JSON.parse(await fs.readFile(path.join(rootDir, 'product.json'), 'utf8'));
	const executableName = process.platform === 'win32' ? `${product.nameShort}.exe` : product.nameShort;
	if (await exists(path.join('.build', 'electron', executableName))) {
		return;
	}
	await runProcess(npm, ['run', 'electron']);
}

async function ensureCompiled() {
	await runProcess(npm, ['run', 'compile']);
}

async function compileShuncodeExtension() {
	const extDir = path.join(rootDir, 'extensions', 'shuncode');
	// Rebuild webview UI (settings panel etc.)
	const webviewDir = path.join(extDir, 'webview-ui');
	await runProcess(npm, ['run', 'build'], webviewDir);
	// Run esbuild directly (skip lint which has pre-existing errors)
	await runProcess('node', ['esbuild.mjs'], extDir);
}

async function main() {
	await ensureNodeModules();
	await getElectron();
	await ensureCompiled();
	await compileShuncodeExtension();

	// Can't require this until after dependencies are installed
	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
