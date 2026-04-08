import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export interface UploadedBatchMessage {
  bucket: string;
  key: string;
  source: "hyperliquid";
  uploadedAt: string;
  contentEncoding: "gzip";
  contentType: "application/x-ndjson";
}

export interface SqsPublisherOptions {
  region: string;
  queueUrl: string;
}

export class SqsPublisher {
  private readonly client: SQSClient;

  private readonly queueUrl: string;

  constructor(options: SqsPublisherOptions) {
    this.client = new SQSClient({
      region: options.region
    });
    this.queueUrl = options.queueUrl;
  }

  async publishUploadedBatch(message: UploadedBatchMessage): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message)
    }));
  }
}
