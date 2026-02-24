import { useMemo, useState } from 'react';
import {
  ConnectButton,
  useCurrentAccount,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext,
} from '@mysten/dapp-kit';
import { requestGeneratedImage, requestSponsoredMint } from './api';

type MintState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; digest: string; objectId?: string }
  | { kind: 'error'; message: string };

type ImageState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; imageUrl: string }
  | { kind: 'error'; message: string };

function toUserMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('), 3)')) {
    return '민팅 수량이 모두 소진되었습니다.';
  }
  if (raw.includes('), 4)')) {
    return '현재 민팅이 일시 중지 상태입니다.';
  }
  return raw;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function compactText(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { network: currentNetwork } = useSuiClientContext();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const [keyword, setKeyword] = useState('');
  const [mintName, setMintName] = useState('BlockBlock Booth NFT');
  const [mintImageUrl, setMintImageUrl] = useState(
    'https://placehold.co/1024x1024/png?text=BlockBlock+Booth',
  );
  const [imageState, setImageState] = useState<ImageState>({ kind: 'idle' });
  const [mintState, setMintState] = useState<MintState>({ kind: 'idle' });

  const canMint = useMemo(() => {
    return Boolean(account?.address) && mintState.kind !== 'loading';
  }, [account?.address, mintState.kind]);

  const canGenerateImage = useMemo(() => {
    return compactText(keyword).length > 0 && imageState.kind !== 'loading';
  }, [keyword, imageState.kind]);

  const generateImageFromKeyword = async (rawKeyword: string) => {
    const normalizedKeyword = compactText(rawKeyword);
    if (!normalizedKeyword) {
      throw new Error('키워드를 입력해 주세요.');
    }

    setImageState({ kind: 'loading', message: '키워드로 이미지 생성 중...' });
    const generated = await requestGeneratedImage({
      keyword: normalizedKeyword,
    });
    setMintImageUrl(generated.imageUrl);
    if (!compactText(mintName)) {
      setMintName(generated.nftName);
    }
    setImageState({
      kind: 'success',
      imageUrl: generated.imageUrl,
    });
    return generated;
  };

  const onClickGenerateImage = async () => {
    try {
      await generateImageFromKeyword(keyword);
    } catch (error) {
      setImageState({
        kind: 'error',
        message: toUserMessage(error),
      });
    }
  };

  const onClickMint = async () => {
    if (!account?.address) {
      setMintState({ kind: 'error', message: '먼저 Slush 지갑을 연결해 주세요.' });
      return;
    }

    try {
      const normalizedKeyword = compactText(keyword);
      let finalMintName = compactText(mintName);
      let finalMintImageUrl = mintImageUrl.trim();

      if (normalizedKeyword) {
        setMintState({
          kind: 'loading',
          message: '키워드 기반 이미지 생성 중...',
        });
        const generated = await generateImageFromKeyword(normalizedKeyword);
        finalMintImageUrl = generated.imageUrl;
        if (!finalMintName) {
          finalMintName = generated.nftName;
          setMintName(generated.nftName);
        }
      }

      setMintState({ kind: 'loading', message: '가스비 대납 트랜잭션 생성 중...' });
      const sponsored = await requestSponsoredMint({
        sender: account.address,
        name: finalMintName || undefined,
        imageUrl: finalMintImageUrl || undefined,
      });

      setMintState({ kind: 'loading', message: '지갑 서명 요청 중...' });
      const signed = await signTransaction({
        transaction: sponsored.txBytes,
      });

      setMintState({ kind: 'loading', message: '체인에 민팅 전송 중...' });
      const result = await client.executeTransactionBlock({
        transactionBlock: signed.bytes ?? sponsored.txBytes,
        signature: [signed.signature, sponsored.sponsorSignature],
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });

      if (result.effects?.status.status !== 'success') {
        throw new Error(result.effects?.status.error ?? 'Mint failed');
      }

      const createdNft = result.objectChanges?.find((change) => {
        return (
          change.type === 'created' &&
          'objectType' in change &&
          String(change.objectType).includes('::booth_nft::BoothNFT')
        );
      });

      setMintState({
        kind: 'success',
        digest: result.digest,
        objectId: createdNft && 'objectId' in createdNft ? createdNft.objectId : undefined,
      });
    } catch (error) {
      setMintState({
        kind: 'error',
        message: toUserMessage(error),
      });
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="tag">Sui Testnet Booth</p>
        <h1>Web3 처음이어도 1분 안에 NFT 민팅</h1>
        <p className="description">
          Slush 지갑 로그인, NFT 민팅, 가스비 대납까지 한 번에 제공하는 부스용 페이지입니다.
        </p>
        <ConnectButton />
      </section>

      <section className="panel">
        <h2>1) Web3 로그인 (Slush Wallet)</h2>
        <p>
          연결 상태:{' '}
          {account?.address
            ? `로그인 완료 - ${shortAddress(account.address)}`
            : '미연결'}
        </p>
        <p>네트워크: {currentNetwork}</p>
      </section>

      <section className="panel">
        <h2>2) NFT 민팅</h2>
        <label>
          생성 키워드
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            maxLength={40}
            placeholder="예: cyber tiger, neon city, hanbok robot"
          />
        </label>
        <button onClick={onClickGenerateImage} disabled={!canGenerateImage}>
          키워드로 이미지 생성
        </button>
        {imageState.kind === 'loading' && <p>{imageState.message}</p>}
        {imageState.kind === 'error' && <p className="error">{imageState.message}</p>}
        {imageState.kind === 'success' && (
          <p className="helper">이미지 생성 완료. 아래 URL로 민팅됩니다.</p>
        )}
        <label>
          NFT 이름
          <input
            value={mintName}
            onChange={(event) => setMintName(event.target.value)}
            maxLength={48}
          />
        </label>
        <label>
          NFT 이미지 URL
          <input
            value={mintImageUrl}
            onChange={(event) => setMintImageUrl(event.target.value)}
          />
        </label>
        {mintImageUrl && (
          <img className="preview-image" src={mintImageUrl} alt="NFT preview" />
        )}
        <button onClick={onClickMint} disabled={!canMint}>
          3) 키워드 이미지 + 가스비 대납으로 민팅하기
        </button>

        {mintState.kind === 'loading' && <p>{mintState.message}</p>}
        {mintState.kind === 'error' && <p className="error">{mintState.message}</p>}
        {mintState.kind === 'success' && (
          <div className="success">
            <p>민팅 성공</p>
            <p>Tx Digest: {mintState.digest}</p>
            {mintState.objectId && <p>NFT Object: {mintState.objectId}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
