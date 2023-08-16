// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
export { cheetah as default } from './cheetah.ts'
export type { AppConfig, AppContext } from './cheetah.ts'
export { Collection } from './collection.ts'
export { Context } from './context.ts'
export { Exception } from './exception.ts'
export { createExtension } from './extensions.ts'
export type { Extension } from './extensions.ts'
export { default as jwt } from './jwt.ts'
export { LocationData } from './location_data.ts'
export { otp } from './otp.ts'
export { sendMail } from './send_mail.ts'
export { Store } from './store.ts'

/* crypto ------------------------------------------------------------------- */

import { decode } from 'https://deno.land/std@0.198.0/encoding/base64.ts'
import { Context } from './context.ts'

export async function encrypt(c: Context, message: string) {
  const key = (c.env('crypto_key') ?? c.env('CRYPTO_KEY')) as string

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ivStr = Array.from(iv)
    .map((byte) => String.fromCharCode(byte))
    .join('')
  const alg = { name: 'AES-GCM', iv }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    decode(key).buffer,
    alg,
    true,
    ['encrypt', 'decrypt'],
  )
  const cipherBuf = await crypto.subtle.encrypt(
    alg,
    cryptoKey,
    new TextEncoder().encode(message),
  )
  const cipherArr = Array.from(new Uint8Array(cipherBuf))
  const cipherStr = cipherArr.map((byte) => String.fromCharCode(byte))
    .join('')

  return btoa(ivStr + cipherStr)
}

export async function decrypt(c: Context, message: string) {
  const key = (c.env('crypto_key') ?? c.env('CRYPTO_KEY')) as string

  const iv = atob(message).slice(0, 12)
  const alg = {
    name: 'AES-GCM',
    iv: new Uint8Array(
      Array.from(iv).map((char) => char.charCodeAt(0)),
    ),
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    decode(key).buffer,
    alg,
    true,
    ['encrypt', 'decrypt'],
  )
  const cipherStr = atob(message).slice(12)
  const cipherBuf = new Uint8Array(
    Array.from(cipherStr).map((char) => char.charCodeAt(0)),
  )
  const buf = await crypto.subtle.decrypt(alg, cryptoKey, cipherBuf)

  return new TextDecoder().decode(buf)
}
