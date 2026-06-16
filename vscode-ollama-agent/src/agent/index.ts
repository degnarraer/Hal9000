import { OllamaAgent } from './ollamaAgent';

let agent: OllamaAgent | null = null;

export function initializeAgent() {
    if (!agent) {
        agent = new OllamaAgent();
        agent.start();
    }
}

export function stopAgent() {
    if (agent) {
        agent.stop();
        agent = null;
    }
}

export function getAgentStatus() {
    return agent ? agent.getStatus() : 'Agent is not running';
}