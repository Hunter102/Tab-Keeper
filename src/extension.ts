import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	try {
		let savedTabs = context.globalState.get<Record<string, string[]>>('branchTabs') || {};
		let lastKnownBranch: string | undefined;
		
		const gitExtension = vscode.extensions.getExtension('vscode.git');
		await gitExtension?.activate();
		const api = gitExtension?.exports?.getAPI?.(1);
		
		if (api.repositories.length === 0) {
			await new Promise<void>(resolve => {
				const disposable = api.onDidOpenRepository(() => {
				disposable.dispose();
				resolve();
				});
			});
		}

		const repo = api.repositories[0];
		async function waitForHeadName(): Promise<string> {
		if (repo.state.HEAD?.name) {
			return repo.state.HEAD.name;
		}
		return new Promise(resolve => {
			const disposable = repo.state.onDidChange(() => {
			if (repo.state.HEAD?.name) {
				disposable.dispose();
				resolve(repo.state.HEAD.name);
			}
			});
		});
		}

		lastKnownBranch = await waitForHeadName();
		console.log("lastb", lastKnownBranch)
		
		repo.state.onDidChange(async () => {
			console.log("repo.state.HEAD:", repo.state.HEAD);
			console.log("repo.state.HEAD?.name:", repo.state.HEAD?.name);
			const newBranch = repo.state.HEAD?.name;
			
			if (newBranch !== lastKnownBranch && lastKnownBranch) {
				const prevBranch = lastKnownBranch;
				lastKnownBranch = newBranch;
				
				const saveTabs = await vscode.window.showInformationMessage(
					`Do you want to save open tabs for "${prevBranch}" before switching to "${newBranch}"?`,
					'Yes', 'No'
				);
				
				if (saveTabs === 'Yes') {
					const openPaths = vscode.window.visibleTextEditors.map(e => e.document.uri.fsPath);
					savedTabs[prevBranch] = openPaths;
					await context.globalState.update('branchTabs', savedTabs);
				}
				
				const loadChoice = await vscode.window.showQuickPick(
					[
						'Load saved tabs for this branch',
						`Load tabs from "${prevBranch}"`,
						'Combine both',
						'Do nothing'
					],
					{ placeHolder: `Do you want to load tabs for "${newBranch}"?` }
				);
				
				const toLoad: Set<string> = new Set();
				
				if (loadChoice === 'Load saved tabs for this branch' && savedTabs[newBranch]) {
					savedTabs[newBranch].forEach(p => toLoad.add(p));
				} else if (loadChoice?.startsWith('Load tabs from') && savedTabs[prevBranch]) {
					savedTabs[prevBranch].forEach(p => toLoad.add(p));
				} else if (loadChoice === 'Combine both') {
					savedTabs[newBranch]?.forEach(p => toLoad.add(p));
					savedTabs[prevBranch]?.forEach(p => toLoad.add(p));
				}
				
				for (const filePath of toLoad) {
					try {
						const doc = await vscode.workspace.openTextDocument(filePath);
						await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
					} catch {
						vscode.window.showWarningMessage(`File not found: ${filePath}`);
					}
				}
			}
		});
	} catch (error) {
		vscode.window.showErrorMessage(`Tab Keeper error: ${error instanceof Error ? error.message : String(error)}`);
		console.error('Tab Keeper Activation Error:', error);
	}
}

export function deactivate() {}