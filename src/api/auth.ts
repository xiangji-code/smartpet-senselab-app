/**
 * App Session 相关 API（对接后端 App API `/api/app/auth` 与 `/api/app/devices`）。
 *
 * 后端 JSON 为 snake_case，这里负责与前端领域类型（camelCase）之间的映射，
 * 使上层（AuthContext / 页面）只依赖 `src/types/domain.ts`。
 */
import { api } from './client';
import type { AppUserStatus } from '../types/domain';

// ── 后端响应形状（snake_case）──────────────────────────────
interface TokenPairDto {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface AccessTokenDto {
  access_token: string;
  token_type: string;
}

interface AppUserDto {
  id: number;
  email: string;
  phone?: string | null;
  status: string;
  created_at: string;
}

// ── 上层使用的结果类型 ────────────────────────────────────
export interface AuthUser {
  id: number;
  email: string;
  status: AppUserStatus;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface Captcha {
  captchaId: string;
  /** 内联 SVG 字符串，由前端用 react-native-svg 渲染 */
  svg: string;
}

export interface RegisterInput {
  confirmPassword?: string;
  captchaId?: string;
  captchaCode?: string;
}

// ── 映射 ──────────────────────────────────────────────────
function mapUser(dto: AppUserDto): AuthUser {
  return {
    id: dto.id,
    email: dto.email,
    status: (dto.status as AppUserStatus) ?? 'active',
  };
}

// ── API ───────────────────────────────────────────────────
const BASE = '/api/app';

export const authApi = {
  /** 判断邮箱是否已注册，用于统一的登录/注册流程分流。 */
  async emailExists(email: string): Promise<boolean> {
    const res = await api.get<{ exists: boolean }>(
      `${BASE}/auth/email-exists?email=${encodeURIComponent(email)}`,
      { auth: false },
    );
    return res.exists;
  },

  /** 获取一张图形验证码（captchaId + 内联 SVG）。 */
  async getCaptcha(): Promise<Captcha> {
    const dto = await api.get<{ captcha_id: string; svg: string }>(
      `${BASE}/auth/captcha`,
      { auth: false },
    );
    return { captchaId: dto.captcha_id, svg: dto.svg };
  },

  /** 注册后端仅返回用户，不含 token；调用方注册成功后需再 login。 */
  async register(email: string, password: string, input: RegisterInput = {}): Promise<AuthUser> {
    const dto = await api.post<AppUserDto>(
      `${BASE}/auth/register`,
      {
        email,
        password,
        confirm_password: input.confirmPassword,
        captcha_id: input.captchaId,
        captcha_code: input.captchaCode,
      },
      { auth: false },
    );
    return mapUser(dto);
  },

  async login(email: string, password: string): Promise<TokenPair> {
    const dto = await api.post<TokenPairDto>(
      `${BASE}/auth/login`,
      { email, password },
      { auth: false },
    );
    return { accessToken: dto.access_token, refreshToken: dto.refresh_token };
  },

  /** 用 refresh token 换取新的 access token；失败抛 ApiError（401）。 */
  async refresh(refreshToken: string): Promise<string> {
    const dto = await api.post<AccessTokenDto>(
      `${BASE}/auth/refresh`,
      { refresh_token: refreshToken },
      { auth: false },
    );
    return dto.access_token;
  },

  async logout(refreshToken: string): Promise<void> {
    await api.post<void>(
      `${BASE}/auth/logout`,
      { refresh_token: refreshToken },
      { auth: false },
    );
  },

  async getMe(): Promise<AuthUser> {
    const dto = await api.get<AppUserDto>(`${BASE}/auth/me`);
    return mapUser(dto);
  },
};
