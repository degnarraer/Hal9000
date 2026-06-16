import { commands, window } from 'vscode';
import { OllamaAgent } from '../agent/ollamaAgent';

export function activateAgent() {
    const agent = new OllamaAgent();

    commands.registerCommand('ollama.activate', async () => {
        try {
            await agent.start();
            window.showInformationMessage('Ollama Agent activated successfully!');
        } catch (error) {
            window.showErrorMessage(`Failed to activate Ollama Agent: ${error.message}`);
        }
    });
}