class OllamaAgent {
    private isRunning: boolean;

    constructor() {
        this.isRunning = false;
    }

    public start(): void {
        if (!this.isRunning) {
            // Logic to start the Ollama agent
            this.isRunning = true;
            console.log("Ollama Agent started.");
        } else {
            console.log("Ollama Agent is already running.");
        }
    }

    public stop(): void {
        if (this.isRunning) {
            // Logic to stop the Ollama agent
            this.isRunning = false;
            console.log("Ollama Agent stopped.");
        } else {
            console.log("Ollama Agent is not running.");
        }
    }

    public status(): string {
        return this.isRunning ? "Ollama Agent is running." : "Ollama Agent is stopped.";
    }
}

export default OllamaAgent;