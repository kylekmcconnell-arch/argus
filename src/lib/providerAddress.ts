const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

/**
 * Canonical key for provider data indexed by an on-chain address.
 * EVM identity is case-insensitive, while Solana/base58 identity is not.
 */
export function providerAddressKey(address: string): string {
  const value = String(address).trim();
  return EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}
