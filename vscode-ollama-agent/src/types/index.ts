export interface AgentStatus {
    isActive: boolean;
    lastStarted: Date | null;
    lastStopped: Date | null;
}

export interface CommandResponse {
    success: boolean;
    message: string;
    data?: any;
}