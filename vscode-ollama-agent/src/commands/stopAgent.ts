import { commands } from 'vscode';
import { OllamaAgent } from '../agent/ollamaAgent';

export function stopAgent(agent: OllamaAgent) {
    return commands.registerCommand('extension.stopAgent', async () => {
        try {
            await agent.stop();
            console.log('Ollama agent stopped successfully.');
        } catch (error) {
            console.error('Failed to stop the Ollama agent:', error);
        }
    });
}