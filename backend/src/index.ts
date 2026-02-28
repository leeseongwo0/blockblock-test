import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { getConfig } from './config.js';
import { FixedWindowLimiter } from './limiter.js';
import { S3ImageStore } from './s3.js';
import {
  keywordToNftName,
  normalizeKeyword,
  renderKeywordCoinPng,
} from './image.js';

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, 'Invalid Sui address format');

const mintRequestSchema = z.object({
  sender: addressSchema,
  name: z.string().trim().min(1).max(48).optional(),
  imageUrl: z.string().trim().url().max(512).optional(),
  keyword: z.string().trim().min(1).max(40).optional(),
});

const keywordImageSchema = z.object({
  keyword: z.string().trim().min(1).max(40),
});

const config = getConfig();
const decoded = decodeSuiPrivateKey(config.sponsorPrivateKey);
if (decoded.scheme !== 'ED25519') {
  throw new Error('SPONSOR_PRIVATE_KEY must be an ED25519 Sui private key');
}

const sponsorKeypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
const sponsorAddress = sponsorKeypair.toSuiAddress();
const client = new SuiJsonRpcClient({
  url: config.suiRpcUrl,
  network: 'testnet',
});
const ipLimiter = new FixedWindowLimiter();
const senderLimiter = new FixedWindowLimiter();
const s3ImageStore =
  config.s3BucketName && config.s3Region
    ? new S3ImageStore({
        bucketName: config.s3BucketName,
        region: config.s3Region,
        objectPrefix: config.s3ObjectPrefix,
        publicBaseUrl: config.s3PublicBaseUrl,
      })
    : null;

type MintTxInput = {
  sender: string;
  name?: string;
  imageUrl?: string;
};

function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? fromBase64(input) : input;
}

function toB64(input: Uint8Array | string): string {
  return typeof input === 'string' ? input : toBase64(input);
}

function resolvePublicBaseUrl(request: FastifyRequest): string {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl;
  }

  const forwardedHost = request.headers['x-forwarded-host'];
  const hostHeader =
    typeof forwardedHost === 'string' ? forwardedHost : request.headers.host;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protoHeader =
    typeof forwardedProto === 'string' ? forwardedProto : request.protocol;
  const protocol = protoHeader?.split(',')[0]?.trim() || 'http';
  const host = hostHeader?.split(',')[0]?.trim() || `localhost:${config.port}`;

  return `${protocol}://${host}`;
}

async function getGasPayment() {
  const coins = await client.getCoins({
    owner: sponsorAddress,
    coinType: '0x2::sui::SUI',
    limit: 10,
  });

  const minRequired = BigInt(config.gasBudgetMist);
  const coin = coins.data.find((item: { balance: string }) => BigInt(item.balance) > minRequired);

  if (!coin) {
    throw new Error('Sponsor wallet has no gas coin with enough balance');
  }

  return [
    {
      objectId: coin.coinObjectId,
      version: coin.version,
      digest: coin.digest,
    },
  ];
}

async function resolveKeywordImage(keyword: string, request: FastifyRequest) {
  const png = await renderKeywordCoinPng(keyword);
  if (s3ImageStore) {
    const imageUrl = await s3ImageStore.uploadKeywordImage({
      keyword,
      content: png,
      contentType: 'image/png',
      extension: 'png',
    });
    return {
      keyword,
      nftName: keywordToNftName(keyword),
      imageUrl,
    };
  }

  const baseUrl = resolvePublicBaseUrl(request);
  return {
    keyword,
    nftName: keywordToNftName(keyword),
    imageUrl: `${baseUrl}/api/image/render?keyword=${encodeURIComponent(keyword)}`,
  };
}

async function buildSponsoredMintTx(input: MintTxInput) {
  const mintTx = new Transaction();
  mintTx.moveCall({
    target: `${config.packageId}::booth_nft::mint`,
    arguments: [
      mintTx.object(config.mintConfigObjectId),
      mintTx.pure.string(input.name ?? config.defaultNftName),
      mintTx.pure.string(input.imageUrl ?? config.defaultNftImageUrl),
    ],
  });
  mintTx.setSender(input.sender);

  const txKind = await mintTx.build({
    client,
    onlyTransactionKind: true,
  });

  const sponsoredTx = Transaction.fromKind(toBytes(txKind));
  sponsoredTx.setSender(input.sender);
  sponsoredTx.setGasOwner(sponsorAddress);
  sponsoredTx.setGasBudget(BigInt(config.gasBudgetMist));
  // Some wallet/runtime combinations still fail to decode ValidDuring (enum value 2).
  // Force legacy-compatible expiration to avoid "Unknown value 2 for enum TransactionExpiration".
  sponsoredTx.setExpiration({ None: true });
  sponsoredTx.setGasPayment(await getGasPayment());

  const txBytes = await sponsoredTx.build({ client });
  const { signature } = await sponsorKeypair.signTransaction(toBytes(txBytes));

  return {
    txBytes: toB64(txBytes),
    sponsorSignature: signature,
  };
}

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: config.trustProxy,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.globalLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: () => 'global',
  });

  app.get('/health', async () => {
    return {
      ok: true,
      sponsorAddress,
      packageId: config.packageId,
      mintConfigObjectId: config.mintConfigObjectId,
    };
  });

  app.post('/api/image/generate', async (request, reply) => {
    const parsed = keywordImageSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      };
    }

    try {
      const keyword = normalizeKeyword(parsed.data.keyword);
      return await resolveKeywordImage(keyword, request);
    } catch (error) {
      request.log.error({ error }, 'Failed to generate keyword image');
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  app.get('/api/image/render', async (request, reply) => {
    const parsed = keywordImageSchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid query',
        issues: parsed.error.issues,
      };
    }

    const keyword = normalizeKeyword(parsed.data.keyword);
    const png = await renderKeywordCoinPng(keyword);

    reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=60');

    return png;
  });

  app.post('/api/sponsor/mint', async (request, reply) => {
    const ipLimit = ipLimiter.consume(`ip:${request.ip}`, config.ipLimitPerMinute, 60_000);
    if (!ipLimit.allowed) {
      reply.code(429);
      return {
        error: 'Rate limit exceeded (ip)',
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      };
    }

    const parsed = mintRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      };
    }

    const senderLimit = senderLimiter.consume(
      `sender:${parsed.data.sender.toLowerCase()}`,
      config.senderLimitPer10Minutes,
      10 * 60_000,
    );
    if (!senderLimit.allowed) {
      reply.code(429);
      return {
        error: 'Rate limit exceeded (sender)',
        retryAfterSeconds: senderLimit.retryAfterSeconds,
      };
    }

    try {
      const mintInput: MintTxInput = {
        sender: parsed.data.sender,
        name: parsed.data.name,
        imageUrl: parsed.data.imageUrl,
      };

      if (parsed.data.keyword) {
        const keyword = normalizeKeyword(parsed.data.keyword);
        const generated = await resolveKeywordImage(keyword, request);
        mintInput.imageUrl = generated.imageUrl;
        if (!mintInput.name) {
          mintInput.name = generated.nftName;
        }
      }

      const sponsored = await buildSponsoredMintTx(mintInput);
      return {
        ...sponsored,
        gasOwner: sponsorAddress,
      };
    } catch (error) {
      request.log.error({ error }, 'Failed to build sponsored mint tx');
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  await app.listen({
    host: config.host,
    port: config.port,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
