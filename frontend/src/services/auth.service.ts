import { API_URL } from '../config/api.config';


export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  status: string;
  message?: string;
  data: {
    user: User;
    token?: string;
  };
}

export async function registerUser(name: string, email: string, password: string): Promise<User> {
  const response = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
    credentials: 'include',
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(json?.message || 'Registration failed. Please try again.');
  }

  return json.data.user;
}

export async function loginUser(email: string, password: string): Promise<User> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(json?.message || 'Invalid email or password.');
  }

  return json.data.user;
}

export async function logoutUser(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  }).catch(() => {});
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/me`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    return json.data?.user || null;
  } catch {
    return null;
  }
}
