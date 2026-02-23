const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export type SponsoredMintResponse = {
  txBytes: string;
  sponsorSignature: string;
  gasOwner: string;
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
