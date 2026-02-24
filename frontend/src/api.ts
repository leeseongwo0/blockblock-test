const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export type SponsoredMintResponse = {
  txBytes: string;
  sponsorSignature: string;
  gasOwner: string;
};

export type GeneratedImageResponse = {
  keyword: string;
  nftName: string;
  imageUrl: string;
};

export async function requestSponsoredMint(params: {
  sender: string;
  name?: string;
  imageUrl?: string;
}): Promise<SponsoredMintResponse> {
  const response = await fetch(`${backendUrl}/api/sponsor/mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sponsor API error (${response.status}): ${text}`);
  }

  return (await response.json()) as SponsoredMintResponse;
}

export async function requestGeneratedImage(params: {
  keyword: string;
}): Promise<GeneratedImageResponse> {
  const response = await fetch(`${backendUrl}/api/image/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Image API error (${response.status}): ${text}`);
  }

  return (await response.json()) as GeneratedImageResponse;
}
