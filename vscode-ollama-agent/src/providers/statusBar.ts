import * as vscode from 'vscode';
import { OllamaAgent } from '../agent/ollamaAgent';

export class StatusBarProvider {
    private statusBarItem: vscode.StatusBarItem;
    private agent: OllamaAgent;

    constructor(agent: OllamaAgent) {
        this.agent = agent;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.updateStatus();
    }

    public updateStatus() {
        const status = this.agent.getStatus();
        this.statusBarItem.text = `Ollama Agent: ${status}`;
        this.statusBarItem.show();
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}