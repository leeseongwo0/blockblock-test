import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
} from '@mysten/dapp-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@mysten/dapp-kit/dist/index.css';
import App from './App';
import './styles.css';

const queryClient = new QueryClient();
const rpcUrl = import.meta.env.VITE_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
const dappName = import.meta.env.VITE_DAPP_NAME ?? 'BlockBlock Booth';

const { networkConfig } = createNetworkConfig({
  testnet: { url: rpcUrl, network: 'testnet' },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect slushWallet={{ name: dappName }}>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
