import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export interface EmailTaskMessage {
  to: string;
  subject: string;
  html: string;
}

export interface AlertQueuePublisherOptions {
  region: string;
  queueUrl: string;
}

export class AlertQueuePublisher {
  private readonly client: SQSClient;

  private readonly queueUrl: string;

  constructor(options: AlertQueuePublisherOptions) {
    this.client = new SQSClient({
      region: options.region
    });
    this.queueUrl = options.queueUrl;
  }

  async publishEmailTask(message: EmailTaskMessage): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message)
    }));
  }
}
