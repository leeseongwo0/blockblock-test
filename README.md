# BlockBlock Sui Booth (Testnet MVP)

Sui Testnet 부스용 웹앱입니다.

기능:
- Slush 지갑 기반 Web3 로그인(지갑 연결)
- 키워드 기반 픽셀 코인 PNG 생성
- NFT 민팅 버튼
- 가스비 대납(Sponsored Transaction)

실행 환경:
- Node.js 22 이상 (`@mysten/sui` v2 요구사항)

## 구조

- `frontend`: React + Vite + `@mysten/dapp-kit`
- `backend`: Fastify + Sui SDK (스폰서 트랜잭션 생성)
- `move`: Sui Move NFT 민팅 모듈

## 1) Move 배포

사전 준비: Sui CLI 설치, Testnet 계정/가스 확보

```bash
cd move
sui client switch --env testnet
sui client active-address
sui move build
sui client publish --gas-budget 200000000
```

배포 결과에서 `packageId`를 기록합니다.

그 다음 `MintConfig` shared object를 1회 생성:

```bash
sui client call \
  --package <PACKAGE_ID> \
  --module booth_nft \
  --function create_mint_config \
  --args 500 \
  --gas-budget 30000000
```

결과에서 생성된 `MintConfig` object id를 기록합니다.

## 2) 백엔드 설정

```bash
cd backend
cp .env.example .env
```

`.env` 필수 값:
- `CONTRACT_PACKAGE_ID`: Move 배포 패키지 ID
- `MINT_CONFIG_OBJECT_ID`: create_mint_config로 만든 shared object ID
- `SPONSOR_PRIVATE_KEY`: 가스비 대납 지갑의 `suiprivkey...` (ED25519)

선택 값:
- `SUI_RPC_URL`: 기본 testnet fullnode URL
- `ALLOWED_ORIGINS`: 프론트 도메인 (콤마 구분)
- `PUBLIC_BASE_URL`: 프록시/CDN 뒤 배포 시 이미지 URL 생성용 공개 베이스 URL
- `S3_BUCKET_NAME`: 설정 시 키워드 SVG를 S3에 업로드
- `S3_REGION`: S3 버킷 리전 (또는 `AWS_REGION`)
- `S3_PUBLIC_BASE_URL`: S3/CloudFront 공개 베이스 URL (미설정 시 S3 기본 URL 사용)
- `S3_OBJECT_PREFIX`: 업로드 오브젝트 prefix (기본 `generated`)
- `DEFAULT_NFT_NAME`, `DEFAULT_NFT_IMAGE_URL`
- `TRUST_PROXY`: 리버스 프록시 뒤 배포 시 `true` 권장
- `RATE_LIMIT_GLOBAL_PER_MINUTE`: 전역 요청 제한 (기본 300)
- `RATE_LIMIT_IP_PER_MINUTE`: IP 기준 제한 (기본 120)
- `RATE_LIMIT_SENDER_PER_10_MINUTES`: 주소 기준 제한 (기본 2)
- `RATE_LIMIT_RELAXED`: 현장 대응용 완화 모드 (`true`면 기본 한도 상향)

실행:

```bash
npm install
npm run dev
```

헬스체크:

```bash
curl http://localhost:3001/health
```

## 3) 프론트 설정

```bash
cd frontend
cp .env.example .env
```

`.env` 값:
- `VITE_BACKEND_URL`: 백엔드 주소
- `VITE_SUI_RPC_URL`: Testnet RPC URL
- `VITE_DAPP_NAME`: Slush Wallet 표시용 앱 이름

실행:

```bash
npm install
npm run dev
```

## 4) 루트에서 동시 실행

```bash
npm install
npm run dev
```

## API

### `POST /api/image/generate`

요청:

```json
{
  "keyword": "neon tiger"
}
```

응답:

```json
{
  "keyword": "neon tiger",
  "nftName": "neon tiger Booth NFT",
  "imageUrl": "https://<your-cdn-or-s3>/generated/20260224/...svg"
}
```

- `S3_BUCKET_NAME` 설정 시 SVG를 S3에 저장하고 공개 URL을 반환합니다.
- S3 미설정 시 기존처럼 `/api/image/render?keyword=...` 동적 URL을 반환합니다.

### `GET /api/image/render?keyword=...`

- `keyword`를 기반으로 픽셀 코인 PNG 이미지를 동적으로 렌더링합니다.
- 기본 배경은 흰색이며, 코인 베이스/스타일 레퍼런스는 `assets/coin`, `assets/coin_examples`를 사용합니다.
- `POST /api/image/generate`가 반환한 `imageUrl`로 바로 사용 가능합니다.

### `POST /api/sponsor/mint`

요청:

```json
{
  "sender": "0x...",
  "name": "BlockBlock Booth NFT",
  "imageUrl": "https://...",
  "keyword": "neon tiger"
}
```

- `keyword`를 보내면 서버가 이미지를 생성해(S3 설정 시 업로드) 해당 URL로 민팅 트랜잭션을 만듭니다.

응답:

```json
{
  "txBytes": "base64",
  "sponsorSignature": "base64 signature",
  "gasOwner": "0x..."
}
```

## 50명/분 안정성 체크리스트

- 전용 RPC 사용(공용 fullnode는 혼잡/제한 가능)
- 스폰서 지갑 SUI 잔액 모니터링
- 백엔드 rate-limit 유지(기본: 전역 300/min, IP 120/min, sender 2/10min)
- 백엔드/프론트를 서로 다른 인스턴스로 분리 배포

## 배포 권장

- Frontend: Vercel/Netlify
- Backend: Render/Fly.io/Railway
- RPC: 신뢰 가능한 제공자(유료 플랜 권장)

## 주의

- 스폰서 프라이빗키는 서버에만 보관
- 운영 전 `max_supply`와 부스 동선 리허설 필수
