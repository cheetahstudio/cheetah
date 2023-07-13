// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import {
  ContinentCode,
  IncomingRequestCfProperties,
} from 'https://cdn.jsdelivr.net/npm/@cloudflare/workers-types@4.20230710.0/index.ts'
import {
  deadline as resolveWithDeadline,
  DeadlineError,
} from 'https://deno.land/std@0.194.0/async/deadline.ts'
import z from 'https://deno.land/x/zod@v3.21.4/index.ts'
import { ZodType } from 'https://deno.land/x/zod@v3.21.4/types.ts'
import { Method } from './base.ts'
import { BaseType, ObjectType } from './handler.ts'
import { AppContext, Exception } from './mod.ts'

type Static<T extends ZodType | unknown> = T extends ZodType ? z.infer<T>
  : unknown

export class RequestContext<
  Params extends Record<string, unknown> = Record<string, never>,
  ValidatedBody extends ZodType | unknown = unknown,
  ValidatedCookies extends ObjectType | unknown = unknown,
  ValidatedHeaders extends ObjectType | unknown = unknown,
  ValidatedQuery extends ObjectType | unknown = unknown,
> {
  #a
  #c: Record<string, string | undefined> | undefined
  #h: Record<string, string | undefined> | undefined
  #i: string | undefined
  #p
  #q: Record<string, unknown> | undefined
  #r
  #s

  constructor(
    __app: AppContext,
    p: Record<string, string | undefined>,
    r: Request,
    s: {
      body?: ZodType | undefined
      cookies?: ObjectType | undefined
      headers?: ObjectType | undefined
      query?: ObjectType | undefined
      [key: string]: unknown
    } | null,
  ) {
    this.#a = __app
    this.#p = p
    this.#r = r
    this.#s = s
  }

  get ip() {
    return this.#i
  }

  /**
   * The method of the incoming request.
   *
   * @example 'GET'
   * @since v0.12
   */
  get method() {
    return this.#r.method as Uppercase<Method>
  }

  /**
   * A method to retrieve the corresponding value of a parameter.
   */
  param<T extends keyof Params>(name: T): Params[T] {
    // @ts-ignore:
    return this.#p[name]
  }

  /**
   * Retrieve the original request object.
   *
   * @since v1.0
   */
  get raw() {
    return this.#r
  }

  /**
   * The validated body of the incoming request.
   */
  async body(): Promise<
    ValidatedBody extends ZodType ? Static<ValidatedBody> : unknown
  > {
    if (!this.#s?.body) {
      // @ts-ignore:
      return undefined
    }

    let body

    try {
      if (
        (this.#s.body as BaseType)._def.typeName === 'ZodObject'
      ) {
        if (
          this.#s.transform === true &&
          this.#r.headers.get('content-type') === 'multipart/form-data'
        ) {
          const formData = await resolveWithDeadline(this.#r.formData(), 3000)

          body = {} as Record<string, unknown>

          for (const [key, value] of formData.entries()) {
            body[key] = value
          }
        } else {
          body = await resolveWithDeadline(this.#r.json(), 3000)
        }
      } else if (
        (this.#s.body as BaseType)._def.typeName === 'ZodString'
      ) {
        body = await resolveWithDeadline(this.#r.text(), 3000)
      }
    } catch (err) {
      throw new Exception(err instanceof DeadlineError ? 413 : 400)
    }

    const isValid = this.#s.body.safeParse(body).success

    if (!isValid) {
      throw new Exception(400)
    }

    return body
  }

  /**
   * The validated cookies of the incoming request.
   */
  get cookies(): Static<ValidatedCookies> {
    if (this.#c || !this.#s?.cookies) {
      return this.#c as Static<ValidatedCookies>
    }

    try {
      const header = this.#r.headers.get('cookies') ?? ''

      if (header.length > 1000) {
        throw new Exception(413)
      }

      this.#c = header
        .split(/;\s*/)
        .map((pair) => pair.split(/=(.+)/))
        .reduce((acc: Record<string, string>, [k, v]) => {
          acc[k] = v

          return acc
        }, {})

      delete this.#c['']
    } catch (_err) {
      this.#c = {}
    }

    const isValid = this.#s.cookies.safeParse(this.#c).success

    if (!isValid) {
      throw new Exception(400)
    }

    return this.#c as Static<ValidatedCookies>
  }

  /**
   * The validated headers of the incoming request.
   */
  get headers(): ValidatedHeaders extends unknown
    ? Record<string, string | undefined>
    : Static<ValidatedHeaders> {
    if (this.#h) {
      return this.#h as ValidatedHeaders extends unknown
        ? Record<string, string | undefined>
        : Static<ValidatedHeaders>
    }

    this.#h = {}

    let num = 0

    for (const [key, value] of this.#r.headers) {
      if (num === 50) {
        break
      }

      if (!this.#h[key.toLowerCase()]) {
        this.#h[key.toLowerCase()] = value
      }

      num++
    }

    if (this.#s?.headers) {
      const isValid = this.#s.headers.safeParse(this.#h).success

      if (!isValid) {
        throw new Exception(400)
      }
    }

    return this.#h as ValidatedHeaders extends unknown
      ? Record<string, string | undefined>
      : Static<ValidatedHeaders>
  }

  /**
   * The validated query parameters of the incoming request.
   */
  get query(): Static<ValidatedQuery> {
    if (this.#q || !this.#s?.query) {
      return this.#q as Static<ValidatedQuery>
    }

    this.#q = {}

    for (const [key, value] of new URL(this.#r.url).searchParams) {
      if (value === '' || value === 'true') {
        this.#q[key] = true
      } else if (value === 'false') {
        this.#q[key] = false
      } else if (value.indexOf(',') > -1) {
        this.#q[key] = value.split(',')
      } else if (
        !isNaN((value as unknown) as number) && !isNaN(parseFloat(value))
      ) {
        this.#q[key] = parseInt(value)
      } else if (value === 'undefined') {
        this.#q[key] = undefined
      } else if (value === 'null') {
        this.#q[key] = null
      } else {
        this.#q[key] = decodeURIComponent(value)
      }
    }

    const isValid = this.#s.query.safeParse(this.#q).success

    if (!isValid) {
      throw new Exception(400)
    }

    return this.#q as Static<ValidatedQuery>
  }

  /**
   * Parse the request body as an `ArrayBuffer` with a set time limit in milliseconds.
   *
   * @param deadline (default 2500)
   */
  async blob(deadline = 2500) {
    try {
      const promise = this.#r.bodyUsed ? this.#r.clone().blob() : this.#r.blob()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as an `ArrayBuffer` with a set time limit in milliseconds.
   *
   * @param deadline (default 2500)
   */
  async buffer(deadline = 2500) {
    try {
      const promise = this.#r.bodyUsed
        ? this.#r.clone().arrayBuffer()
        : this.#r.arrayBuffer()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as a `FormData` with a set time limit in milliseconds.
   *
   * @param deadline (default 2500)
   */
  async formData(deadline = 2500) {
    try {
      const promise = this.#r.bodyUsed
        ? this.#r.clone().formData()
        : this.#r.formData()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * A readable stream of the request body.
   */
  get stream() {
    return this.#r.body
  }
}
