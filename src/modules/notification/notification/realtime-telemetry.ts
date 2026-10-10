import { Controller, Get, Header, Injectable } from '@nestjs/common';
@Injectable()
export class RealtimeTelemetry {
  private readonly counters = new Map<string, number>();
  private readonly consumerLag = new Map<
    string,
    { topic: string; partition: number; value: number }
  >();
  private processingCount = 0;
  private processingSeconds = 0;
  private consumerConnected = false;

  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  setConsumerConnected(connected: boolean): void {
    this.consumerConnected = connected;
  }

  setConsumerLag(topic: string, partition: number, lag: number): void {
    if (!Number.isFinite(lag)) return;
    const key = `${topic}:${partition}`;
    this.consumerLag.set(key, { topic, partition, value: Math.max(0, lag) });
  }

  observeProcessing(seconds: number): void {
    this.processingCount += 1;
    this.processingSeconds += Math.max(0, seconds);
  }

  renderPrometheus(): string {
    const names = [
      'notification_chat_events_received_total',
      'notification_chat_delivery_attempts_total',
      'notification_chat_events_emitted_total',
      'notification_chat_events_retried_total',
      'notification_chat_events_invalid_total',
      'notification_chat_events_dlq_total',
      'notification_chat_dlq_write_failures_total',
    ];
    const lines = names.flatMap((name) => [
      `# TYPE ${name} counter`,
      `${name} ${this.counters.get(name) ?? 0}`,
    ]);
    lines.push(
      '# TYPE notification_chat_consumer_connected gauge',
      `notification_chat_consumer_connected ${this.consumerConnected ? 1 : 0}`,
    );
    for (const { topic, partition, value } of this.consumerLag.values()) {
      const escapedTopic = topic.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      lines.push(
        `notification_chat_consumer_lag{topic="${escapedTopic}",partition="${partition}"} ${value}`,
      );
    }
    lines.push(
      '# TYPE notification_chat_event_processing_seconds summary',
      `notification_chat_event_processing_seconds_count ${this.processingCount}`,
      `notification_chat_event_processing_seconds_sum ${this.processingSeconds}`,
    );
    return `${lines.join('\n')}\n`;
  }
}

@Controller()
export class RealtimeMetricsController {
  constructor(private readonly telemetry: RealtimeTelemetry) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.telemetry.renderPrometheus();
  }
}
