// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import { Context } from '../context.ts'
import { env } from '../x/env.ts'
import { verify as jwtVerify } from '../x/jwt.ts'

export async function getSessionId(c: Context): Promise<string | undefined> {
  if (!c.__app.oauth) {
    throw new Error('Please configure the oauth module for your app!')
  }
  
  const header = c.req.headers.authorization

  if (!header || /^bearer\s[a-zA-Z0-9-_.]+$/.test(header) === false) {
    return
  }

  const token = header.split(' ')[1]

  const e = env<{
    jwtSecret?: string
    jwt_secret?: string
    JWT_SECRET?: string
  }>(c)

  const payload = await jwtVerify<{ sessionId: string }>(
    token,
    e.jwtSecret ?? e.jwt_secret ?? e.JWT_SECRET as string,
    { audience: 'oauth' },
  )

  if (!payload) {
    return
  }

  if (await c.__app.oauth.store.hasSession(c, payload.sessionId)) {
    return payload.sessionId
  }
}
