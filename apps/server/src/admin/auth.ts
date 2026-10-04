import { randomBytes, createHash } from 'crypto';
import type { Request, Response } from 'express';
import type { AdminStaff } from '@xeom-rush/shared';
import { ControlService, ControlError, hash } from './service';

interface LoginState {
  verifier: string;
  expiresAt: number;
}
interface Session {
  staffId: string;
  csrf: string;
  expiresAt: number;
}
export interface AuthOptions {
  origin: string;
  clientId: string;
  clientSecret: string;
  secure: boolean;
  request?: typeof fetch;
}
function cookie(req: Request, name: string): string {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ''
  );
}
export class AdminAuth {
  private request: typeof fetch;
  constructor(
    private service: ControlService,
    public options: AuthOptions,
  ) {
    this.request = options.request ?? fetch;
  }
  private setCookie(res: Response, name: string, value: string, maxAge: number) {
    res.cookie(name, value, { httpOnly: true, secure: this.options.secure, sameSite: 'lax', path: '/', maxAge });
  }
  async login(req: Request, res: Response) {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await this.service.put(`oauth/${hash(state)}`, {
      verifier,
      expiresAt: this.service.now() + 600000,
    } satisfies LoginState);
    this.setCookie(res, 'xeom_oauth', state, 600000);
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: `${this.options.origin}/api/admin/auth/callback`,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: '',
    }).toString();
    res.redirect(url.toString());
  }
  async callback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || state.length > 100 || !code || code.length > 512 || cookie(req, 'xeom_oauth') !== state)
      throw new ControlError(403, 'Invalid sign-in state');
    const row = await this.service.store.get<LoginState>(`oauth/${hash(state)}`);
    if (
      !row.value ||
      row.value.expiresAt < this.service.now() ||
      !(await this.service.store.commit([row], [{ key: row.key, value: null }]))
    )
      throw new ControlError(403, 'Sign-in expired or already used');
    const response = await this.request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: `${this.options.origin}/api/admin/auth/callback`,
        code_verifier: row.value.verifier,
      }),
    });
    const token = (await response.json()) as { access_token?: string };
    if (!response.ok || !token.access_token) throw new ControlError(403, 'GitHub sign-in failed');
    const userResponse = await this.request('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'XeomRush-Admin',
      },
      signal: AbortSignal.timeout(10000),
    });
    const user = (await userResponse.json()) as { id?: number; login?: string };
    if (!userResponse.ok || !Number.isSafeInteger(user.id))
      throw new ControlError(403, 'GitHub identity could not be verified');
    const staff = await this.service.store.get<AdminStaff>(`staff/${user.id}`);
    if (!staff.value || staff.value.disabled) throw new ControlError(403, 'This GitHub account is not approved');
    // Provider tokens are used only to establish identity, never persisted or sent to the browser.
    const secret = randomBytes(32).toString('base64url');
    await this.service.put(`sessions/${hash(secret)}`, {
      staffId: String(user.id),
      csrf: randomBytes(32).toString('base64url'),
      expiresAt: this.service.now() + 12 * 3600000,
    } satisfies Session);
    this.setCookie(res, 'xeom_admin', secret, 12 * 3600000);
    this.setCookie(res, 'xeom_oauth', '', 0);
    res.redirect('/admin/');
  }
  async authenticate(req: Request) {
    const token = cookie(req, 'xeom_admin');
    if (!token || token.length > 100) throw new ControlError(401, 'Sign in to continue');
    const session = await this.service.store.get<Session>(`sessions/${hash(token)}`);
    if (!session.value || session.value.expiresAt <= this.service.now()) throw new ControlError(401, 'Session expired');
    const staff = await this.service.store.get<AdminStaff>(`staff/${session.value.staffId}`);
    if (!staff.value || staff.value.disabled) throw new ControlError(403, 'Staff access revoked');
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== this.options.origin || req.headers['x-csrf-token'] !== session.value.csrf)
    )
      throw new ControlError(403, 'Invalid request origin or CSRF token');
    return { staff: staff.value, csrf: session.value.csrf, sessionKey: session.key };
  }
  async logout(req: Request, res: Response) {
    const session = await this.authenticate(req);
    await this.service.put(session.sessionKey, null);
    this.setCookie(res, 'xeom_admin', '', 0);
    res.json({ ok: true });
  }
}
