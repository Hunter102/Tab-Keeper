import * as vscode from 'vscode';

function getAllOpenFilePaths(): string[] {
  const openPaths: string[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if ((tab.input as any)?.uri?.scheme === 'file') {
        openPaths.push((tab.input as any).uri.fsPath);
      }
    }
  }

  return openPaths;
}

export async function activate(context: vscode.ExtensionContext) {
  class TabKeeperViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    private savedTabs: Record<string, string[]>;

    constructor(private context: vscode.ExtensionContext) {
      this.savedTabs = this.context.globalState.get<Record<string, string[]>>('branchTabs') || {};
    }

    refresh(): void {
      this.savedTabs = this.context.globalState.get<Record<string, string[]>>('branchTabs') || {};
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
		
		if (!element) {
			// Top level: branches
			const branches = Object.keys(this.savedTabs);
			if (branches.length === 0) {
				return [new vscode.TreeItem('No saved branches')];
			}
			return branches.map(branch => {
				const item = new vscode.TreeItem(branch, vscode.TreeItemCollapsibleState.Collapsed);
				item.contextValue = 'branch';
				item.iconPath = new vscode.ThemeIcon('git-branch'); // branch icon
				return item;
			});
		}

      // Child level: tabs/files under branch
      if (element.contextValue === 'branch') {
        const tabs = this.savedTabs[element.label as string] || [];
        if (tabs.length === 0) {
          return [new vscode.TreeItem('No saved tabs')];
        }
		return tabs.map(filePath => {
			const fileName = vscode.workspace.asRelativePath(filePath);
			const tabItem = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
			tabItem.tooltip = filePath;
			tabItem.command = {
				command: 'vscode.open',
				title: 'Open File',
				arguments: [vscode.Uri.file(filePath)],
			};
			tabItem.contextValue = 'tab';
			tabItem.iconPath = vscode.ThemeIcon.File; // file icon
			return tabItem;
		});
      }

      return [];
    }
  }

  const viewProvider = new TabKeeperViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('tabKeeperSettingsView', viewProvider)
  );

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
    console.log("lastb", lastKnownBranch);

    repo.state.onDidChange(async () => {
      const newBranch = repo.state.HEAD?.name;

      if (newBranch && newBranch !== lastKnownBranch) {
        const prevBranch = lastKnownBranch;
        lastKnownBranch = newBranch;

        // Save tabs for previous branch
        if (prevBranch) {
          const openPaths = getAllOpenFilePaths();
          savedTabs[prevBranch] = openPaths;
          await context.globalState.update('branchTabs', savedTabs);
          console.log(`Saved ${openPaths.length} tabs for "${prevBranch}"`);

          // Refresh sidebar after saving
          viewProvider.refresh();
        }

        const newBranchTabs = new Set(savedTabs[newBranch] || []);
        console.log(`Loading ${newBranchTabs.size} tabs for "${newBranch}"`);

        // Close tabs not in the new branch
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            const filePath = (tab.input as any)?.uri?.fsPath;
            if (filePath && !newBranchTabs.has(filePath)) {
              await vscode.window.tabGroups.close(tab);
            }
          }
        }

        // Open tabs for new branch
        for (const filePath of newBranchTabs) {
          try {
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
          } catch {
            vscode.window.showWarningMessage(`Could not open: ${filePath}`);
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
