import * as vscode from 'vscode';
import { activateAgent } from './commands/activateAgent';
import { stopAgent } from './commands/stopAgent';
import { StatusBarProvider } from './providers/statusBar';

export function activate(context: vscode.ExtensionContext) {
    const statusBarProvider = new StatusBarProvider();
    context.subscriptions.push(statusBarProvider);

    const activateCommand = vscode.commands.registerCommand('ollama.activate', activateAgent);
    const stopCommand = vscode.commands.registerCommand('ollama.stop', stopAgent);

    context.subscriptions.push(activateCommand);
    context.subscriptions.push(stopCommand);
}

export function deactivate() {
    // Cleanup logic if needed
}