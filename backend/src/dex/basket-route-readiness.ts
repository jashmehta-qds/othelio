import { getAddress, isAddress, parseAbi, type PublicClient, type Address } from 'viem';
import { BASE_USDC_ADDRESS, getAerodromeSlipstreamRoutes } from './aerodrome-slipstream-routes';

const moduleAbi = parseAbi(['function aerodromeAdapter() view returns (address)']);
const adapterAbi = parseAbi(['function routeRegistry() view returns (address)']);
const registryAbi = parseAbi([
  'function requireApprovedPool(uint256 chainId,address tokenA,address tokenB,int24 tickSpacing) view returns (address factory,address pool)',
]);

export async function resolveBasketRouteRegistry(client: PublicClient): Promise<Address | null> {
  const module = process.env.MODULE_ADDRESS?.trim();
  if (!module || !isAddress(module)) return null;
  try {
    const adapter = await client.readContract({ address: getAddress(module), abi: moduleAbi, functionName: 'aerodromeAdapter' });
    return await client.readContract({ address: adapter, abi: adapterAbi, functionName: 'routeRegistry' });
  } catch {
    return null;
  }
}

export async function hasApprovedBasketRoute(
  client: PublicClient, registry: Address, chainId: number, token: Address,
): Promise<boolean> {
  const reviewed = getAerodromeSlipstreamRoutes(chainId, token, BASE_USDC_ADDRESS);
  const approvals = await Promise.allSettled(reviewed.map(({ tickSpacing }) => client.readContract({
    address: registry, abi: registryAbi, functionName: 'requireApprovedPool',
    args: [BigInt(chainId), token, BASE_USDC_ADDRESS, tickSpacing],
  })));
  return approvals.some((result) => result.status === 'fulfilled');
}
