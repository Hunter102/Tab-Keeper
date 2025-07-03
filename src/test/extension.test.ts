import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
  console.log('🎉 Tab Keeper extension activated!');
  const savedTabs = context.globalState.get<Record<string, string[]>>('branchTabs') || {};
  let currentBranch: string | undefined;

  const getBranch = async (): Promise<string | undefined> => {
    try {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) return undefined;
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
      return stdout.trim();
    } catch (err) {
      console.error('Error getting branch:', err);
      return undefined;
    }
  };

  const checkBranch = async () => {
    const newBranch = await getBranch();
    if (!newBranch || newBranch === currentBranch) return;

    if (currentBranch) {
      const saveTabs = await vscode.window.showInformationMessage(
        `Switching from ${currentBranch} to ${newBranch}. Save open tabs for ${currentBranch}?`,
        'Yes', 'No'
      );

      if (saveTabs === 'Yes') {
        const openPaths = vscode.window.visibleTextEditors.map(e => e.document.uri.fsPath);
        savedTabs[currentBranch] = openPaths;
        await context.globalState.update('branchTabs', savedTabs);
      }

      const loadChoice = await vscode.window.showQuickPick(
        ['Load saved tabs', 'Load previous branch tabs', 'Combine tabs', 'Do nothing'],
        { placeHolder: `Load tabs for ${newBranch}?` }
      );

      const toLoad: Set<string> = new Set();

      if (loadChoice === 'Load saved tabs' && savedTabs[newBranch]) {
        savedTabs[newBranch].forEach(p => toLoad.add(p));
      } else if (loadChoice === 'Load previous branch tabs' && savedTabs[currentBranch]) {
        savedTabs[currentBranch].forEach(p => toLoad.add(p));
      } else if (loadChoice === 'Combine tabs') {
        savedTabs[newBranch]?.forEach(p => toLoad.add(p));
        savedTabs[currentBranch]?.forEach(p => toLoad.add(p));
      }

      for (const filePath of toLoad) {
        try {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        } catch {
          vscode.window.showWarningMessage(`File missing: ${filePath}`);
        }
      }
    }

    currentBranch = newBranch;
  };

  getBranch().then(branch => {
    currentBranch = branch;
  });

  // Check every 3 seconds
  setInterval(checkBranch, 3000);
}

export function deactivate() {}
