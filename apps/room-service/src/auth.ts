export async function guestId(token: string | null, secret: string): Promise<string | null> {
  if (
    secret.length < 32 ||
    !token ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[a-f0-9]{64}$/.test(token)
  )
    return null;
  const [id, signature] = token.split('.'),
    key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  const bytes = new Uint8Array(signature.match(/../g)!.map((c) => parseInt(c, 16)));
  return (await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`guest:${id}`))) ? id : null;
}
