/**
 * The signer shape every SDK write call takes: an address plus a
 * signTransaction function matching @stellar/stellar-sdk's own
 * SignTransactionLike signature. Ported from web/app/lib/event-actions.ts's
 * own `Signer` interface with minimal changes (per this PR's brief:
 * "ALREADY essentially what the brief asks for... port it with minimal
 * changes") - structurally identical to what
 * web/app/lib/wallet/WalletContext.tsx's own `signTransaction` already
 * returns (`{signedTxXdr: string; signerAddress?: string}`), confirmed
 * by re-reading that file directly, so a later PR can pass
 * WalletContext's signTransaction straight through as this SDK's
 * signer with no adapter shim.
 *
 * Only plain XDR strings cross this boundary - the SDK never imports
 * any wallet kit, and never sees a private key.
 */
export interface Signer {
  publicKey: string;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
}
