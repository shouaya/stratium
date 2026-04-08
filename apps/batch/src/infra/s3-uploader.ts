import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3UploaderOptions {
  bucket: string;
  prefix: string;
  region: string;
  storageClass?: ConstructorParameters<typeof PutObjectCommand>[0]["StorageClass"];
}

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

export class S3Uploader {
  private readonly client: S3Client;

  private readonly bucket: string;

  private readonly prefix: string;

  private readonly storageClass?: ConstructorParameters<typeof PutObjectCommand>[0]["StorageClass"];

  constructor(options: S3UploaderOptions) {
    this.client = new S3Client({
      region: options.region
    });
    this.bucket = options.bucket;
    this.prefix = options.prefix;
    this.storageClass = options.storageClass;
  }

  async uploadCompressedFile(fullPath: string, relativePath: string): Promise<{
    bucket: string;
    key: string;
  }> {
    const gzipPath = `${fullPath}.gz`;
    await pipeline(
      fs.createReadStream(fullPath),
      zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }),
      fs.createWriteStream(gzipPath)
    );

    const key = `${this.prefix}/${toPosixPath(`${relativePath}.gz`)}`;
    const body = await fs.promises.readFile(gzipPath);

    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/x-ndjson",
        ContentEncoding: "gzip",
        StorageClass: this.storageClass
      }));
    } finally {
      await fs.promises.rm(gzipPath, { force: true });
    }

    console.log(`Uploaded ${relativePath}.gz to s3://${this.bucket}/${key}`);

    return {
      bucket: this.bucket,
      key
    };
  }

  async cleanupUploadedFile(fullPath: string): Promise<void> {
    await fs.promises.rm(fullPath, { force: true });
  }
}
