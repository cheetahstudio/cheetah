// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import { getNormalizedUser, getToken, getUser } from 'authenticus'
import { UserAgent } from 'std/http/user_agent.ts'
import { Context } from '../context.ts'
import { sign, verify } from '../jwt.ts'
import { LocationData } from '../location_data.ts'
import { OAuthClient } from './client.ts'
import {
  OAuthSessionData,
  OAuthSessionToken,
  OAuthSignInToken,
} from './types.ts'

export async function handleCallback(
  c: Context,
  client: OAuthClient,
) {
  if (!c.__app.oauth) {
    throw new Error('Please configure the oauth module for your app!')
  }

  // validate request

  if (
    typeof c.req.query.state !== 'string' ||
    typeof c.req.query.code !== 'string'
  ) {
    throw c.exception('Bad Request')
  }

  // validate state

  const payload = await verify<OAuthSignInToken>(
    c,
    c.req.query.state,
    { audience: 'oauth:sign_in' },
  )

  if (!payload || payload.ip !== c.req.ip) {
    throw c.exception('Access Denied')
  }

  try {
    // fetch user

    const { accessToken } = await getToken(client.preset, {
      clientId: (c.env(`${client.name.toUpperCase()}_CLIENT_ID`) ??
        c.env(`${client.name}_client_id`)) as string,
      clientSecret: (c.env(`${client.name.toUpperCase()}_CLIENT_SECRET`) ??
        c.env(`${client.name}_client_secret`)) as string,
      code: c.req.query.code,
      redirectUri: payload.redirectUri,
    })

    const user = getNormalizedUser(
      client.preset,
      // @ts-ignore:
      await getUser(client.preset, accessToken),
    )

    // create session

    const identifier = crypto.randomUUID()

    const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60000)

    const token = await sign<OAuthSessionToken>(
      c,
      {
        aud: 'oauth:session',
        exp: expirationDate,
        identifier,
        ip: c.req.ip,
      },
    )

    const userAgent = new UserAgent(c.req.headers['user-agent'] ?? '')

    const location = new LocationData(c)

    const data: OAuthSessionData = {
      identifier,
      email: user.email,
      method: client.name,
      userAgent: {
        browser: userAgent.browser,
        device: userAgent.device,
        os: userAgent.os,
      },
      location: {
        ip: c.req.ip,
        city: location.city,
        region: location.region,
        regionCode: location.regionCode,
        country: location.country,
        continent: location.continent,
      },
      expiresAt: expirationDate.getTime(),
    }

    c.__app.oauth.store.set(c, identifier, data, data.expiresAt)

    c.res.setCookie('token', token, {
      expires: expirationDate,
      httpOnly: true,
      secure: true,
      path: '/',
      ...c.__app.oauth.cookie,
    })

    if (typeof c.__app.oauth.onSignIn === 'function') {
      await c.__app.oauth.onSignIn(c, data)
    }

    return {
      token,
      ...data,
    }
  } catch (_err) {
    throw c.exception('Bad Request')
  }
}
