import type { GenerationEvent } from "../services/nativeBridge";
declare global { interface Window { syncAI: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>; onGenerationEvent(callback: (event: GenerationEvent) => void): () => void; }; } }
export {};
