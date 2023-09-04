// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import { getCookies } from 'https://deno.land/std@0.200.0/http/cookie.ts'
import { Context } from '../context.ts'
import { verify } from '../jwt.ts'

/**
 * Get the session token without verifying the session.
 *
 * @namespace oauth
 * @since v1.3
 */
export async function getSessionToken(c: Context) {
  const cookies = getCookies(c.req.raw.headers)

  if (!cookies.token) {
    return
  }

  const payload = await verify(
    cookies.token,
    (c.env('JWT_SECRET') ?? c.env('jwt_secret') ??
      c.env('jwtSecret')) as string,
    { audience: 'oauth:session' },
  )

  if (payload) {
    return cookies.token
  }
}
