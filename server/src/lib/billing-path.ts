export function shouldChargeGatewayTokens(
  plan: string,
  serviceKeyConfigured: boolean,
): boolean {
  return serviceKeyConfigured && plan === 'free';
}
