import { PerceptionInput } from "../../shared/types";

export type PerceptionHandler = () => Promise<PerceptionInput[]>;

export class PerceptionScheduler {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly handler: PerceptionHandler
  ) {}

  start(onBatch: (inputs: PerceptionInput[]) => void): void {
    if (this.intervalId) {
      return;
    }
    this.intervalId = setInterval(async () => {
      const inputs = await this.handler();
      onBatch(inputs);
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
