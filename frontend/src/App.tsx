import { useMemo, useState } from 'react';
import {
  ConnectButton,
  useCurrentAccount,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext,
} from '@mysten/dapp-kit';
import { requestSponsoredMint } from './api';

type MintState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; digest: string; objectId?: string }
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

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { network: currentNetwork } = useSuiClientContext();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const [mintName, setMintName] = useState('BlockBlock Booth NFT');
  const [mintImageUrl, setMintImageUrl] = useState(
    'https://placehold.co/1024x1024/png?text=BlockBlock+Booth',
  );
  const [mintState, setMintState] = useState<MintState>({ kind: 'idle' });

  const canMint = useMemo(() => {
    return Boolean(account?.address) && mintState.kind !== 'loading';
  }, [account?.address, mintState.kind]);

  const onClickMint = async () => {
    if (!account?.address) {
      setMintState({ kind: 'error', message: '먼저 Slush 지갑을 연결해 주세요.' });
      return;
    }

    try {
      setMintState({ kind: 'loading', message: '가스비 대납 트랜잭션 생성 중...' });
      const sponsored = await requestSponsoredMint({
        sender: account.address,
        name: mintName,
        imageUrl: mintImageUrl,
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
        <button onClick={onClickMint} disabled={!canMint}>
          3) 가스비 대납으로 민팅하기
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
