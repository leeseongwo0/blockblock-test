import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type S3ImageStoreConfig = {
  bucketName: string;
  region: string;
  objectPrefix: string;
  publicBaseUrl?: string;
};

export class S3ImageStore {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly objectPrefix: string;
  private readonly publicBaseUrl: string;

  constructor(config: S3ImageStoreConfig) {
    this.client = new S3Client({ region: config.region });
    this.bucketName = config.bucketName;
    this.objectPrefix = config.objectPrefix;
    this.publicBaseUrl =
      config.publicBaseUrl ??
      `https://${config.bucketName}.s3.${config.region}.amazonaws.com`;
  }

  private buildObjectKey(keyword: string): string {
    const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const hashPart = createHash('sha256')
      .update(keyword.toLowerCase())
      .digest('hex')
      .slice(0, 12);
    return `${this.objectPrefix}/${datePart}/${hashPart}-${randomUUID()}.svg`;
  }

  async uploadKeywordSvg(keyword: string, svgContent: string): Promise<string> {
    const key = this.buildObjectKey(keyword);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: svgContent,
        ContentType: 'image/svg+xml; charset=utf-8',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return `${this.publicBaseUrl}/${key}`;
  }
}
